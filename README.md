# Nexora

A TypeScript-first data and API toolkit for mobile applications.

## Status

Nexora is under active development and is **not ready for use**. There is no public API yet, and nothing has been published to npm.

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
