import type { ResponseValidator } from "./response-validator.js";

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
}

export interface RequestConfig {
  validate?: ResponseValidator<unknown>;
  headers?: Record<string, string>;
  query?: QueryParams;
  timeout?: number;
  signal?: AbortSignal;
  retry?: RetryOptions | false;
  auth?: boolean;
}

export interface RequestOptions extends RequestConfig {
  method: HttpMethod;
  body?: BodyInit;
}
