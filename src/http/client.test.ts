import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";
import { NexoraError } from "./errors.js";
import { NexoraResponseError } from "./response-errors.js";

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

describe("HTTP client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("performs GET requests with the configured base URL, query, and headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: 1 }));
    const client = createClient({
      baseUrl: "https://api.example.test/v1",
      headers: { "X-Client": "nexora" },
    });

    await expect(client.get("/users", { query: { page: 2, active: true } })).resolves.toEqual({
      id: 1,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/v1/users?page=2&active=true");
    expect(new Headers(init?.headers).get("x-client")).toBe("nexora");
    expect(init?.method).toBe("GET");
  });

  it("performs POST requests and serializes JSON request bodies", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: 2 }));
    const client = createClient({ baseUrl: "https://api.example.test" });

    await expect(client.post("/users", { name: "Alex" })).resolves.toEqual({ id: 2 });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ name: "Alex" }));
    expect(new Headers(init?.headers).get("content-type")).toContain("application/json");
  });

  it("performs PUT and DELETE requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ updated: true }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));
    const client = createClient({ baseUrl: "https://api.example.test" });

    await expect(client.put("/users/1", { name: "Sam" })).resolves.toEqual({ updated: true });
    await expect(client.delete("/users/1")).resolves.toEqual({ deleted: true });

    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });

  it("parses JSON responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const client = createClient({ baseUrl: "https://api.example.test" });

    await expect(client.get("/status")).resolves.toEqual({ ok: true });
  });

  it.each([204, 205])("returns undefined for an empty %i response", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
    const client = createClient({ baseUrl: "https://api.example.test" });

    await expect(client.get("/empty")).resolves.toBeUndefined();
  });

  it("throws a response error for invalid JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{invalid", { headers: { "Content-Type": "application/json" } }),
    );
    const client = createClient({ baseUrl: "https://api.example.test" });

    await expect(client.get("/broken")).rejects.toMatchObject({
      name: "NexoraResponseError",
      message: "Invalid JSON response",
      status: 200,
    });
  });

  it("preserves HTTP error status and response data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: "missing" }, { status: 404, statusText: "Not Found" }),
    );
    const client = createClient({ baseUrl: "https://api.example.test" });

    await expect(client.get("/missing")).rejects.toMatchObject({
      name: "NexoraError",
      message: "Not Found",
      status: 404,
      statusText: "Not Found",
      data: { error: "missing" },
    } satisfies Partial<NexoraError>);
  });

  it("propagates network errors", async () => {
    const networkError = new TypeError("Failed to fetch");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(networkError);
    const client = createClient({ baseUrl: "https://api.example.test", retry: { maxRetries: 0 } });

    await expect(client.get("/offline")).rejects.toBe(networkError);
  });

  it("uses the interceptor's effective method to decide whether to retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 503 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      retry: { maxRetries: 3, baseDelay: 0 },
    });
    client.interceptors.request.use(({ init, ...context }) => ({
      ...context,
      init: { ...init, method: "POST", body: "payload" },
    }));

    await expect(client.get("/write")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects non-JSON success responses with a descriptive error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("plain text", { headers: { "Content-Type": "text/plain" } }),
    );
    const client = createClient({ baseUrl: "https://api.example.test" });

    await expect(client.get("/text")).rejects.toBeInstanceOf(NexoraResponseError);
  });
});
