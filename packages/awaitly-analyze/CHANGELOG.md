# awaitly-analyze

## 0.16.0

### Minor Changes

- 2fae4a4: - Add render-md-mermaid GitHub workflow and tests
  - Add payment flow diagram fixture and tests
  - Update docs, DSL, HTML, and Mermaid output; static analyzer and types

### Patch Changes

- Updated dependencies [2fae4a4]
  - awaitly-visualizer@16.0.0
  - awaitly@1.27.0

## 0.15.0

### Minor Changes

- fe5dddf: - **awaitly**: Improved fetch helpers with typed errors (FetchNetworkError, FetchHttpError, FetchParseError, FetchDecodeError, FetchAbortError, FetchTimeoutError), options for timeout, custom error body/error mapping, retry, and for `fetchJson` optional decode and strict Content-Type; added `fetchResponse` export.
  - **eslint-plugin-awaitly**: New rule `no-dynamic-import` to disallow dynamic import() and require(); rule and test updates for no-immediate-execution, require-result-handling, require-thunk-for-key, and stable-cache-keys.
  - **awaitly-analyze**: Updates to ts-morph loader.
  - **awaitly-docs**: Extending Awaitly guide updated to reflect fetch helper patterns.

### Patch Changes

- Updated dependencies [fe5dddf]
  - awaitly@1.26.0
  - awaitly-visualizer@15.0.0

## 0.14.1

### Patch Changes

- Updated dependencies [5eec7cc]
  - awaitly@1.25.0
  - awaitly-visualizer@14.0.0

## 0.14.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

### Patch Changes

- Updated dependencies [c3a9f08]
  - awaitly-visualizer@13.0.0
  - awaitly@1.24.0

## 0.13.0

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

### Patch Changes

- Updated dependencies [98f110a]
  - awaitly@1.23.0
  - awaitly-visualizer@12.0.0

## 0.12.2

### Patch Changes

- Updated dependencies [84bfb7a]
  - awaitly@1.22.0
  - awaitly-visualizer@11.0.0

## 0.12.1

### Patch Changes

- Updated dependencies [f68ccdb]
  - awaitly@1.21.0
  - awaitly-visualizer@10.0.0

## 0.12.0

### Minor Changes

- dceec3d: - **awaitly**: Add workflow hook primitive. Suspend a workflow until your app receives an HTTP callback, then resume with the callback payload using `injectHook()`. New exports: `pendingHook`, `createHook`, `injectHook`, `isPendingHook`, `hasPendingHook`, `getPendingHooks`, and the `PendingHook` type. Server-agnostic: you own the callback URL and call `injectHook(state, { hookId, value })` when the request arrives.
  - **awaitly-analyze**: Static analyzer and test updates.

### Patch Changes

- Updated dependencies [dceec3d]
  - awaitly@1.20.0
  - awaitly-visualizer@9.0.0

## 0.11.0

### Minor Changes

- 69c2fa8: - **awaitly-analyze**: Static analyzer enhancements (path generation, complexity metrics, Mermaid output), kitchen-sink fixtures, and fixture tsconfig for type-checking test sources.
  - **awaitly-docs**: Astro and content config updates for docs site.

## 0.10.1

### Patch Changes

- 226b841: Publish awaitly-analyze as a public package (remove private flag).

## 0.10.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

### Patch Changes

- Updated dependencies [34022b8]
  - awaitly-visualizer@8.0.0
  - awaitly@1.19.0

## 0.9.0

### Minor Changes

- 6119f95: Saga step names: require a string name as the first argument to `saga.step()` and `saga.tryStep()` for observability and compensation tracking. Runtime validation rejects empty or non-string names with clear errors. ESLint rule `require-step-id` and static analyzer updated to enforce and analyze step names.

## 0.8.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

## 0.7.0

### Minor Changes

- d4cd1ac: Add example-nextjs verification playground: Next.js App Router app that proves the framework-integration docs using awaitly workflows, Drizzle (libsql/SQLite), and TanStack Query. Includes Server Action signup, API route signup, and Get user (React Query + ResultError) with typed error handling. README updated with setup, run, and layout.

## 0.6.0

### Minor Changes

- 1830163: **Step IDs for workflows and steps**

  - **awaitly**: Workflow execution and snapshots now use explicit step IDs. Steps and helpers (`step()`, `step.sleep()`, `step.retry()`, `step.withTimeout()`, `step.try()`, `step.fromResult()`) accept an optional string literal as the first argument for durable execution, resumption, and observability.
  - **eslint-plugin-awaitly**: New rule `require-step-id` enforces that all step calls use a string literal step ID as the first argument.
  - **awaitly-analyze**: Static workflow IR and analyzer updated to support step IDs.
  - **awaitly-visualizer**: IR builder updated for step ID support.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: README and docs updated for step IDs.
  - **awaitly-docs**: Documentation updated across foundations, guides, and reference for step IDs and the new ESLint rule.

## 0.5.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

## 0.4.0

### Minor Changes

- 6da0d57: - **awaitly-docs**: Restructure docs from `concepts/` to `foundations/` (step, workflows, tagged-errors, results). Content and link updates across getting-started, guides, comparison, and reference. Move `functional-utilities` to guides.
  - **awaitly-analyze**: CLI updates, README updates, and new CLI tests.

## 0.3.0

### Minor Changes

- dcef438: - **awaitly-analyze**: Static analyzer updates (schema, CLI/scripts, JSDoc fixtures, types). Improves workflow analysis and output structure.
  - **awaitly-docs**: New "Documenting workflows" guide, static analysis docs updates, API reference updates, and typedoc-based API generation.

## 0.2.0

### Minor Changes

- 9faf6ac: - **awaitly-analyze**: Switch to ts-morph-based static analysis; add CLI, complexity metrics, composition resolver, path generator, and JSON/Mermaid/test-matrix output. Remove tree-sitter and browser/playground code.
  - **awaitly-docs**: Update static analysis guide and API reference for ts-morph analyzer; remove playground page and related assets.
