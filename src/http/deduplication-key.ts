import { createCacheKey } from "./cache-key.js";
import type { CacheOptions } from "./cache-types.js";
import type { RetryOptions } from "./types.js";

/** Keys include options that can affect observable request behavior. */
export function createDeduplicationKey(
  url: string,
  headers: Headers,
  options: {
    retry: RetryOptions;
    cache: CacheOptions & { policy: string; ttl: number; enabled: boolean };
  },
): string {
  const retry = options.retry;
  const cache = options.cache;
  return JSON.stringify([
    createCacheKey(url, headers),
    retry.maxRetries ?? null,
    retry.baseDelay ?? null,
    retry.maxDelay ?? null,
    cache.enabled,
    cache.policy,
    cache.ttl,
  ]);
}
