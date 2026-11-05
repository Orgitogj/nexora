import type { ResponseValidator } from "./response-validator.js";
import type { CacheOptions, CacheRequestOptions } from "./cache-types.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
}

export interface AuthOptions {
  getToken: () => string | null | Promise<string | null>;
  refreshToken?: () => Promise<string | null>;
}

export interface ClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: RetryOptions;
  auth?: AuthOptions;
  cache?: CacheOptions;
  /** Opt-in sharing of concurrent anonymous GET requests. */
  deduplication?: boolean;
}

export interface RequestConfig<T = unknown> {
  headers?: Record<string, string>;
  query?: QueryParams;
  timeout?: number;
  signal?: AbortSignal;
  retry?: RetryOptions | false;
  auth?: boolean;
  validate?: ResponseValidator<T>;
  cache?: CacheRequestOptions | false;
  /** Overrides the client-level deduplication setting. */
  deduplication?: boolean;
}

export interface RequestOptions<T = unknown> extends RequestConfig<T> {
  method: HttpMethod;
  body?: BodyInit;
}
