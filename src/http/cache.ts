import { NexoraCacheMissError } from "./cache-errors.js";
import { createMemoryCache } from "./cache-store.js";
import type { CacheStore } from "./cache-types.js";

export interface CacheController {
  get<T>(key: string): T | undefined;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  keys(): string[];
}

export function createCacheController(store: CacheStore = createMemoryCache()) {
  const controller: CacheController = {
    get: <T>(key: string) => store.get<T>(key),
    has: (key: string) => store.has(key),
    delete: (key: string) => store.delete(key),
    clear: () => store.clear(),
    keys: () => store.keys(),
  };
  return {
    controller,
    store,
    read<T>(key: string): T {
      if (!store.has(key)) throw new NexoraCacheMissError(key);
      return store.get<T>(key) as T;
    },
  };
}
