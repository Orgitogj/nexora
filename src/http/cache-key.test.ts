import { describe, expect, it } from "vitest";
import { createCacheKey, getResponseCacheTtl, isCacheableResponse } from "./cache-key.js";

describe("Cache key", () => {
  it("generates consistent keys for identical requests", () => {
    expect(createCacheKey("https://api.example.test/users", new Headers())).toBe(
      createCacheKey("https://api.example.test/users", new Headers()),
    );
  });

  it("generates different keys for different URLs", () => {
    expect(createCacheKey("https://api.example.test/users", new Headers())).not.toBe(
      createCacheKey("https://api.example.test/posts", new Headers()),
    );
  });

  it("distinguishes HTTP methods", () => {
    const getKey = createCacheKey("https://api.example.test/users", new Headers());
    const postKey = createCacheKey("https://api.example.test/users", new Headers(), "POST");

    expect(getKey).not.toBe(postKey);
  });

  it("includes the standard representation headers", () => {
    const first = new Headers({ Accept: "application/json", "Accept-Language": "en" });
    const sameRepresentation = new Headers({
      Accept: "application/json",
      "Accept-Language": "en",
    });
    const differentRepresentation = new Headers({
      Accept: "application/json",
      "Accept-Language": "fr",
    });

    expect(createCacheKey("https://api.example.test/users", first)).toBe(
      createCacheKey("https://api.example.test/users", sameRepresentation),
    );
    expect(createCacheKey("https://api.example.test/users", first)).not.toBe(
      createCacheKey("https://api.example.test/users", differentRepresentation),
    );
  });

  it("handles query parameters as part of the URL", () => {
    expect(createCacheKey("https://api.example.test/users?page=1", new Headers())).not.toBe(
      createCacheKey("https://api.example.test/users?page=2", new Headers()),
    );
  });

  it("uses the smaller of configured TTL and server max-age", () => {
    const response = new Response(null, { headers: { "Cache-Control": "public, max-age=30" } });

    expect(getResponseCacheTtl(response, 60_000, 10_000, 10_000)).toBe(30_000);
    expect(getResponseCacheTtl(response, 10_000, 10_000, 10_000)).toBe(10_000);
  });

  it("subtracts Age and response time from max-age", () => {
    const response = new Response(null, {
      headers: { "Cache-Control": "max-age=30", Age: "5" },
    });

    expect(getResponseCacheTtl(response, 60_000, 10_000, 12_000)).toBe(23_000);
  });

  it("uses Expires and Date to calculate freshness", () => {
    const response = new Response(null, {
      headers: {
        Date: new Date(10_000).toUTCString(),
        Expires: new Date(40_000).toUTCString(),
      },
    });

    expect(getResponseCacheTtl(response, 60_000, 15_000, 18_000)).toBe(22_000);
  });

  it("treats no-cache responses as non-cacheable", () => {
    const response = new Response(null, { headers: { "Cache-Control": "no-cache, max-age=60" } });

    expect(isCacheableResponse(response)).toBe(false);
    expect(getResponseCacheTtl(response, 60_000)).toBe(0);
  });

  it("does not cache malformed max-age directives", () => {
    const response = new Response(null, { headers: { "Cache-Control": "max-age=invalid" } });

    expect(getResponseCacheTtl(response, 60_000)).toBe(0);
  });

  it("uses the shortest valid max-age when the directive is repeated", () => {
    const response = new Response(null, {
      headers: { "Cache-Control": 'max-age="30", max-age=10' },
    });

    expect(getResponseCacheTtl(response, 60_000)).toBe(10_000);
  });

  it("does not cache when Age is malformed", () => {
    const response = new Response(null, {
      headers: { "Cache-Control": "max-age=60", Age: "unknown" },
    });

    expect(getResponseCacheTtl(response, 60_000)).toBe(0);
  });
});
