import { describe, expect, it } from "vitest";
import { createCacheKey } from "./cache-key.js";

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

  it("includes representation headers but excludes unrelated headers", () => {
    const first = new Headers({ Accept: "application/json", "X-Request-Id": "one" });
    const sameRepresentation = new Headers({
      Accept: "application/json",
      "X-Request-Id": "two",
    });
    const differentRepresentation = new Headers({ Accept: "text/plain" });

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
});
