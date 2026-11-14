# Nexora

A TypeScript-first HTTP toolkit for mobile applications. It wraps `fetch` with retries, timeouts, token refresh, caching, request deduplication and interceptors, and has no runtime dependencies.

## Status

Nexora is a pre-release (`0.x`); the API may change between minor versions.

It is tested with Vitest on Node. Behaviour on React Native/Hermes has **not been verified yet**; a validation app is included in [`validation/react-native`](./validation/react-native). In particular, React Native's `fetch` may not honour `credentials: "omit"`, which the cache and deduplication rely on (see below). Test on a device before relying on caching in a production app.

## Install

```sh
npm install @orgitogj/nexora
```

Requires a runtime with the standard `fetch`, `Headers`, `Response` and `AbortController` APIs.

## Quick start

```ts
import { createClient } from "@orgitogj/nexora";

const api = createClient({
  baseUrl: "https://api.example.com/v1",
  timeout: 10_000,
});

interface User {
  id: number;
  name: string;
}

const user = await api.get<User>("/users/1");
const created = await api.post<{ name: string }, User>("/users", { name: "Alex" });
```

`get`, `post`, `put`, `patch` and `delete` are available. Request bodies passed to `post`, `put` and `patch` are serialized as JSON.

## Query parameters

```ts
await api.get("/users", { query: { page: 2, active: true } });
```

`null` and `undefined` values are skipped.

## Response validation

Pass a `validate` function to check the parsed JSON. If it throws, the request fails with a `NexoraResponseError`.

```ts
const user = await api.get("/users/1", {
  validate: (data) => parseUser(data), // e.g. a Zod or Valibot parser
});
```

## Retries

Retries are enabled by default (3 retries, 500 ms base delay, 5 s maximum delay, exponential backoff). Only `GET`, `PUT` and `DELETE` requests are retried, on network errors and on status `408`, `429`, `500`, `502`, `503` and `504`. The `Retry-After` header is respected.

```ts
const api = createClient({ baseUrl, retry: { maxRetries: 5, baseDelay: 300 } });

await api.get("/health", { retry: false }); // disable for one request
```

## Authentication

```ts
const api = createClient({
  baseUrl: "https://api.example.com",
  auth: {
    getToken: () => tokenStore.accessToken,
    refreshToken: async () => {
      const token = await refreshAccessToken();
      tokenStore.accessToken = token;
      return token;
    },
  },
});
```

The token is sent as a `Bearer` token. On a `401` response the client calls `refreshToken` once and retries the request; concurrent requests share a single refresh. Authenticated requests only go to the configured origin and do not follow redirects. Pass `auth: false` on a request to skip authentication.

## Errors

Non-2xx responses throw a `NexoraError` with `status`, `statusText` and the parsed `data`.

```ts
import { NexoraError } from "@orgitogj/nexora";

try {
  await api.get("/users/1");
} catch (error) {
  if (error instanceof NexoraError && error.status === 404) {
    // handle not found
  }
}
```

## Interceptors

```ts
api.interceptors.request.use(({ url, init }) => ({ url, init }));
api.interceptors.response.use((response) => response);
api.interceptors.error.use((error) => error);
```

Each `use` call returns an id that can be passed to `eject`.

## HTTP caching and deduplication

The HTTP client only caches or deduplicates requests when their credentials mode is explicitly set to `"omit"`. This prevents responses from being shared across requests authenticated by ambient cookies. Set `credentials: "omit"` in the client or request configuration when the endpoint is safe to call without credentials. Requests made while `auth` is configured are never cached or deduplicated.

```ts
const api = createClient({
  baseUrl: "https://api.example.com",
  credentials: "omit",
  cache: { enabled: true, ttl: 60_000, policy: "cache-first" },
});
```

Policies are `cache-first` (the default), `network-first`, `cache-only` and `no-store`. Deduplication is enabled with `deduplication: true` and is skipped for requests that have a timeout or an abort signal.

Requests with custom headers are not cached or deduplicated because the client cannot determine whether a server varies its response by those headers. Responses with `Cache-Control: no-store`, `Vary: *`, or a `Vary` field other than `Accept` or `Accept-Language` are not stored.

The built-in memory cache can be bounded with `cache.maxEntries` on client configuration. When full, it evicts the least recently used entry; reads refresh an entry's recency. The default remains uncapped for backwards compatibility. `createMemoryCache({ maxEntries })` applies the same limit when using the store directly.

Cached requests can include `cache.tags`, such as `cache: { enabled: true, tags: ["users", "user:42"] }`. Use `client.cache.invalidateTag("users")` or `client.cache.invalidateTags(["users", "posts"])` to remove matching entries. Both methods return the number of live entries invalidated; cache keys without matching tags are unaffected.

The configured cache `ttl` is an upper bound on response freshness. A server `Cache-Control: max-age` or `Expires` header can shorten that lifetime; `Age` is accounted for. Conditional revalidation is opt-in with `cache: { enabled: true, revalidate: true }`. Stale cached representations with an `ETag` or `Last-Modified` validator are sent with `If-None-Match` or `If-Modified-Since`; a `304` response reuses the cached body and refreshes its metadata. Responses marked `no-cache` are stored only when revalidation is enabled.

The in-memory cache uses the native `structuredClone` when available. Runtimes without it can still cache plain objects, arrays, dates, regular expressions, maps, and sets; other built-in object types require native `structuredClone`.

## Development

Requirements: Node.js 22.12 or newer.

```sh
npm install           # install dev dependencies
npm run build         # compile src/ to dist/ (JS, .d.ts, source maps)
npm run typecheck     # type-check src/ and tests/ without emitting
npm run test          # run the test suite once (Vitest)
npm run test:watch    # run tests in watch mode
npm run lint          # lint with ESLint
npm run format        # format all files with Prettier
npm run format:check  # verify formatting without writing
npm run check         # typecheck + lint + format:check + test
```

## License

[MIT](./LICENSE)
