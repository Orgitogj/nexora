# Nexora

A TypeScript-first data and API toolkit for mobile applications.

## Status

Nexora is under active development and is **not ready for use**. There is no public API yet, and nothing has been published to npm.

## HTTP caching and deduplication

The HTTP client only caches or deduplicates requests when their credentials mode is explicitly set to `"omit"`. This prevents responses from being shared across requests authenticated by ambient cookies. Set `credentials: "omit"` in the client or request configuration when the endpoint is safe to call without credentials.

Requests with custom headers are not cached or deduplicated because the client cannot determine whether a server varies its response by those headers. Responses with `Cache-Control: no-store`, `Vary: *`, or a `Vary` field other than `Accept` or `Accept-Language` are not stored.

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
