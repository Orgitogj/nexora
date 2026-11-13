import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCache } from "./cache-store.js";

describe("createMemoryCache", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

  it.each([NaN, Infinity, -Infinity, -1])("throws RangeError for invalid TTL: %s", (ttl) => {
    const cache = createMemoryCache();

    expect(() => cache.set("user", { id: 1 }, ttl)).toThrow(RangeError);
  });

  it("evicts the least recently used entry when capacity is exceeded", () => {
    const cache = createMemoryCache({ maxEntries: 2 });
    cache.set("first", 1, 5_000);
    cache.set("second", 2, 5_000);

    expect(cache.get("first")).toBe(1);
    cache.set("third", 3, 5_000);

    expect(cache.keys()).toEqual(["first", "third"]);
    expect(cache.get("second")).toBeUndefined();
  });

  it("removes expired entries before evicting active entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));

    const cache = createMemoryCache({ maxEntries: 2 });
    cache.set("expired", "temporary", 100);
    cache.set("active", "persistent", 1_000);

    vi.advanceTimersByTime(100);
    cache.set("new", "value", 1_000);

    expect(cache.keys()).toEqual(["active", "new"]);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "throws RangeError for invalid maxEntries: %s",
    (maxEntries) => {
      expect(() => createMemoryCache({ maxEntries })).toThrow(RangeError);
    },
  );

  it("preserves existing entries when a value cannot be cloned", () => {
    const cache = createMemoryCache({ maxEntries: 1 });
    cache.set("existing", "value", 5_000);

    expect(() => cache.set("uncloneable", () => undefined, 5_000)).toThrow();
    expect(cache.get("existing")).toBe("value");
    expect(cache.keys()).toEqual(["existing"]);
  });

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

  it("clones common cache values when structuredClone is unavailable", () => {
    vi.stubGlobal("structuredClone", undefined);
    const cache = createMemoryCache();
    const value: { date: Date; tags: Set<string>; self?: unknown } = {
      date: new Date("2026-11-07T12:00:00Z"),
      tags: new Set(["mobile"]),
    };
    value.self = value;

    cache.set("profile", value, 5_000);
    value.date.setUTCFullYear(2000);
    value.tags.add("changed");

    const retrieved = cache.get<typeof value>("profile");
    expect(retrieved?.date.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect(retrieved?.tags).toEqual(new Set(["mobile"]));
    expect(retrieved?.self).toBe(retrieved);
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
