import type { CacheOptions, CachePolicy, CacheRequestOptions } from "./cache-types.js";

export interface ResolvedCacheOptions {
  enabled: boolean;
  ttl: number;
  policy: CachePolicy;
  key?: string;
  tags: readonly string[];
}

export function resolveCacheOptions(
  globalOptions: CacheOptions | undefined,
  requestOptions: CacheRequestOptions | false | undefined,
): ResolvedCacheOptions {
  const enabled =
    requestOptions === false ? false : (requestOptions?.enabled ?? globalOptions?.enabled ?? false);
  const ttl =
    requestOptions === false
      ? (globalOptions?.ttl ?? 60_000)
      : (requestOptions?.ttl ?? globalOptions?.ttl ?? 60_000);
  if (!Number.isFinite(ttl) || ttl < 0) {
    throw new RangeError("Cache TTL must be a finite non-negative number");
  }
  const policy =
    requestOptions === false
      ? (globalOptions?.policy ?? "cache-first")
      : (requestOptions?.policy ?? globalOptions?.policy ?? "cache-first");
  const key = requestOptions === false ? undefined : requestOptions?.key;
  const requestedTags = requestOptions === false ? [] : (requestOptions?.tags ?? []);
  if (
    !Array.isArray(requestedTags) ||
    requestedTags.some((tag) => typeof tag !== "string" || tag.trim().length === 0)
  ) {
    throw new TypeError("Cache tags must be non-empty strings");
  }
  const tags = [...new Set(requestedTags)];
  return { enabled, ttl, policy, tags, ...(key === undefined ? {} : { key }) };
}
