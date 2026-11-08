import { applyBearerToken, getAccessToken } from "./auth.js";
import { shouldRefreshToken } from "./auth-policy.js";
import { createCacheController } from "./cache.js";
import {
  createCacheKey,
  hasNoStoreDirective,
  hasUnsupportedCacheHeaders,
  isCacheableResponse,
} from "./cache-key.js";
import { resolveCacheOptions } from "./cache-policy.js";
import { NexoraCacheMissError } from "./cache-errors.js";
import { createDeduplicator } from "./deduplication.js";
import { createDeduplicationKey } from "./deduplication-key.js";
import { createHttpError } from "./error-response.js";
import { mergeHeaders } from "./headers.js";
import { createInterceptors } from "./interceptors.js";
import { parseJson } from "./response.js";
import { fetchWithRetry } from "./retry.js";
import { createTokenRefresher } from "./token-refresh.js";
import { createRequestSignal, throwIfAborted } from "./timeout.js";
import { buildUrl } from "./url.js";
import type { ClientOptions, RequestConfig, RequestOptions } from "./types.js";

class TransportFailure extends Error {
  constructor(readonly error: TypeError) {
    super(error.message);
    this.name = "TransportFailure";
  }
}

export function createClient(options: ClientOptions) {
  const interceptors = createInterceptors();
  const cacheState = createCacheController();
  const deduplicator = createDeduplicator();
  const tokenRefresher = options.auth !== undefined ? createTokenRefresher(options.auth) : null;

  async function request<T>(path: string, requestOptions: RequestOptions<T>): Promise<T> {
    let disposeRequestSignal: (() => void) | undefined;
    try {
      const url = buildUrl(options.baseUrl, path, requestOptions.query);
      const headers = mergeHeaders(options.headers, requestOptions.headers);
      const timeout = requestOptions.timeout ?? options.timeout;
      const requestSignal = createRequestSignal(timeout, requestOptions.signal);
      disposeRequestSignal = () => requestSignal.dispose();
      const signal = requestSignal.signal;
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
      const credentials = requestOptions.credentials ?? options.credentials;
      if (credentials !== undefined) init.credentials = credentials;
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
      throwIfAborted(finalSignal);

      const finalHeaders = new Headers(context.init.headers);
      const cacheOptions = resolveCacheOptions(options.cache, requestOptions.cache);
      const canCache =
        cacheOptions.enabled &&
        cacheOptions.policy !== "no-store" &&
        requestOptions.method === "GET" &&
        context.init.method?.toUpperCase() === "GET" &&
        context.init.body === undefined &&
        !authEnabled &&
        !finalHeaders.has("authorization") &&
        !finalHeaders.has("cookie") &&
        context.init.credentials === "omit" &&
        !hasNoStoreDirective(finalHeaders) &&
        !hasUnsupportedCacheHeaders(finalHeaders);
      const cacheKey = cacheOptions.key ?? createCacheKey(context.url, finalHeaders);

      if (cacheOptions.policy === "cache-only") {
        if (canCache && cacheState.store.has(cacheKey)) {
          throwIfAborted(finalSignal);
          return cacheState.read<T>(cacheKey);
        }
        throw new NexoraCacheMissError(cacheKey);
      }

      if (canCache && cacheOptions.policy === "cache-first") {
        if (cacheState.store.has(cacheKey)) {
          throwIfAborted(finalSignal);
          return cacheState.read<T>(cacheKey);
        }
      }

      const fetchAndParse = async (): Promise<{ value: Awaited<T>; cacheable: boolean }> => {
        const canReplayBody =
          context.init.body === undefined || typeof context.init.body === "string";
        const canRefresh =
          useManagedAuth &&
          options.auth?.refreshToken !== undefined &&
          tokenRefresher !== null &&
          canReplayBody;
        const fetchResponse = async (fetchInit: RequestInit): Promise<Response> => {
          try {
            return await fetchWithRetry(
              context.url,
              fetchInit,
              requestOptions.method,
              retryOptions,
            );
          } catch (error) {
            if (error instanceof TypeError && !fetchInit.signal?.aborted) {
              throw new TransportFailure(error);
            }
            throw error;
          }
        };
        let response = await fetchResponse(context.init);
        const needsRefresh = shouldRefreshToken(
          response.status,
          canRefresh,
          options.auth?.refreshToken !== undefined,
          false,
        );
        if (needsRefresh && tokenRefresher !== null && options.auth !== undefined) {
          await response.body?.cancel();
          throwIfAborted(finalSignal);
          const latestToken = await getAccessToken(options.auth);
          const newToken =
            latestToken !== null && latestToken !== currentToken
              ? latestToken
              : await tokenRefresher.refresh();
          throwIfAborted(finalSignal);
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
        const serverResponseCacheable = isCacheableResponse(response);
        response = await interceptors.response.run(response);
        if (!response.ok) throw await createHttpError(response);
        const validator = requestOptions.validate;
        const value =
          validator === undefined
            ? await parseJson<T>(response)
            : await parseJson<T>(response, { validate: validator });
        return { value, cacheable: serverResponseCacheable && isCacheableResponse(response) };
      };

      const dedupEnabled = requestOptions.deduplication ?? options.deduplication ?? false;
      const canDeduplicate =
        dedupEnabled &&
        requestOptions.method === "GET" &&
        context.init.method?.toUpperCase() === "GET" &&
        context.init.body === undefined &&
        !authEnabled &&
        !finalHeaders.has("authorization") &&
        !finalHeaders.has("cookie") &&
        context.init.credentials === "omit" &&
        !hasUnsupportedCacheHeaders(finalHeaders) &&
        finalSignal === undefined &&
        timeout === undefined &&
        requestOptions.validate === undefined;
      const dedupKey = createDeduplicationKey(context.url, finalHeaders, {
        retry: retryOptions,
        cache: cacheOptions,
      });
      const runNetwork = (): Promise<{ value: Awaited<T>; cacheable: boolean }> =>
        canDeduplicate ? deduplicator.run(dedupKey, fetchAndParse) : fetchAndParse();

      let result: { value: Awaited<T>; cacheable: boolean };
      if (canCache && cacheOptions.policy === "network-first") {
        try {
          result = await runNetwork();
        } catch (error) {
          if (
            error instanceof TransportFailure &&
            !finalSignal?.aborted &&
            cacheState.store.has(cacheKey)
          ) {
            result = { value: await cacheState.read<T>(cacheKey), cacheable: false };
          } else if (error instanceof TransportFailure) {
            throw error.error;
          } else {
            throw error;
          }
        }
      } else {
        result = await runNetwork();
      }

      throwIfAborted(finalSignal);
      if (canCache && result.cacheable && cacheOptions.ttl > 0) {
        cacheState.store.set(cacheKey, result.value, cacheOptions.ttl);
      }
      return result.value;
    } catch (error) {
      throw await interceptors.error.run(error instanceof TransportFailure ? error.error : error);
    } finally {
      disposeRequestSignal?.();
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
