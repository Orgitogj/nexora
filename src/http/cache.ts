import { NexoraCacheMissError } from "./cache-errors.js";
import { createMemoryCache } from "./cache-store.js";
import type { CacheStore } from "./cache-types.js";

export interface CacheController {
  get<T>(key: string): T | undefined;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  keys(): string[];
  invalidateTag(tag: string): number;
  invalidateTags(tags: readonly string[]): number;
}

export function createCacheController(store: CacheStore = createMemoryCache()) {
  const keyTags = new Map<string, Set<string>>();
  const tagKeys = new Map<string, Set<string>>();

  function removeKeyTags(key: string): void {
    const tags = keyTags.get(key);
    if (tags === undefined) return;
    keyTags.delete(key);
    for (const tag of tags) {
      const keys = tagKeys.get(tag);
      keys?.delete(key);
      if (keys?.size === 0) tagKeys.delete(tag);
    }
  }

  function addKeyTags(key: string, tags: readonly string[]): void {
    validateTags(tags);
    if (!store.has(key)) {
      removeKeyTags(key);
      return;
    }
    for (const tag of new Set(tags)) {
      const currentTags = keyTags.get(key) ?? new Set<string>();
      currentTags.add(tag);
      keyTags.set(key, currentTags);
      const keys = tagKeys.get(tag) ?? new Set<string>();
      keys.add(key);
      tagKeys.set(tag, keys);
    }
  }

  function pruneStaleKeys(): void {
    const liveKeys = new Set(store.keys());
    for (const key of keyTags.keys()) {
      if (!liveKeys.has(key)) removeKeyTags(key);
    }
  }

  function validateTags(tags: readonly string[]): void {
    if (
      !Array.isArray(tags) ||
      tags.some((tag) => typeof tag !== "string" || tag.trim().length === 0)
    ) {
      throw new TypeError("Cache tags must be non-empty strings");
    }
  }

  function invalidateTags(tags: readonly string[]): number {
    validateTags(tags);
    const keys = new Set<string>();
    for (const tag of tags) {
      for (const key of tagKeys.get(tag) ?? []) keys.add(key);
    }
    let invalidated = 0;
    for (const key of keys) {
      if (store.has(key)) {
        store.delete(key);
        invalidated++;
      }
      removeKeyTags(key);
    }
    return invalidated;
  }

  const controller: CacheController = {
    get: <T>(key: string) => {
      if (!store.has(key)) {
        removeKeyTags(key);
        return undefined;
      }
      const value = store.get<T>(key);
      return value;
    },
    has: (key: string) => {
      const exists = store.has(key);
      if (!exists) removeKeyTags(key);
      return exists;
    },
    delete: (key: string) => {
      const deleted = store.delete(key);
      if (deleted) removeKeyTags(key);
      return deleted;
    },
    clear: () => {
      store.clear();
      keyTags.clear();
      tagKeys.clear();
    },
    keys: () => {
      const keys = store.keys();
      pruneStaleKeys();
      return keys;
    },
    invalidateTag: (tag: string) => invalidateTags([tag]),
    invalidateTags,
  };
  return {
    controller,
    store,
    set<T>(key: string, value: T, ttl: number, tags: readonly string[] = []): void {
      validateTags(tags);
      store.set(key, value, ttl);
      pruneStaleKeys();
      addKeyTags(key, tags);
    },
    addTags(key: string, tags: readonly string[]): void {
      addKeyTags(key, tags);
    },
    read<T>(key: string): T {
      if (!controller.has(key)) throw new NexoraCacheMissError(key);
      return controller.get<T>(key) as T;
    },
  };
}
