import { parseJson } from "./response.js";

import type { ClientOptions, RequestOptions } from "./types.js";

export function createClient(options: ClientOptions) {
  async function request<T>(path: string, requestOptions: RequestOptions): Promise<T> {
    const url = `${options.baseUrl}${path}`;

    const init: RequestInit = {
      method: requestOptions.method,
    };

    if (requestOptions.headers !== undefined) {
      init.headers = requestOptions.headers;
    }

    if (requestOptions.body !== undefined) {
      init.body = requestOptions.body;
    }

    const response = await fetch(url, init);

    return parseJson<T>(response);
  }

  function get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return request<T>(path, {
      method: "GET",
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  function post<TBody, TResponse>(
    path: string,
    body: TBody,
    headers?: Record<string, string>,
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });
  }

  function put<TBody, TResponse>(
    path: string,
    body: TBody,
    headers?: Record<string, string>,
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      method: "PUT",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });
  }

  function patch<TBody, TResponse>(
    path: string,
    body: TBody,
    headers?: Record<string, string>,
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    });
  }

  function remove<T>(path: string, headers?: Record<string, string>): Promise<T> {
    return request<T>(path, {
      method: "DELETE",
      ...(headers !== undefined ? { headers } : {}),
    });
  }

  return {
    get,
    post,
    put,
    patch,
    delete: remove,
  };
}
