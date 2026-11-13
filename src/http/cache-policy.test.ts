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
    vi.useRealTimers();
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

  it("does not store a no-store response when a response interceptor removes the directive", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ id: 1 }, { headers: { "Cache-Control": "no-store" } })),
      );
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });
    client.interceptors.response.use(async (response) => {
      const body = await response.text();
      const headers = new Headers(response.headers);
      headers.delete("Cache-Control");
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });

    await client.get("/users");
    await client.get("/users");

    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("limits the client cache to the configured maximum entry count", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true, maxEntries: 2 },
      credentials: "omit",
    });

    await client.get("/users/1");
    await client.get("/users/2");
    await client.get("/users/1");
    await client.get("/users/3");
    await client.get("/users/2");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(client.cache.keys()).toEqual([
      JSON.stringify(["GET", "https://api.example.test/users/3", "", ""]),
      JSON.stringify(["GET", "https://api.example.test/users/2", "", ""]),
    ]);
  });

  it("invalidates every request associated with a tag and leaves unrelated entries cached", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users/1", { cache: { tags: ["users", "user:1"] } });
    await client.get("/users/2", { cache: { tags: ["users", "user:2"] } });
    await client.get("/posts/1", { cache: { tags: ["posts"] } });

    expect(client.cache.invalidateTag("users")).toBe(2);
    await client.get("/users/1", { cache: { tags: ["users", "user:1"] } });
    await client.get("/users/2", { cache: { tags: ["users", "user:2"] } });
    await client.get("/posts/1", { cache: { tags: ["posts"] } });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(client.cache.invalidateTag("user:1")).toBe(1);
    expect(client.cache.invalidateTags(["users", "posts"])).toBe(2);
    expect(client.cache.keys()).toEqual([]);
  });

  it("adds tags when a cached key is reused with additional tags", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users/1", { cache: { tags: ["users"] } });
    await client.get("/users/1", { cache: { tags: ["featured"] } });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(client.cache.invalidateTag("users")).toBe(1);
    expect(client.cache.invalidateTag("featured")).toBe(0);
  });

  it("invalidates cached undefined responses", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/empty", { cache: { tags: ["empty"] } });
    await client.get("/empty", { cache: { tags: ["empty"] } });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(client.cache.invalidateTag("empty")).toBe(1);
  });

  it("cleans tag associations after manual deletion and clearing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(jsonResponse({ id: 1 })),
    );
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users/1", { cache: { tags: ["users"] } });
    const key = client.cache.keys()[0]!;
    expect(client.cache.delete(key)).toBe(true);
    expect(client.cache.invalidateTag("users")).toBe(0);

    await client.get("/users/1", { cache: { tags: ["users"] } });
    client.cache.clear();

    expect(client.cache.invalidateTag("users")).toBe(0);
    expect(client.cache.keys()).toEqual([]);
  });

  it("does not invalidate cache entries evicted by the bounded LRU store", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true, maxEntries: 2 },
      credentials: "omit",
    });

    await client.get("/first", { cache: { tags: ["first"] } });
    await client.get("/second", { cache: { tags: ["second"] } });
    await client.get("/third", { cache: { tags: ["third"] } });

    expect(client.cache.invalidateTag("first")).toBe(0);
    expect(client.cache.invalidateTag("second")).toBe(1);
    expect(client.cache.keys()).toEqual([
      JSON.stringify(["GET", "https://api.example.test/third", "", ""]),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns zero when all entries for a tag have expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: 1 }));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
    });

    await client.get("/users/1", { cache: { ttl: 100, tags: ["users"] } });
    vi.advanceTimersByTime(100);

    expect(client.cache.invalidateTag("users")).toBe(0);
    expect(client.cache.keys()).toEqual([]);
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

  it("does not use stale data when a response interceptor throws a TypeError", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({
      baseUrl: "https://api.example.test",
      cache: { enabled: true },
      credentials: "omit",
      retry: { maxRetries: 0 },
    });

    await client.get("/users/1");
    client.interceptors.response.use(() => {
      throw new TypeError("response interceptor failed");
    });

    await expect(client.get("/users/1", { cache: { policy: "network-first" } })).rejects.toThrow(
      "response interceptor failed",
    );
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

  it("rejects an invalid client cache capacity", () => {
    expect(() =>
      createClient({
        baseUrl: "https://api.example.test",
        cache: { maxEntries: 0 },
      }),
    ).toThrow(RangeError);
  });

  it.each([{ tags: [""] }, { tags: [" "] }, { tags: ["users", ""] }])(
    "rejects invalid cache tags",
    ({ tags }) => {
      expect(() => resolveCacheOptions(undefined, { tags })).toThrow(TypeError);
    },
  );
});
