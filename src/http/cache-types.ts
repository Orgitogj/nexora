export type CachePolicy = "no-store" | "cache-first" | "network-first" | "cache-only";

export interface CacheOptions {
  enabled?: boolean;
  ttl?: number;
  policy?: CachePolicy;
  revalidate?: boolean;
}

export interface ClientCacheOptions extends CacheOptions {
  maxEntries?: number;
}

export interface MemoryCacheOptions {
  maxEntries?: number;
}

export interface CacheRequestOptions extends CacheOptions {
  key?: string;
  tags?: readonly string[];
}

export interface CacheEntry<T = unknown> {
  value: T;
  expiresAt: number;
  metadata?: CacheEntryMetadata;
}

export interface CacheEntryMetadata {
  headers: readonly (readonly [string, string])[];
  requiresRevalidation: boolean;
  retainUntil: number;
}

export interface CacheStore {
  get<T>(key: string): T | undefined;
  getStale?<T>(key: string): CacheEntry<T> | undefined;
  set<T>(key: string, value: T, ttl: number, metadata?: CacheEntryMetadata): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
  keys(): string[];
}
