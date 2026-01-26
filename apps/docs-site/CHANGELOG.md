# awaitly-docs

## 1.3.0

### Minor Changes

- b589cb2: Add comprehensive documentation for `bindDeps` utility

  - Added `bindDeps` to API reference with usage examples
  - Created new "Dependency Binding" guide covering the `fn(args, deps)` pattern
  - Added guide to navigation sidebar
  - Includes examples for Express, React, Next.js integration
  - Updated `.gitignore` to exclude `.astro/` build directory

### Patch Changes

- Updated dependencies [b589cb2]
  - awaitly-analyze@4.0.0

## 1.2.0

### Minor Changes

- a21037f: Add a new “The Basics” getting-started guide and refresh the installation + first workflow docs, including updated sidebar navigation and local dev base-path notes.

## 1.1.1

### Patch Changes

- 29e01e0: Show logo in docs

## 1.1.0

### Minor Changes

- e439143: - Add `awaitly/cache` memoization utilities and `awaitly/errors` prebuilt tagged error types.
  - Expand workflow reliability + orchestration (rate limiting/concurrency helpers, improved caching/resume behavior, and workflow cancellation/hooks).
  - Improve `awaitly-analyze` static analysis + Mermaid rendering, and extend `eslint-plugin-awaitly` with rules to prevent floating Results/workflows and require Result handling.
  - Update docs for rate limiting, retries/timeouts, troubleshooting, and workflow comparisons.

### Patch Changes

- Updated dependencies [e439143]
  - awaitly-analyze@3.0.0

## 1.0.1

### Patch Changes

- Updated dependencies [cc6ebff]
  - awaitly-analyze@2.0.0
