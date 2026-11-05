import type { InflightStore } from "./deduplication-types.js";

export function createInflightStore(): InflightStore {
  const pending = new Map<string, Promise<unknown>>();
  return {
    size: () => pending.size,
    has: (key) => pending.has(key),
    run: <T>(key: string, task: () => Promise<T>): Promise<T> => {
      const existing = pending.get(key);
      if (existing !== undefined) return existing as Promise<T>;
      // Execute in a microtask so the entry is registered before task starts.
      const promise = Promise.resolve().then(task);
      pending.set(key, promise);
      void promise.then(
        () => {
          if (pending.get(key) === promise) pending.delete(key);
        },
        () => {
          if (pending.get(key) === promise) pending.delete(key);
        },
      );
      return promise;
    },
  };
}
