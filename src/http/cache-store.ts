import type { CacheEntry, CacheStore, MemoryCacheOptions } from "./cache-types.js";

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return cloneWithoutStructuredClone(value, new WeakMap()) as T;
}

function cloneWithoutStructuredClone(value: unknown, clones: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function" || typeof value === "symbol") {
      throw new TypeError("Cache values must be structured-cloneable");
    }
    return value;
  }

  const existingClone = clones.get(value);
  if (existingClone !== undefined) return existingClone;

  if (value instanceof Date) {
    const clone = new Date(value.getTime());
    clones.set(value, clone);
    return clone;
  }
  if (value instanceof RegExp) {
    const clone = new RegExp(value.source, value.flags);
    clones.set(value, clone);
    return clone;
  }
  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>();
    clones.set(value, clone);
    for (const [key, entry] of value) {
      clone.set(
        cloneWithoutStructuredClone(key, clones),
        cloneWithoutStructuredClone(entry, clones),
      );
    }
    return clone;
  }
  if (value instanceof Set) {
    const clone = new Set<unknown>();
    clones.set(value, clone);
    for (const entry of value) clone.add(cloneWithoutStructuredClone(entry, clones));
    return clone;
  }

  if (Array.isArray(value)) {
    const clone = new Array<unknown>(value.length);
    clones.set(value, clone);
    for (let index = 0; index < value.length; index++) {
      if (index in value) clone[index] = cloneWithoutStructuredClone(value[index], clones);
    }
    return clone;
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("This runtime can only cache plain objects without structuredClone");
  }

  const clone = Object.create(prototype) as Record<string, unknown>;
  clones.set(value, clone);
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    clone[key] = cloneWithoutStructuredClone(record[key], clones);
  }
  return clone;
}

export function createMemoryCache(options: MemoryCacheOptions = {}): CacheStore {
  const maxEntries = options.maxEntries;
  if (maxEntries !== undefined && (!Number.isSafeInteger(maxEntries) || maxEntries < 1)) {
    throw new RangeError("Cache maxEntries must be a positive safe integer");
  }

  const entries = new Map<string, CacheEntry>();

  function validEntry(key: string): CacheEntry | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() >= entry.expiresAt) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    get<T>(key: string): T | undefined {
      const entry = validEntry(key);
      if (entry === undefined) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return cloneValue(entry.value as T);
    },
    set<T>(key: string, value: T, ttl: number): void {
      if (!Number.isFinite(ttl) || ttl < 0) {
        throw new RangeError("Cache TTL must be a finite non-negative number");
      }
      if (ttl === 0) {
        entries.delete(key);
        return;
      }
      entries.set(key, { value: cloneValue(value), expiresAt: Date.now() + ttl });
    },
    has(key: string): boolean {
      return validEntry(key) !== undefined;
    },
    delete(key: string): boolean {
      return entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
    keys(): string[] {
      for (const key of entries.keys()) validEntry(key);
      return [...entries.keys()];
    },
  };
}
