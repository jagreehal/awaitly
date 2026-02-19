# awaitly-docs

## 1.25.0

### Minor Changes

- fe5dddf: - **awaitly**: Improved fetch helpers with typed errors (FetchNetworkError, FetchHttpError, FetchParseError, FetchDecodeError, FetchAbortError, FetchTimeoutError), options for timeout, custom error body/error mapping, retry, and for `fetchJson` optional decode and strict Content-Type; added `fetchResponse` export.
  - **eslint-plugin-awaitly**: New rule `no-dynamic-import` to disallow dynamic import() and require(); rule and test updates for no-immediate-execution, require-result-handling, require-thunk-for-key, and stable-cache-keys.
  - **awaitly-analyze**: Updates to ts-morph loader.
  - **awaitly-docs**: Extending Awaitly guide updated to reflect fetch helper patterns.

## 1.24.0

### Minor Changes

- 5eec7cc: Use string constant for unexpected errors; improve tsconfig and docs

  - **awaitly:** `run()` and workflows without custom `catchUnexpected` now return the string `"UNEXPECTED_ERROR"` for uncaught exceptions instead of an `UnexpectedError` object. The thrown value is preserved in `result.cause`. `isUnexpectedError()` and `matchError()` accept both the string and the legacy object shape. Added `tsconfig.quality.json`; main tsconfig no longer excludes test files from typecheck.
  - **awaitly-docs:** Updated foundations and getting-started docs for the new error model; fixed Astro check (config and AnimatedWorkflowDiagram types).

## 1.23.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

## 1.22.0

### Minor Changes

- 98f110a: ### Effect-style step helpers

  - **step.run(id, result | getter, options?)** — Unwrap AsyncResult with step tracking. In createWorkflow, use a getter when using a key so cache hits don't run the operation.
  - **step.andThen(id, value, fn, options?)** — Chain from a success value into another AsyncResult-returning operation.
  - **step.match(id, result, { ok, err }, options?)** — Pattern match on Result with step tracking; now runs through the step engine (emits step_start/step_success, respects options).
  - **step.all(id, shape, options?)** — Alias for step.parallel; named parallel results. In createWorkflow, only caches when an explicit `key` is provided (no cache by step id when key omitted).
  - **step.map(id, items, mapper, options?)** — Parallel over array with step tracking. In createWorkflow, only caches when an explicit `key` is provided (no cache by step id when key omitted).

  All of these run through the full step engine (events, retry, timeout; in createWorkflow: cache and onAfterStep when key is used). API is aligned with Effect as close as possible while using async/await instead of generators.

  ### createWorkflow cache and lifecycle

  - **run, andThen, match, all, map** now route through the cached step wrapper so keyed calls use the workflow cache and onAfterStep (previously they bypassed the cache).
  - **step.run** accepts either a promise or a getter `() => AsyncResult`; use a getter when caching so the operation runs only on cache miss.
  - **step.all** and **step.map** only use the cache when you pass `{ key: '...' }`; omitted key means no cache (matches core run() semantics).

  ### eslint-plugin-awaitly

  - **require-step-id:** Enforces string literal first argument for step.run, step.andThen, step.match, step.all, step.map.
  - **no-floating-result:** Flags discarded results from step.run, step.andThen, step.match, step.all, step.map.
  - **no-immediate-execution:** step.run(id, promise) reported; autofix wraps in getter. Id-first step helpers (e.g. step.retry('id', fn)) now use second argument as executor for checking.
  - **require-thunk-for-key:** step.run with key requires getter (second argument) so cache hits don't run the operation.
  - README and rule docs updated to list the new helpers.

  ### Docs and skills

  - **Docs site:** Foundations (step.mdx) Effect-style ergonomics section; guides (caching, migration); comparison (awaitly-vs-effect) expanded with side-by-side Effect-style helpers; patterns (parallel-operations); reference (quick-reference); control-flow.
  - **Comparison:** "As close as we can get while still using async/await and not generators" messaging.
  - **.claude/skills/awaitly-patterns:** Step helpers table and concurrency section updated; Effect-style paragraph and caching semantics; options table; disallowed entry for step.run with key without getter.

## 1.21.0

### Minor Changes

- 84bfb7a: - **awaitly**: Add `awaitly/result` subpath export for minimal bundle; improve JSDoc in core, workflow, and webhook modules; export all main API on `Awaitly` namespace alongside existing named exports.
  - **awaitly-docs**: Document `awaitly/result` in installation and API reference; update comparison docs (vs neverthrow, try/catch, promise, effect, Vercel Workflow) to use `Awaitly.*` namespace (e.g. `Awaitly.ok`, `Awaitly.err`); fix API generator dedupe and truncation.

## 1.20.0

### Minor Changes

- f68ccdb: ### createWorkflow introspection (WorkflowClass parity)

  - **createWorkflow return value** is a workflow object with a single `.run(name?, fn, config?)` method. Persistence uses `createResumeStateCollector` + `onEvent` and `collector.getResumeState()`; restore via `workflow.run(fn, { resumeState })` or creation-time `resumeState`.
  - **WorkflowSnapshot** gains optional `workflowName` (set by the engine when creating a snapshot).
  - **awaitly/core** exports `matchWhen` and type `MatchTag` for tagged-union pattern matching.

  ### Docs

  - API reference: Workflow instance (createWorkflow return value) and Pattern matching (awaitly/core). Foundations and quick reference updated. Functional utilities guide links to core pattern matching.

  ### Tests and quality

  - **awaitly-postgres**, **awaitly-mongo**: Integration tests skip when the database is unavailable (beforeAll connection check + `it.skipIf`), so `pnpm quality` passes without a running Postgres/Mongo.

## 1.19.0

### Minor Changes

- dceec3d: - **awaitly**: Add workflow hook primitive. Suspend a workflow until your app receives an HTTP callback, then resume with the callback payload using `injectHook()`. New exports: `pendingHook`, `createHook`, `injectHook`, `isPendingHook`, `hasPendingHook`, `getPendingHooks`, and the `PendingHook` type. Server-agnostic: you own the callback URL and call `injectHook(state, { hookId, value })` when the request arrives.
  - **awaitly-analyze**: Static analyzer and test updates.

## 1.18.0

### Minor Changes

- 69c2fa8: - **awaitly-analyze**: Static analyzer enhancements (path generation, complexity metrics, Mermaid output), kitchen-sink fixtures, and fixture tsconfig for type-checking test sources.
  - **awaitly-docs**: Astro and content config updates for docs site.

## 1.17.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

## 1.16.0

### Minor Changes

- 6119f95: Saga step names: require a string name as the first argument to `saga.step()` and `saga.tryStep()` for observability and compensation tracking. Runtime validation rejects empty or non-string names with clear errors. ESLint rule `require-step-id` and static analyzer updated to enforce and analyze step names.

## 1.15.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

## 1.14.0

### Minor Changes

- d4cd1ac: Add example-nextjs verification playground: Next.js App Router app that proves the framework-integration docs using awaitly workflows, Drizzle (libsql/SQLite), and TanStack Query. Includes Server Action signup, API route signup, and Get user (React Query + ResultError) with typed error handling. README updated with setup, run, and layout.

## 1.13.0

### Minor Changes

- 1830163: **Step IDs for workflows and steps**

  - **awaitly**: Workflow execution and snapshots now use explicit step IDs. Steps and helpers (`step()`, `step.sleep()`, `step.retry()`, `step.withTimeout()`, `step.try()`, `step.fromResult()`) accept an optional string literal as the first argument for durable execution, resumption, and observability.
  - **eslint-plugin-awaitly**: New rule `require-step-id` enforces that all step calls use a string literal step ID as the first argument.
  - **awaitly-analyze**: Static workflow IR and analyzer updated to support step IDs.
  - **awaitly-visualizer**: IR builder updated for step ID support.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: README and docs updated for step IDs.
  - **awaitly-docs**: Documentation updated across foundations, guides, and reference for step IDs and the new ESLint rule.

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
