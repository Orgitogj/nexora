import { applyBearerToken, getAccessToken } from "./auth.js";
import { shouldRefreshToken } from "./auth-policy.js";
import { createCacheController } from "./cache.js";
import { createMemoryCache } from "./cache-store.js";
import {
  createCacheKey,
  getResponseCacheTtl,
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
import type { CacheEntryMetadata } from "./cache-types.js";
import type { ClientOptions, RequestConfig, RequestOptions } from "./types.js";

class TransportFailure extends Error {
  constructor(readonly error: TypeError) {
    super(error.message);
    this.name = "TransportFailure";
  }
}

export function createClient(options: ClientOptions) {
  const interceptors = createInterceptors();
  const cacheState = createCacheController(
    createMemoryCache(
      options.cache?.maxEntries === undefined ? {} : { maxEntries: options.cache.maxEntries },
    ),
  );
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
      const staleEntry =
        canCache && cacheOptions.revalidate
          ? cacheState.store.getStale?.<Awaited<T>>(cacheKey)
          : undefined;

      if (cacheOptions.policy === "cache-only") {
        if (canCache && staleEntry !== undefined) {
          throwIfAborted(finalSignal);
          cacheState.addTags(cacheKey, cacheOptions.tags);
          return staleEntry.value;
        }
        if (canCache && cacheState.controller.has(cacheKey)) {
          throwIfAborted(finalSignal);
          cacheState.addTags(cacheKey, cacheOptions.tags);
          return cacheState.read<T>(cacheKey);
        }
        throw new NexoraCacheMissError(cacheKey);
      }

      if (canCache && cacheOptions.policy === "cache-first") {
        const staleEntryIsFresh =
          staleEntry !== undefined &&
          Date.now() < staleEntry.expiresAt &&
          staleEntry.metadata?.requiresRevalidation !== true;
        if (
          staleEntryIsFresh ||
          (staleEntry === undefined && cacheState.controller.has(cacheKey))
        ) {
          throwIfAborted(finalSignal);
          cacheState.addTags(cacheKey, cacheOptions.tags);
          return staleEntry === undefined ? cacheState.read<T>(cacheKey) : staleEntry.value;
        }
      }

      const fetchAndParse = async (): Promise<{
        value: Awaited<T>;
        cacheTtl: number;
        storageTtl: number;
        metadata?: CacheEntryMetadata;
      }> => {
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
        const networkHeaders = new Headers(context.init.headers);
        const staleHeaders = new Headers(
          staleEntry?.metadata?.headers.map(([name, value]) => [name, value]),
        );
        const etag = staleHeaders.get("etag");
        const lastModified = staleHeaders.get("last-modified");
        if (cacheOptions.revalidate && etag !== null && !networkHeaders.has("if-none-match")) {
          networkHeaders.set("If-None-Match", etag);
        }
        if (
          cacheOptions.revalidate &&
          lastModified !== null &&
          !networkHeaders.has("if-modified-since")
        ) {
          networkHeaders.set("If-Modified-Since", lastModified);
        }
        const networkInit = { ...context.init, headers: networkHeaders };
        let response = await fetchResponse(networkInit);
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
          const retryHeaders = new Headers(networkInit.headers);
          applyBearerToken(retryHeaders, newToken);
          response = await fetchWithRetry(
            context.url,
            { ...networkInit, headers: retryHeaders },
            requestOptions.method,
            retryOptions,
          );
        }
        if (response.status === 304 && staleEntry !== undefined) {
          const revalidatedAt = Date.now();
          const revalidatedHeaders = new Headers(staleHeaders);
          response.headers.forEach((value, name) => revalidatedHeaders.set(name, value));
          if (!response.headers.has("age")) revalidatedHeaders.delete("age");
          if (!response.headers.has("date")) {
            revalidatedHeaders.set("date", new Date(revalidatedAt).toUTCString());
          }
          revalidatedHeaders.delete("content-length");
          revalidatedHeaders.delete("content-encoding");
          revalidatedHeaders.delete("transfer-encoding");
          const cachedBody = JSON.stringify(staleEntry.value);
          response = new Response(cachedBody === undefined ? null : cachedBody, {
            status: staleEntry.value === undefined ? 204 : 200,
            headers: revalidatedHeaders,
          });
        }
        const receivedAt = Date.now();
        const serverHeaders = [...response.headers.entries()];
        const serverCacheable = isCacheableResponse(response, cacheOptions.revalidate);
        if (cacheOptions.revalidate && !serverCacheable) {
          cacheState.controller.delete(cacheKey);
        }
        const serverCacheTtl = getResponseCacheTtl(response, cacheOptions.ttl, receivedAt);
        response = await interceptors.response.run(response);
        if (!response.ok) throw await createHttpError(response);
        const validator = requestOptions.validate;
        const value =
          validator === undefined
            ? await parseJson<T>(response)
            : await parseJson<T>(response, { validate: validator });
        const cacheTtl = serverCacheable
          ? Math.min(serverCacheTtl, getResponseCacheTtl(response, cacheOptions.ttl, receivedAt))
          : 0;
        const requiresRevalidation =
          cacheOptions.revalidate && serverCacheable && serverCacheTtl === 0;
        return {
          value,
          cacheTtl,
          storageTtl: requiresRevalidation ? cacheOptions.ttl : cacheTtl,
          ...(cacheOptions.revalidate && serverCacheable
            ? {
                metadata: {
                  headers: serverHeaders,
                  requiresRevalidation,
                  retainUntil: receivedAt + cacheOptions.ttl,
                },
              }
            : {}),
        };
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
      const runNetwork = (): ReturnType<typeof fetchAndParse> =>
        canDeduplicate ? deduplicator.run(dedupKey, fetchAndParse) : fetchAndParse();

      let result: Awaited<ReturnType<typeof fetchAndParse>>;
      if (canCache && cacheOptions.policy === "network-first") {
        try {
          result = await runNetwork();
        } catch (error) {
          if (
            error instanceof TransportFailure &&
            !finalSignal?.aborted &&
            (cacheState.controller.has(cacheKey) || staleEntry !== undefined)
          ) {
            cacheState.addTags(cacheKey, cacheOptions.tags);
            result = {
              value:
                staleEntry === undefined ? cacheState.read<Awaited<T>>(cacheKey) : staleEntry.value,
              cacheTtl: 0,
              storageTtl: 0,
            };
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
      if (canCache && result.storageTtl > 0) {
        cacheState.set(
          cacheKey,
          result.value,
          result.storageTtl,
          cacheOptions.tags,
          result.metadata,
        );
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
