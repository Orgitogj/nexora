export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ClientOptions {
  baseUrl: string;
}

export interface RequestOptions {
  method: HttpMethod;
  headers?: Record<string, string>;
  body?: BodyInit;
}
