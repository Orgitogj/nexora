import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { URL } from "node:url";

const keyPath = process.env.NEXORA_TLS_KEY;
const certificatePath = process.env.NEXORA_TLS_CERT;
if (keyPath === undefined || certificatePath === undefined) {
  throw new Error("Set NEXORA_TLS_KEY and NEXORA_TLS_CERT to a trusted HTTPS key and certificate.");
}

const key = readFileSync(keyPath);
const cert = readFileSync(certificatePath);
const primaryPort = Number(process.env.NEXORA_PRIMARY_PORT ?? 8443);
const secondaryPort = Number(process.env.NEXORA_SECONDARY_PORT ?? 8444);
const bindHost = process.env.NEXORA_BIND_HOST ?? "0.0.0.0";
const attempts = new Map();
const requests = new Map();

function requestState(id) {
  let state = requests.get(id);
  if (state === undefined) {
    state = {
      counts: {},
      canceled: false,
      bodyCanceled: false,
      authorizationForwarded: false,
    };
    requests.set(id, state);
  }
  return state;
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function recordRequest(id, pathname) {
  const state = requestState(id);
  state.counts[pathname] = (state.counts[pathname] ?? 0) + 1;
  return state;
}

function getCrossOrigin(request, requestUrl) {
  const configuredOrigin = request.headers["x-nexora-secondary-origin"];
  if (typeof configuredOrigin === "string") {
    const target = new URL(configuredOrigin);
    if (target.protocol !== "https:") throw new Error("Secondary origin must use HTTPS.");
    return target.origin;
  }
  const target = new URL(`https://${request.headers.host}`);
  target.port = String(secondaryPort);
  target.pathname = "";
  target.search = "";
  target.hash = "";
  if (target.origin === requestUrl.origin) {
    throw new Error("The secondary HTTPS origin must differ from the primary origin.");
  }
  return target.origin;
}

function handleRequest(request, response, serverRole) {
  const requestUrl = new URL(request.url ?? "/", `https://${request.headers.host}`);
  const pathname = requestUrl.pathname;
  const id = requestUrl.searchParams.get("id") ?? requestUrl.searchParams.get("probe") ?? "none";
  const state = recordRequest(id, pathname);

  if (pathname === "/health") {
    sendJson(response, 200, { ok: true, serverRole });
    return;
  }

  if (pathname === "/cookie/set") {
    const value = requestUrl.searchParams.get("value") ?? "";
    response.setHeader(
      "Set-Cookie",
      `nexora_session=${encodeURIComponent(value)}; Path=/; Secure; SameSite=None`,
    );
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/cookie/echo") {
    sendJson(
      response,
      200,
      { cookie: request.headers.cookie ?? "" },
      { "Cache-Control": "public, max-age=60" },
    );
    return;
  }

  if (pathname === "/redirect/same-origin") {
    response.writeHead(302, {
      "Cache-Control": "no-store",
      Location: `/redirect/target?id=${encodeURIComponent(id)}`,
    });
    response.end();
    return;
  }

  if (pathname === "/redirect/cross-origin") {
    try {
      const target = getCrossOrigin(request, requestUrl);
      response.writeHead(302, {
        "Cache-Control": "no-store",
        Location: `${target}/redirect/target?id=${encodeURIComponent(id)}`,
      });
      response.end();
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (pathname === "/redirect/target") {
    state.authorizationForwarded =
      request.headers.authorization === "Bearer nexora-validation-token";
    sendJson(response, 200, { ok: true, serverRole, authorization: state.authorizationForwarded });
    return;
  }

  if (pathname === "/slow") {
    const milliseconds = Math.max(
      100,
      Math.min(30_000, Number(requestUrl.searchParams.get("ms")) || 10_000),
    );
    const timer = setTimeout(() => sendJson(response, 200, { ok: true }), milliseconds);
    response.on("close", () => {
      if (!response.writableEnded) {
        clearTimeout(timer);
        state.canceled = true;
      }
    });
    return;
  }

  if (pathname === "/retry") {
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    if (attempt === 1) {
      sendJson(response, 503, { ok: false }, { "Retry-After": "2" });
      return;
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (pathname === "/stream-retry") {
    const attempt = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, attempt);
    if (attempt > 1) {
      sendJson(response, 200, { ok: true });
      return;
    }
    response.writeHead(503, {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain",
    });
    response.write("stream-start\n");
    let chunks = 0;
    const interval = setInterval(() => {
      if (response.destroyed) {
        clearInterval(interval);
        return;
      }
      chunks += 1;
      response.write(`chunk-${chunks}\n`);
      if (chunks === 40) {
        clearInterval(interval);
        response.end();
      }
    }, 250);
    response.on("close", () => {
      clearInterval(interval);
      if (!response.writableEnded) state.bodyCanceled = true;
    });
    return;
  }

  if (pathname === "/stats") {
    sendJson(response, 200, state);
    return;
  }

  sendJson(response, 404, { error: "Unknown test endpoint", pathname });
}

function listen(port, serverRole) {
  const server = createServer({ key, cert }, (request, response) => {
    try {
      handleRequest(request, response, serverRole);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
    }
  });
  server.listen(port, bindHost, () => {
    console.log(`${serverRole} HTTPS test service listening on ${bindHost}:${port}`);
  });
  server.on("error", (error) => {
    console.error(`${serverRole} HTTPS test service failed: ${error.message}`);
    process.exitCode = 1;
  });
  return server;
}

const servers = [listen(primaryPort, "primary"), listen(secondaryPort, "secondary")];
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const server of servers) server.close();
  });
}
