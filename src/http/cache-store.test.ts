
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "./cache-store.js";

describe("createMemoryCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores and retrieves values", () => {
    const cache = createMemoryCache();

    cache.set("user", { id: 1, name: "Alex" }, 5_000);

    expect(cache.has("user")).toBe(true);
    expect(cache.get("user")).toEqual({ id: 1, name: "Alex" });
  });

  it("returns undefined for a missing key", () => {
    const cache = createMemoryCache();

    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("missing")).toBe(false);
  });

  it("expires entries after their TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));

    const cache = createMemoryCache();
    cache.set("user", { id: 1 }, 100);

    vi.advanceTimersByTime(99);
    expect(cache.get("user")).toEqual({ id: 1 });

    vi.advanceTimersByTime(1);
    expect(cache.get("user")).toBeUndefined();
    expect(cache.has("user")).toBe(false);
  });

  it("removes an existing entry when TTL is zero", () => {
    const cache = createMemoryCache();

    cache.set("user", { id: 1 }, 5_000);
    cache.set("user", { id: 2 }, 0);

    expect(cache.has("user")).toBe(false);
    expect(cache.get("user")).toBeUndefined();
  });

  it.each([NaN, Infinity, -Infinity, -1])(
    "throws RangeError for invalid TTL: %s",
    (ttl) => {
      const cache = createMemoryCache();

      expect(() => cache.set("user", { id: 1 }, ttl)).toThrow(RangeError);
    },
  );

  it("clones values when storing and retrieving them", () => {
    const cache = createMemoryCache();
    const original = { profile: { name: "Alex" } };

    cache.set("user", original, 5_000);

    original.profile.name = "Changed";

    const retrieved = cache.get<{ profile: { name: string } }>("user");
    expect(retrieved?.profile.name).toBe("Alex");

    if (retrieved !== undefined) {
      retrieved.profile.name = "Modified";
    }

    expect(cache.get("user")).toEqual({
      profile: { name: "Alex" },
    });
  });

  it("deletes entries and reports whether deletion succeeded", () => {
    const cache = createMemoryCache();
    cache.set("user", { id: 1 }, 5_000);

    expect(cache.delete("user")).toBe(true);
    expect(cache.delete("user")).toBe(false);
    expect(cache.has("user")).toBe(false);
  });

  it("clears all entries", () => {
    const cache = createMemoryCache();

    cache.set("user", { id: 1 }, 5_000);
    cache.set("settings", { theme: "dark" }, 5_000);

    cache.clear();

    expect(cache.keys()).toEqual([]);
    expect(cache.has("user")).toBe(false);
    expect(cache.has("settings")).toBe(false);
  });

  it("returns only non-expired keys", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));

    const cache = createMemoryCache();

    cache.set("short", "temporary", 100);
    cache.set("long", "persistent", 1_000);

    vi.advanceTimersByTime(100);

    expect(cache.keys()).toEqual(["long"]);
  });
});
