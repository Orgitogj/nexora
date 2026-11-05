import { applyBearerToken, getAccessToken } from "./auth.js";
import { shouldRefreshToken } from "./auth-policy.js";
import { createCacheController } from "./cache.js";
import { createCacheKey } from "./cache-key.js";
import { resolveCacheOptions } from "./cache-policy.js";
import { NexoraCacheMissError } from "./cache-errors.js";
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
  const cacheState = createCacheController();
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
          : { ...options.retry, ...requestOptions.retry };
      const authEnabled = requestOptions.auth !== false && options.auth !== undefined;
      const hasExplicitAuthorization =
        requestOptions.headers !== undefined &&
        new Headers(requestOptions.headers).has("Authorization");
      const useManagedAuth = authEnabled && !hasExplicitAuthorization;

      if (useManagedAuth && new URL(options.baseUrl).origin !== new URL(url).origin) {
        throw new Error("Authenticated requests must use the configured origin");
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
      if (requestOptions.body !== undefined) init.body = requestOptions.body;
      if (signal !== undefined) init.signal = signal;

      const context = await interceptors.request.run({ url, init });
      if (useManagedAuth) {
        if (new URL(context.url).origin !== new URL(options.baseUrl).origin) {
          throw new Error("Request interceptor changed authenticated origin");
        }
        if (context.init.redirect !== "error") {
          throw new Error("Authenticated requests cannot follow redirects");
        }
      }

      const finalSignal = context.init.signal;
      finalSignal?.throwIfAborted();

      const finalHeaders = new Headers(context.init.headers);
      const cacheOptions = resolveCacheOptions(options.cache, requestOptions.cache);
      // Avoid cross-user leaks: do not cache requests with credentials,
      // Authorization, Cookie, or a configured authentication provider.
      const canCache =
        cacheOptions.enabled &&
        cacheOptions.policy !== "no-store" &&
        requestOptions.method === "GET" &&
        context.init.method?.toUpperCase() === "GET" &&
        context.init.body === undefined &&
        !authEnabled &&
        !finalHeaders.has("authorization") &&
        !finalHeaders.has("cookie") &&
        context.init.credentials !== "include" &&
        context.init.credentials !== "same-origin";
      const cacheKey = cacheOptions.key ?? createCacheKey(context.url, finalHeaders);

      if (
        canCache &&
        (cacheOptions.policy === "cache-first" || cacheOptions.policy === "cache-only")
      ) {
        if (cacheState.store.has(cacheKey)) {
          finalSignal?.throwIfAborted();
          return cacheState.read<T>(cacheKey);
        }
        if (cacheOptions.policy === "cache-only") throw new NexoraCacheMissError(cacheKey);
      }

      const fetchAndParse = async (): Promise<T> => {
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
          if (newToken === null) throw new Error("Unable to refresh access token");
          const retryHeaders = new Headers(context.init.headers);
          applyBearerToken(retryHeaders, newToken);
          response = await fetchWithRetry(
            context.url,
            { ...context.init, headers: retryHeaders },
            requestOptions.method,
            retryOptions,
          );
        }
        response = await interceptors.response.run(response);
        if (!response.ok) throw await createHttpError(response);
        const validator = requestOptions.validate;
        return validator === undefined
          ? parseJson<T>(response)
          : parseJson<T>(response, { validate: validator });
      };

      let result: T;
      if (canCache && cacheOptions.policy === "network-first") {
        try {
          result = await fetchAndParse();
        } catch (error) {
          // Only transport failures can fall back to cached data.
          // Do not hide HTTP, validation, auth, or abort errors.
          if (
            error instanceof TypeError &&
            !finalSignal?.aborted &&
            cacheState.store.has(cacheKey)
          ) {
            return cacheState.read<T>(cacheKey);
          }
          throw error;
        }
      } else {
        result = await fetchAndParse();
      }

      finalSignal?.throwIfAborted();
      if (canCache && cacheOptions.ttl > 0) {
        cacheState.store.set(cacheKey, result, cacheOptions.ttl);
      }
      return result;
    } catch (error) {
      throw await interceptors.error.run(error);
    }
  }

  function get<T>(path: string, config: RequestConfig<T> = {}): Promise<T> {
    return request<T>(path, { ...config, method: "GET" });
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
      headers: { "Content-Type": "application/json", ...config.headers },
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
      headers: { "Content-Type": "application/json", ...config.headers },
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
      headers: { "Content-Type": "application/json", ...config.headers },
    });
  }
  function remove<T>(path: string, config: RequestConfig<T> = {}): Promise<T> {
    return request<T>(path, { ...config, method: "DELETE" });
  }
  return { get, post, put, patch, delete: remove, interceptors, cache: cacheState.controller };
}
