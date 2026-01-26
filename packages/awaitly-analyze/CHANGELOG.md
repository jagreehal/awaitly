# awaitly-analyze

## 4.0.0

### Minor Changes

- b589cb2: Add comprehensive documentation for `bindDeps` utility

  - Added `bindDeps` to API reference with usage examples
  - Created new "Dependency Binding" guide covering the `fn(args, deps)` pattern
  - Added guide to navigation sidebar
  - Includes examples for Express, React, Next.js integration
  - Updated `.gitignore` to exclude `.astro/` build directory

### Patch Changes

- Updated dependencies [b589cb2]
  - awaitly@1.9.0

## 3.0.0

### Minor Changes

- e439143: - Add `awaitly/cache` memoization utilities and `awaitly/errors` prebuilt tagged error types.
  - Expand workflow reliability + orchestration (rate limiting/concurrency helpers, improved caching/resume behavior, and workflow cancellation/hooks).
  - Improve `awaitly-analyze` static analysis + Mermaid rendering, and extend `eslint-plugin-awaitly` with rules to prevent floating Results/workflows and require Result handling.
  - Update docs for rate limiting, retries/timeouts, troubleshooting, and workflow comparisons.

### Patch Changes

- Updated dependencies [e439143]
  - awaitly@1.8.0

## 2.0.0

### Minor Changes

- cc6ebff: - Add browser-compatible static analysis via `awaitly-analyze/browser` (fetch-based WASM loading with configurable base path).
  - Improve static analysis coverage (detect `run()` calls, conditionals/loops/parallel/race patterns) and capture `createWorkflow` docs (`description`, `markdown`) for richer diagrams.
  - Add `eslint-plugin-awaitly` to catch common workflow mistakes (immediate execution, missing thunks for keyed steps, unstable cache keys).
  - Improve `awaitly` workflow DX: `STEP_TIMEOUT` is returned as a typed error (not wrapped) and workflows can include docs metadata for static analysis.

### Patch Changes

- Updated dependencies [cc6ebff]
  - awaitly@1.7.0

## 1.1.0

### Minor Changes

- c122ea2: Fix CJS/ESM dual module support and add awaitly peer dependency

  - Fix `import.meta.url` issue in tree-sitter-loader.ts that caused CJS builds to fail
  - Package now works correctly with both `require()` and `import`
  - Add `awaitly` as a peer dependency to document the relationship
