# awaitly-docs

## 1.12.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

## 1.11.0

### Minor Changes

- 6da0d57: - **awaitly-docs**: Restructure docs from `concepts/` to `foundations/` (step, workflows, tagged-errors, results). Content and link updates across getting-started, guides, comparison, and reference. Move `functional-utilities` to guides.
  - **awaitly-analyze**: CLI updates, README updates, and new CLI tests.

## 1.10.0

### Minor Changes

- dcef438: - **awaitly-analyze**: Static analyzer updates (schema, CLI/scripts, JSDoc fixtures, types). Improves workflow analysis and output structure.
  - **awaitly-docs**: New "Documenting workflows" guide, static analysis docs updates, API reference updates, and typedoc-based API generation.

## 1.9.0

### Minor Changes

- 9faf6ac: - **awaitly-analyze**: Switch to ts-morph-based static analysis; add CLI, complexity metrics, composition resolver, path generator, and JSON/Mermaid/test-matrix output. Remove tree-sitter and browser/playground code.
  - **awaitly-docs**: Update static analysis guide and API reference for ts-morph analyzer; remove playground page and related assets.

## 1.8.1

### Patch Changes

- c9924c7: - **awaitly-visualizer**: Add `./devtools` export with `createDevtools`, `quickVisualize`, `createConsoleLogger`, and `renderDiff` for timeline visualization, run comparison, and console logging from a single entry point.
  - **awaitly-docs**: Document `awaitly-visualizer/devtools` in the visualization guide and API reference; add devtools usage examples and migration note from `awaitly/devtools`.
  - **awaitly-postgres**: (version bump only; no code changes in this changeset)

## 1.8.0

### Minor Changes

- 6114dd9: Split workflow visualization and devtools out of the main `awaitly` package into a new `awaitly-visualizer` package. The core package no longer ships visualize/devtools entry points; use `awaitly-visualizer` for Mermaid diagrams, ASCII art, HTML rendering, Kroki integration, and Slack/Discord/webhook notifiers. Persistence packages (`awaitly-postgres`, `awaitly-libsql`, `awaitly-mongo`) gain dedicated lock modules. Docs and browser-test app updated for the new layout.

### Patch Changes

- Updated dependencies [6114dd9]
  - awaitly-analyze@8.0.0

## 1.7.0

### Minor Changes

- 5f2ff00: Split `run()` function into separate entry point (`awaitly/run`) for better tree-shaking and bundle size optimization. The main `awaitly` package now exports only Result types and utilities, while `run()` and its related types (`RunStep`, `RunOptions`, `StepTimeoutError`, etc.) are available via `awaitly/run`. This allows users who only need Result types to import a smaller bundle without the step orchestration overhead.

  **What changed:**

  - `run()` is now available from `awaitly/run` entry point
  - Main `awaitly` entry point no longer exports `run()` (only Result types)
  - Related types (`RunStep`, `RunOptions`, `StepTimeoutError`, etc.) moved to `awaitly/run`
  - Documentation updated to reflect new import paths

  **Migration:**

  ```typescript
  // Before
  import { run } from "awaitly";

  // After (recommended)
  import { run } from "awaitly/run";
  import { ok, err, type AsyncResult } from "awaitly";

  // Or import both from their respective entry points
  import { run, type RunStep } from "awaitly/run";
  import { ok, err } from "awaitly";
  ```

  This change improves bundle size for users who only need Result types, while keeping `run()` easily accessible for those who need step-based composition.

### Patch Changes

- Updated dependencies [5f2ff00]
  - awaitly-analyze@7.0.0

## 1.6.0

### Minor Changes

- e9396f1: ### New Features

  - **Persistence Adapters**: Added `awaitly-mongo` and `awaitly-postgres` packages for MongoDB and PostgreSQL persistence with automatic schema creation, TTL support, and connection pooling
  - **Functional Utilities**: New `awaitly/functional` entry point with Effect-inspired utilities including `pipe`, `map`, `flatMap`, `match`, and collection combinators for Result type composition
  - **ESLint Rule**: Added `no-double-wrap-result` rule to detect and prevent double-wrapping Result types in workflow executors

  ### Improvements

  - Enhanced static analyzer with improved workflow detection and analysis
  - Expanded documentation with guides for MongoDB/PostgreSQL persistence, functional utilities, and AI integration patterns

### Patch Changes

- Updated dependencies [e9396f1]
  - awaitly-analyze@6.0.0

## 1.5.0

### Minor Changes

- 826eb3a: Add browser support for workflow visualization module. The `awaitly/visualize` export now includes a browser-safe version that excludes Node.js-specific features (`createDevServer`, `createLiveVisualizer`) and provides all visualization capabilities (ASCII, Mermaid, HTML rendering, decision tracking, performance analysis) for browser environments. Node.js-specific features throw helpful errors when called in the browser.

### Patch Changes

- awaitly-analyze@5.0.0

## 1.4.0

### Minor Changes

- 524ad8b: Add Foundations section and Vercel Workflow comparison

  - Add new "Foundations" documentation section covering Result types, workflows, control flow, error handling, state/resumption, and streaming
  - Add comparison page for awaitly vs Vercel Workflow SDK

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
