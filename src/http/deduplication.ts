import { createInflightStore } from "./inflight-store.js";

/** One coordinator per HTTP client; no cross-client sharing. */
export function createDeduplicator() {
  const store = createInflightStore();
  return {
    run: <T>(key: string, task: () => Promise<T>): Promise<T> => store.run(key, task),
    size: () => store.size(),
  };
}
