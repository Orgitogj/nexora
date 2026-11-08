import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";
import { resolveCacheOptions } from "./cache-policy.js";

function jsonResponse(value: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(value), { ...init, headers });
}

describe("Cache policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches eligible GET responses when credentials are omitted", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users/1");
    await client.get("/users/1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("omit");
  });

  it("does not cache POST requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({ baseUrl: "https://api.example.test", cache: { enabled: true } });

    await client.post("/users", { name: "Alex" });
    await client.post("/users", { name: "Alex" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache requests when an auth provider is configured", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
      auth: { getToken: () => null },
    });

    await client.get("/users/1");
    await client.get("/users/1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache requests with a body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });
    client.interceptors.request.use(({ init, ...context }) => ({
      ...context,
      init: { ...init, body: "request body" },
    }));

    await client.get("/users/1");
    await client.get("/users/1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache when a request Cache-Control directive says no-store", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users/1", { headers: { "Cache-Control": "max-age=60, no-store" } });
    await client.get("/users/1", { headers: { "Cache-Control": "no-store" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache when the request uses no-store", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users/1", { cache: { policy: "no-store" } });
    await client.get("/users/1", { cache: { policy: "no-store" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not share cached representations across custom request headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const tenant = new Headers(init?.headers).get("x-tenant");
      return Promise.resolve(jsonResponse({ tenant }));
    });
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await expect(client.get("/users", { headers: { "X-Tenant": "one" } })).resolves.toEqual({
      tenant: "one",
    });
    await expect(client.get("/users", { headers: { "X-Tenant": "two" } })).resolves.toEqual({
      tenant: "two",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache when fetch may send ambient cookies", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({ baseUrl: "https://api.example.test", cache: { enabled: true } });

    await client.get("/private");
    await client.get("/private");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not store responses marked no-store, Vary star, or an unsupported Vary field", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ id: 1 }, { headers: { "Cache-Control": "no-store" } })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ id: 2 }, { headers: { Vary: "*" } })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ id: 3 }, { headers: { Vary: "X-Platform" } })),
      )
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 3 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users");
    await client.get("/users");
    await client.get("/users");
    await client.get("/users");
    await client.get("/users");

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not cache partial content as a complete representation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ partial: true }, { status: 206 })),
      )
      .mockImplementation(() => Promise.resolve(jsonResponse({ complete: true })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users");
    await client.get("/users");
    await client.get("/users");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the explicitly keyed Accept headers for variants", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_url, init) =>
        Promise.resolve(
          jsonResponse({ language: new Headers(init?.headers).get("accept-language") }),
        ),
      );
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users", { headers: { "Accept-Language": "en" } });
    await client.get("/users", { headers: { "Accept-Language": "fr" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("supports manual cache invalidation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users/1");
    client.cache.clear();
    await client.get("/users/1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.cache.keys()).toEqual([
      JSON.stringify(["GET", "https://api.example.test/users/1", "", ""]),
    ]);
  });

  it("uses a cached value on network-first transport failure", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ id: 1 })))
      .mockRejectedValueOnce(new TypeError("offline"));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
      retry: { maxRetries: 0 },
    });

    await client.get("/users/1");
    await expect(client.get("/users/1", { cache: { policy: "network-first" } })).resolves.toEqual({
      id: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not hide HTTP errors with a cached network-first response", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ id: 1 })))
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ error: "unavailable" }, { status: 503 })),
      );
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
      retry: { maxRetries: 0 },
    });

    await client.get("/users/1");
    await expect(
      client.get("/users/1", { cache: { policy: "network-first" } }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats cache-only as offline when there is no eligible cache key", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await expect(
      client.get("/users", { cache: { policy: "cache-only" }, headers: { "X-Tenant": "one" } }),
    ).rejects.toMatchObject({ name: "NexoraCacheMissError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid cache TTLs instead of silently disabling caching", () => {
    expect(() => resolveCacheOptions({ ttl: Number.NaN }, undefined)).toThrow(RangeError);
    expect(() => resolveCacheOptions(undefined, { ttl: -1 })).toThrow(RangeError);
  });
});
