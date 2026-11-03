export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | null | undefined;

export type QueryParams = Record<string, QueryValue>;

export interface ClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface RequestConfig {
  headers?: Record<string, string>;
  query?: QueryParams;
  timeout?: number;
  signal?: AbortSignal;
}

export interface RequestOptions extends RequestConfig {
  method: HttpMethod;
  body?: BodyInit;
}
