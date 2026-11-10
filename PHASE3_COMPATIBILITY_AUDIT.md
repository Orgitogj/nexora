# Phase 3: React Native and Hermes Compatibility Audit

## Scope and method

This was a read-only audit of the `test/react-native-compatibility` branch. It reviewed the source tree, HTTP implementation, existing Vitest tests, `package.json`, TypeScript configuration, and current React Native documentation. No React Native application or device runtime is part of this repository, so runtime findings are distinguished from risks that require native validation.

The audit did not modify source code, install dependencies, create commits, push, or merge.

## Summary

No unconditional React Native/Hermes runtime failure was reproduced. The repository has no declared minimum React Native/Hermes version and no Metro or device test project, so Node/Vitest and TypeScript results alone do not establish React Native compatibility.

The most important documented risk is `credentials: "omit"`: React Native's networking documentation lists this Fetch option as currently not working. Nexora uses that option as a prerequisite to enabling cache and request deduplication. If native fetch still sends ambient cookies, the cache's assumption that such requests are unauthenticated may not hold. This cross-user scenario is a credible conditional risk, but it was not reproduced in a React Native app.

## Findings

### Critical compatibility risks

No unconditional critical compatibility defect was confirmed during this audit.

### High-priority risk

#### Credentials omission and cache/deduplication isolation

- **Location:** [`src/http/client.ts:71`](/C:/Users/orgit/nexora/src/http/client.ts:71), [`src/http/client.ts:100`](/C:/Users/orgit/nexora/src/http/client.ts:100), [`src/http/client.ts:189`](/C:/Users/orgit/nexora/src/http/client.ts:189)
- **API/behavior:** Fetch `credentials: "omit"`; cache and in-flight request deduplication eligibility.
- **Evidence and confidence:** React Native's [networking documentation](https://reactnative.dev/docs/network#known-issues-with-fetch-and-cookie-based-authentication) lists `credentials: omit` as currently not working and says cookie-based authentication is unstable. The client sets and requires this mode before caching or deduplicating. **The platform limitation is documented; a resulting cross-user cache leak is a conditional risk, not a confirmed reproduced bug.**
- **Why it may be incompatible:** If a React Native fetch implementation still sends cookies despite `credentials: "omit"`, separate requests may be treated as safe to share while being authenticated differently by ambient cookies. Those cookies are not included in the cache or deduplication key.
- **Recommended validation or mitigation:** Test cookie sending and account switching on real iOS and Android React Native builds. Until verified, disable cache and deduplication for cookie-authenticated requests on React Native, or use a platform-proven way to ensure these requests cannot carry ambient credentials.

### Medium-priority risks

#### Redirect behavior for managed bearer-token requests

- **Location:** [`src/http/client.ts:69`](/C:/Users/orgit/nexora/src/http/client.ts:69), [`src/http/client.ts:78`](/C:/Users/orgit/nexora/src/http/client.ts:78)
- **API/behavior:** Fetch `redirect: "error"` for managed-auth requests, with origin checks around request interceptors.
- **Evidence and confidence:** React Native documents `redirect: "manual"` as unsupported, but the reviewed documentation does not establish how `redirect: "error"` behaves. **Unverified risk; no incompatibility was reproduced.**
- **Why it may be incompatible:** If native fetch ignores or implements redirect modes differently, a redirected request could behave differently than the client's auth safety checks expect.
- **Recommended validation or mitigation:** On both iOS and Android, test authenticated same-origin and cross-origin redirects and verify that bearer credentials are not forwarded. Do not infer `"error"` behavior from the documented `"manual"` limitation.

#### Abort and cancellation behavior

- **Location:** [`src/http/timeout.ts:36`](/C:/Users/orgit/nexora/src/http/timeout.ts:36), [`src/http/timeout.ts:46`](/C:/Users/orgit/nexora/src/http/timeout.ts:46), [`src/http/retry.ts:35`](/C:/Users/orgit/nexora/src/http/retry.ts:35), [`src/http/retry.ts:127`](/C:/Users/orgit/nexora/src/http/retry.ts:127)
- **API/behavior:** `AbortController`, `AbortSignal` event listeners, fetch cancellation, and retry-delay cancellation.
- **Evidence and confidence:** React Native provides AbortController documentation, but its global API pages are marked work in progress. Existing tests simulate fetch abort behavior and use Vitest timers; they do not prove that native networking stops. **Unverified platform risk.**
- **Why it may be incompatible:** Native fetch could differ in whether it observes a signal, when it rejects, or how abort reasons are exposed. A JavaScript-side timeout alone would not demonstrate that the underlying native request was canceled.
- **Recommended validation or mitigation:** Test canceling in-flight requests and retry delays on real devices, verify native network cancellation, and check that timers and listeners are cleaned up.

#### Memory cache growth

- **Location:** [`src/http/cache-store.ts:73`](/C:/Users/orgit/nexora/src/http/cache-store.ts:73), [`src/http/cache-store.ts:78`](/C:/Users/orgit/nexora/src/http/cache-store.ts:78), [`src/http/cache-store.ts:98`](/C:/Users/orgit/nexora/src/http/cache-store.ts:98)
- **API/behavior:** Unbounded in-memory `Map` storage with lazy expiration.
- **Evidence and confidence:** **Confirmed implementation behavior:** there is no maximum entry count; expired entries are removed when accessed or when `keys()` scans the store. This is not a React Native API incompatibility, but it may matter in a long-lived mobile process.
- **Why it may be incompatible:** Many unique cache keys can consume memory; entries that expire but are never revisited can remain allocated.
- **Recommended validation or mitigation:** Measure memory usage under sustained unique-key traffic on a device. Consider an entry limit or pruning strategy if measurements justify it.

### Low-priority risks

#### Response body cancellation and stream compatibility

- **Location:** [`src/http/retry.ts:122`](/C:/Users/orgit/nexora/src/http/retry.ts:122), [`src/http/client.ts:151`](/C:/Users/orgit/nexora/src/http/client.ts:151), [`src/http/retry.ts:88`](/C:/Users/orgit/nexora/src/http/retry.ts:88)
- **API/behavior:** `response.body.cancel()` for discarded retry/auth responses and `getReader` detection for replayable request bodies.
- **Evidence and confidence:** Tests construct Node `ReadableStream` instances. The reviewed React Native docs describe Fetch/Response APIs but do not establish body-stream cancellation and reader behavior for every supported runtime. **Unverified risk; no failure was reproduced.**
- **Why it may be incompatible:** Native response bodies may expose different stream capabilities; cancellation or body classification could fail or behave differently.
- **Recommended validation or mitigation:** Exercise retryable responses, auth refresh responses, and stream request bodies on the minimum and current React Native versions. Confirm cancellation does not prevent subsequent fetches or leave native resources active.

#### `structuredClone` availability and fallback type limits

- **Location:** [`src/http/cache-store.ts:4`](/C:/Users/orgit/nexora/src/http/cache-store.ts:4), [`src/http/cache-store.ts:58`](/C:/Users/orgit/nexora/src/http/cache-store.ts:58), [`README.md:13`](/C:/Users/orgit/nexora/README.md:13)
- **API/behavior:** Feature-detected `structuredClone` and a custom fallback.
- **Evidence and confidence:** The implementation guards for missing `structuredClone`; the fallback supports plain objects, arrays, dates, regular expressions, maps, and sets, and rejects other prototype-bearing objects. The fallback is unit-tested by stubbing the Node global, not under Hermes. **Availability on the intended Hermes versions is unverified.**
- **Why it may be incompatible:** Hermes versions may differ in whether they supply `structuredClone`. The fallback also intentionally cannot clone arbitrary built-in or custom objects.
- **Recommended validation or mitigation:** Run the fallback test in Hermes with `structuredClone` absent, and test the actual values clients cache. Keep unsupported-value behavior explicit.

#### TypeScript DOM assumptions, ESM exports, and Metro resolution

- **Location:** [`tsconfig.json:4`](/C:/Users/orgit/nexora/tsconfig.json:4), [`tsconfig.json:5`](/C:/Users/orgit/nexora/tsconfig.json:5), [`tsconfig.json:8`](/C:/Users/orgit/nexora/tsconfig.json:8), [`package.json:25`](/C:/Users/orgit/nexora/package.json:25), [`package.json:26`](/C:/Users/orgit/nexora/package.json:26)
- **API/behavior:** ES2022 target, DOM library types, NodeNext module resolution, ESM package format, and package `exports`.
- **Evidence and confidence:** These settings type-check and build in the current repository, but no Metro consumer build or React Native typecheck is configured. Metro supports package exports by default starting with Metro 0.82 / React Native 0.79; older Metro behavior may differ. **No packaging failure was confirmed.**
- **Why it may be incompatible:** DOM declarations can make APIs appear available at compile time without proving they exist in the target runtime. Metro version and export-condition behavior may also differ from Node's.
- **Recommended validation or mitigation:** Declare a minimum supported React Native version and use a consumer app to typecheck and bundle the package's built output with the minimum and current supported Metro versions.

## Runtime API inventory

| API or behavior                   | Use in Nexora                                               | Audit assessment                                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch`                           | HTTP transport and retries                                  | React Native documents Fetch support; native behavior such as credentials, redirects, abort, and network error shape still needs device validation.                   |
| `Headers`                         | Request header merge, auth, cache keys, response inspection | Used directly; existing tests use the Node/Vitest implementation.                                                                                                     |
| `Request`                         | Not constructed in production                               | `RequestInit` is used as a TypeScript type; no runtime `Request` construction was found.                                                                              |
| `Response`                        | Response parsing, status handling, retry and interceptors   | Existing tests construct Node/Vitest `Response` objects; native `Response` behavior is untested.                                                                      |
| `URL` / `URLSearchParams`         | URL building and auth origin checks                         | Used directly in `src/http/url.ts` and `src/http/client.ts`; no Hermes-specific runtime validation exists.                                                            |
| `AbortController` / `AbortSignal` | Timeout composition and request cancellation                | Used directly. `AbortSignal.timeout()` and `AbortSignal.any()` are not used in production. Native cancellation is unverified.                                         |
| `DOMException`                    | Named abort/timeout errors                                  | Guarded in `src/http/timeout.ts`; a plain `Error` fallback is used if unavailable. Some tests instantiate `DOMException` directly in Node/Vitest.                     |
| `structuredClone`                 | Cache value cloning                                         | Feature-detected; custom fallback has limited supported types and has not been run under Hermes.                                                                      |
| `ReadableStream`                  | Retry replayability test and stream-body detection          | Production checks for `getReader`; tests instantiate Node's stream implementation. Native behavior is unverified.                                                     |
| Timers                            | Timeouts and retry delays                                   | Uses `setTimeout` / `clearTimeout`; React Native documents browser timers. Tests use Vitest fake timers, so native scheduling and suspension behavior are not tested. |

## HTTP behavior review

- **Request construction:** Calls `fetch(url, init)` with `RequestInit`; no runtime `Request` is constructed. URL and query construction depends on `URL` and `URLSearchParams`.
- **Headers:** Merges headers with `Headers` and reads response headers via `Headers.get`. Tests prove behavior under Vitest only.
- **Response parsing:** Reads text, treats 204/205 and empty bodies as `undefined`, checks JSON content type, parses JSON, then applies validation. Native response-body consumption and content-type behavior are not exercised.
- **Redirects:** Managed auth sets `redirect: "error"` and checks origins. Other requests use `"follow"`. React Native documents `"manual"` as unsupported but does not settle the modes used here.
- **Credentials:** Explicit credentials are passed to fetch. Cache/deduplication require `"omit"`; the React Native documentation warning makes this a platform-sensitive safety assumption.
- **Cancellation and network errors:** Fetch failures are classified as `TypeError` for retry/network-fallback purposes; native rejection type and abort timing are not tested.

## Timeout, retry, and cache review

- Timeout composition uses an `AbortController`, a timer, and an external signal listener; disposal clears the timer and removes the listener.
- Retry uses timers for backoff and `Retry-After`, chunks long waits to fit the timer limit, and listens for abort during a delay. Native timer behavior is not covered by fake-timer tests.
- Retry discards retryable response bodies with `body.cancel()`. Native body cancellation needs integration coverage.
- Cache uses in-memory `Map` storage and `Date.now()` expiration. There is no capacity limit; expiration cleanup is lazy.
- Cache cloning uses `structuredClone` when present. Its fallback handles supported common structures, including cycles, but does not support arbitrary prototypes.

## Existing test coverage

There are 10 HTTP test files, discovered by Vitest from the source tree. They validate logic including URL construction, request options, response parsing, cache and retry policy, auth refresh, interceptors, deduplication, timeout and errors.

Several tests directly depend on Node/Vitest environment behavior:

- Client/cache/auth/interceptor tests spy on global `fetch` and create `Response` objects in the test runtime.
- Timeout and retry tests use Vitest fake timers and simulated abort listeners.
- Retry tests create a Node `ReadableStream` and `DOMException`.
- Cache-store tests stub Node's `structuredClone`.

These are useful deterministic unit tests, but none execute native React Native fetch, cookies, redirect handling, Hermes globals, or Metro bundling. They should not be represented as React Native runtime validation.

## Recommended React Native/Hermes test environment

Create a small consumer fixture app using Hermes and a declared minimum React Native version, plus a current supported release. Run release builds on both iOS and Android; do not rely on remote debugging, which may change the JavaScript runtime. Import the built package through Metro rather than testing only source aliases.

The fixture should validate:

1. Cookie behavior with `credentials: "omit"` and two accounts, including cache isolation.
2. Same-origin and cross-origin redirects for managed bearer-token requests.
3. Cancellation of in-flight requests and retry delays; confirm native network activity stops.
4. Retryable response disposal and auth-refresh response-body handling.
5. URL/query encoding, header handling, empty and malformed responses, offline behavior, and error shapes.
6. Cache cloning with and without `structuredClone`, using the actual value types clients store.
7. TypeScript compilation and Metro resolution of the package's ESM `exports` at the minimum supported version.

Keep Vitest for fast unit-level behavior. Add device-level checks for platform integration rather than replacing unit tests with excessive mocks.

## Proposed implementation plan

1. Declare the minimum supported React Native/Hermes range and whether cookie-authenticated requests are supported.
2. Build the consumer fixture and establish iOS/Android Hermes CI or a repeatable local validation process.
3. Verify `credentials: "omit"` behavior. If cookies are not reliably excluded, disable caching/deduplication for such requests in React Native or redesign the eligibility contract.
4. Validate bearer-token redirects and native abort semantics; adjust implementation only in response to demonstrated runtime behavior.
5. Validate response-body cancellation and `structuredClone` fallback behavior in Hermes.
6. Measure cache memory growth under sustained unique-key traffic and add bounded eviction only if measurements show it is needed.
7. Validate Metro package exports and TypeScript compatibility at the declared minimum and current React Native versions.

## References

- React Native networking and documented Fetch limitations: <https://reactnative.dev/docs/network>
- React Native Fetch global: <https://reactnative.dev/docs/global-fetch>
- React Native AbortController global: <https://reactnative.dev/docs/global-AbortController>
- React Native URL global: <https://reactnative.dev/docs/global-URL>
- React Native URLSearchParams global: <https://reactnative.dev/docs/global-URLSearchParams>
- React Native timers: <https://reactnative.dev/docs/timers>
- React Native Hermes: <https://reactnative.dev/docs/hermes>
- Metro package exports: <https://metrobundler.dev/docs/package-exports>
