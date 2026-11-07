import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";
import { resolveCacheOptions } from "./cache-policy.js";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("Cache policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("caches eligible GET responses", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({ baseUrl: "https://api.example.test", cache: { enabled: true } });

    await client.get("/users/1");
    await client.get("/users/1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const client = createClient({ baseUrl: "https://api.example.test", cache: { enabled: true } });
    client.interceptors.request.use(({ init, ...context }) => ({
      ...context,
      init: { ...init, body: "request body" },
    }));

    await client.get("/users/1");
    await client.get("/users/1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache when the request uses no-store", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(jsonResponse({ id: 1 })));
    const client = createClient({ baseUrl: "https://api.example.test", cache: { enabled: true } });

    await client.get("/users/1", { cache: { policy: "no-store" } });
    await client.get("/users/1", { cache: { policy: "no-store" } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid cache TTLs instead of silently disabling caching", () => {
    expect(() => resolveCacheOptions({ ttl: Number.NaN }, undefined)).toThrow(RangeError);
    expect(() => resolveCacheOptions(undefined, { ttl: -1 })).toThrow(RangeError);
  });
});
