import { createHttpError } from "./error-response.js";
import { mergeHeaders } from "./headers.js";
import { parseJson } from "./response.js";
import { fetchWithRetry } from "./retry.js";
import { createRequestSignal } from "./timeout.js";
import { buildUrl } from "./url.js";

import type { ClientOptions, RequestConfig, RequestOptions } from "./types.js";

export function createClient(options: ClientOptions) {
  async function request<T>(path: string, requestOptions: RequestOptions): Promise<T> {
    const url = buildUrl(options.baseUrl, path, requestOptions.query);

    const headers = mergeHeaders(options.headers, requestOptions.headers);

    const timeout = requestOptions.timeout ?? options.timeout;

    const signal = createRequestSignal(timeout, requestOptions.signal);

    const init: RequestInit = {
      method: requestOptions.method,
      headers,
    };

    if (requestOptions.body !== undefined) {
      init.body = requestOptions.body;
    }

    if (signal !== undefined) {
      init.signal = signal;
    }

    const retryOptions =
      requestOptions.retry === false
        ? { maxRetries: 0 }
        : {
            ...options.retry,
            ...requestOptions.retry,
          };

    const response = await fetchWithRetry(url, init, requestOptions.method, retryOptions);

    if (!response.ok) {
      throw await createHttpError(response);
    }

    return parseJson<T>(response);
  }

  function get<T>(path: string, config: RequestConfig = {}): Promise<T> {
    return request<T>(path, {
      ...config,
      method: "GET",
    });
  }

  function post<TBody, TResponse>(
    path: string,
    body: TBody,
    config: RequestConfig = {},
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      ...config,
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
    });
  }

  function put<TBody, TResponse>(
    path: string,
    body: TBody,
    config: RequestConfig = {},
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      ...config,
      method: "PUT",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
    });
  }

  function patch<TBody, TResponse>(
    path: string,
    body: TBody,
    config: RequestConfig = {},
  ): Promise<TResponse> {
    return request<TResponse>(path, {
      ...config,
      method: "PATCH",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
    });
  }

  function remove<T>(path: string, config: RequestConfig = {}): Promise<T> {
    return request<T>(path, {
      ...config,
      method: "DELETE",
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
