import type { CacheEntry, CacheStore } from "./cache-types.js";

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function createMemoryCache(): CacheStore {
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
      return entry === undefined ? undefined : cloneValue(entry.value as T);
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
