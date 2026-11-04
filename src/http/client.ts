import { applyBearerToken, getAccessToken } from "./auth.js";
import { shouldRefreshToken } from "./auth-policy.js";
import { createHttpError } from "./error-response.js";
import { mergeHeaders } from "./headers.js";
import { createInterceptors } from "./interceptors.js";
import { parseJson } from "./response.js";
import { fetchWithRetry } from "./retry.js";
import { createTokenRefresher } from "./token-refresh.js";
import { createRequestSignal } from "./timeout.js";
import { buildUrl } from "./url.js";

import type { ClientOptions, RequestConfig, RequestOptions } from "./types.js";

export function createClient(options: ClientOptions) {
  const interceptors = createInterceptors();

  const tokenRefresher = options.auth !== undefined ? createTokenRefresher(options.auth) : null;

  async function request<T>(path: string, requestOptions: RequestOptions<T>): Promise<T> {
    try {
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

      // Execute request interceptors before fetch.
      const context = await interceptors.request.run({
        url,
        init,
      });

      // Prevent request interceptors from changing
      // the destination of managed credentials.
      if (useManagedAuth) {
        const expectedOrigin = new URL(options.baseUrl).origin;

        if (new URL(context.url).origin !== expectedOrigin) {
          throw new Error("Request interceptor changed authenticated origin");
        }

        if (context.init.redirect !== "error") {
          throw new Error("Authenticated requests cannot follow redirects");
        }
      }

      const finalSignal = context.init.signal;

      finalSignal?.throwIfAborted();

      const canReplayBody =
        context.init.body === undefined || typeof context.init.body === "string";

      const canRefresh =
        useManagedAuth &&
        options.auth?.refreshToken !== undefined &&
        tokenRefresher !== null &&
        canReplayBody;

      let response = await fetchWithRetry(
        context.url,
        context.init,
        requestOptions.method,
        retryOptions,
      );

      const needsRefresh = shouldRefreshToken(
        response.status,
        canRefresh,
        options.auth?.refreshToken !== undefined,
        false,
      );

      if (needsRefresh && tokenRefresher !== null && options.auth !== undefined) {
        await response.body?.cancel();

        finalSignal?.throwIfAborted();

        const latestToken = await getAccessToken(options.auth);

        const newToken =
          latestToken !== null && latestToken !== currentToken
            ? latestToken
            : await tokenRefresher.refresh();

        finalSignal?.throwIfAborted();

        if (newToken === null) {
          throw new Error("Unable to refresh access token");
        }

        const retryHeaders = new Headers(context.init.headers);

        applyBearerToken(retryHeaders, newToken);

        response = await fetchWithRetry(
          context.url,
          {
            ...context.init,
            headers: retryHeaders,
          },
          requestOptions.method,
          retryOptions,
        );
      }

      // Execute response interceptors.
      response = await interceptors.response.run(response);

      if (!response.ok) {
        throw await createHttpError(response);
      }

      const validator = requestOptions.validate;

      if (validator !== undefined) {
        return parseJson<T>(response, {
          validate: validator,
        });
      }

      return parseJson<T>(response);
    } catch (error) {
      // Error interceptors can transform the error.
      const transformedError = await interceptors.error.run(error);

      throw transformedError;
    }
  }

  function get<T>(path: string, config: RequestConfig<T> = {}): Promise<T> {
    return request<T>(path, {
      ...config,
      method: "GET",
    });
  }

  function post<TBody, TResponse>(
    path: string,
    body: TBody,
    config: RequestConfig<TResponse> = {},
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
    config: RequestConfig<TResponse> = {},
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
    config: RequestConfig<TResponse> = {},
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

  function remove<T>(path: string, config: RequestConfig<T> = {}): Promise<T> {
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
    interceptors,
  };
}
