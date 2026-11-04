import { applyBearerToken, getAccessToken } from "./auth.js";
import { shouldRefreshToken } from "./auth-policy.js";
import { createHttpError } from "./error-response.js";
import { mergeHeaders } from "./headers.js";
import { parseJson } from "./response.js";
import { fetchWithRetry } from "./retry.js";
import { createTokenRefresher } from "./token-refresh.js";
import { createRequestSignal } from "./timeout.js";
import { buildUrl } from "./url.js";

import type { ClientOptions, RequestConfig, RequestOptions } from "./types.js";

export function createClient(options: ClientOptions) {
  const tokenRefresher = options.auth !== undefined ? createTokenRefresher(options.auth) : null;

  async function request<T>(path: string, requestOptions: RequestOptions): Promise<T> {
    const url = buildUrl(options.baseUrl, path, requestOptions.query);

    const headers = mergeHeaders(options.headers, requestOptions.headers);

    const timeout = requestOptions.timeout ?? options.timeout;

    const signal = createRequestSignal(timeout, requestOptions.signal);

    const retryOptions =
      requestOptions.retry === false
        ? { maxRetries: 0 }
        : {
            ...options.retry,
            ...requestOptions.retry,
          };

    const authEnabled = requestOptions.auth !== false && options.auth !== undefined;

    const hasExplicitAuthorization =
      requestOptions.headers !== undefined &&
      new Headers(requestOptions.headers).has("Authorization");

    const useManagedAuth = authEnabled && !hasExplicitAuthorization;

    // Never attach managed credentials to another origin.
    if (useManagedAuth) {
      const baseOrigin = new URL(options.baseUrl).origin;
      const requestOrigin = new URL(url).origin;

      if (baseOrigin !== requestOrigin) {
        throw new Error("Authenticated requests must use the configured origin");
      }
    }

    let currentToken: string | null = null;

    if (useManagedAuth && options.auth !== undefined) {
      currentToken = await getAccessToken(options.auth);
      applyBearerToken(headers, currentToken);
    }

    const init: RequestInit = {
      method: requestOptions.method,
      headers,
      redirect: useManagedAuth ? "error" : "follow",
    };

    if (requestOptions.body !== undefined) {
      init.body = requestOptions.body;
    }

    if (signal !== undefined) {
      init.signal = signal;
    }

    // JSON bodies created by the public methods are replayable.
    // Reject other body types when automatic auth refresh is enabled.
    const canReplayBody = init.body === undefined || typeof init.body === "string";

    const canRefresh =
      useManagedAuth &&
      options.auth?.refreshToken !== undefined &&
      tokenRefresher !== null &&
      canReplayBody;

    signal?.throwIfAborted();

    let response = await fetchWithRetry(url, init, requestOptions.method, retryOptions);

    const needsRefresh = shouldRefreshToken(
      response.status,
      canRefresh,
      options.auth?.refreshToken !== undefined,
      false,
    );

    if (needsRefresh && tokenRefresher !== null) {
      await response.body?.cancel();

      signal?.throwIfAborted();

      // Another request might already have refreshed the token.
      const latestToken = await getAccessToken(options.auth!);

      const newToken =
        latestToken !== null && latestToken !== currentToken
          ? latestToken
          : await tokenRefresher.refresh();

      signal?.throwIfAborted();

      if (newToken !== null) {
        applyBearerToken(headers, newToken);

        response = await fetchWithRetry(url, init, requestOptions.method, retryOptions);
      } else {
        throw new Error("Unable to refresh access token");
      }
    }

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
