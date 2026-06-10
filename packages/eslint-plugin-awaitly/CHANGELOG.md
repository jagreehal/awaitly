# eslint-plugin-awaitly

## 1.1.1

### Patch Changes

- 0b6f723: chore: update dependencies + migrate to vite 8

  Minor/patch dependency refresh via npm-check-updates (`--target minor`, 3-day publish cooldown) — no major version bumps. Forced `vite ^8` across the workspace via a pnpm override (vitest already supports it). TypeScript stays on 5.x and eslint on 9.x (their majors are deliberately deferred).

## 1.0.0

### Major Changes

- c35805a: **Tooling alignment with the AI-DX slug spine.** Lint, analyzer, and visualizer now share the canonical slug namespace from `awaitly/slugs`, so a runtime error code, an ESLint rule name, and an analyzer diagnostic code are the same identifier — one token, every surface.

  ### `eslint-plugin-awaitly` (major)

  **Breaking — all rules renamed to canonical slugs:**

  | Old name                          | New name                              |
  | --------------------------------- | ------------------------------------- |
  | `awaitly/no-immediate-execution`  | `awaitly/step-no-immediate-execution` |
  | `awaitly/require-step-id`         | `awaitly/step-require-id`             |
  | `awaitly/require-thunk-for-key`   | `awaitly/step-require-thunk-for-key`  |
  | `awaitly/stable-cache-keys`       | `awaitly/step-stable-cache-keys`      |
  | `awaitly/no-floating-workflow`    | `awaitly/workflow-no-floating`        |
  | `awaitly/no-floating-result`      | `awaitly/result-no-floating`          |
  | `awaitly/require-result-handling` | `awaitly/result-require-handling`     |
  | `awaitly/no-options-on-executor`  | `awaitly/workflow-options-position`   |
  | `awaitly/no-double-wrap-result`   | `awaitly/result-no-double-wrap`       |
  | `awaitly/no-dynamic-import`       | `awaitly/workflow-no-dynamic-import`  |

  No legacy aliases. Update your `eslint.config.js` rule names.

  **Added:** 10 new rules covering gaps the patterns guide previously asserted only in prose.

  - `step-no-bare-await` — disallows bare `await deps.fn()` inside workflow callbacks
  - `step-no-try-catch-wrap` — disallows wrapping `step()` in `try/catch`; use `step.try()`
  - `workflow-callback-shape` — requires `({ step })` (or superset) on workflow callbacks
  - `workflow-no-callable-form` — disallows `workflow(callback)`; use `workflow.run(...)`
  - `concurrency-no-promise-all` — replace `Promise.all` with `step.all` / `step.map`
  - `concurrency-no-promise-race` — replace `Promise.race` with `step.race`
  - `concurrency-no-promise-allsettled` — replace `Promise.allSettled` with `step.map`
  - `result-no-manual-propagation` — disallows `return ok()/err()` inside workflow callbacks (scope-guarded; deps functions and step thunks are unaffected)
  - `result-no-direct-ok-err` — disallows `ok()`/`err()` calls inside workflow callbacks (same scope guard)
  - `error-check-unexpected-first` — heuristic warn for `if (result.error._tag === ...)` without an `isUnexpectedError` guard. **Deliberately not in `recommended` or `recommended-strict`** — opt-in only.

  **Added:** `recommended-strict` config — same rules as `recommended` but with `result-require-handling` upgraded from `warn` to `error` for CI gating.

  ### `awaitly-analyze` (minor)

  **Added:** `--doctor` CLI flag emits slug-keyed strict-mode diagnostics with `code`, `hint`, and `docsUrl` fields. `--format=json` produces structured output for CI/tooling integration.

  ```bash
  awaitly-analyze ./src/workflows/checkout.ts --doctor --format=json
  ```

  **Added:** `STRICT_RULE_TO_SLUG` exported from `awaitly-analyze` — maps internal strict-rule names to canonical awaitly slugs. Used by cross-surface parity tests to prevent drift.

  **Internal:** `StrictDiagnostic` shape gains `code: AwaitlySlug`, `hint: string`, `docsUrl: string` fields imported from `awaitly/slugs`.

  ### `awaitly-visualizer` (patch)

  `step_error` and `workflow_error` events preserve the new `code`, `hint`, and `docsUrl` fields on the error payload. No public API change — the visualizer just passes through the awaitly error shape it receives. Renderers and downstream tooling now have access to the canonical slug for filtering, deep-linking, and analytics.

## 0.17.0

### Minor Changes

- ed7d7ef: Minor updates across awaitly packages: core library, analyzers, visualizer, database adapters (postgres, libsql, mongo), ESLint plugin, and docs.

## 0.16.0

### Minor Changes

- e08ccd0: - **awaitly**: `step.workflow()`, `step.withFallback()`, and `step.withResource()` run through the cached step wrapper (events, cache, onAfterStep). `Workflow.run` / `runWithState` support optional `ExtraE` generic for error-union inference.
  - **awaitly-analyze**: Parser and DSL/Mermaid output support `step.workflow`, `step.withFallback`, and `step.withResource`. Child workflow refs invoked via `step.workflow("id", () => childWorkflow.run(...))` are detected and emitted as workflow-ref nodes; step.workflow steps get a "(Workflow)" label suffix.
  - **eslint-plugin-awaitly**: `require-step-id`, `no-immediate-execution`, `require-thunk-for-key`, `stable-cache-keys`, and `no-floating-result` now apply to `step.workflow`, `step.withFallback`, and `step.withResource`.
  - **docs**: Foundations (step.mdx) and ESLint plugin guide updated for the new step helpers; .claude skills (awaitly-patterns, awaitly-analyze) updated with Step Helpers table and analyzer notes.

## 0.15.0

### Minor Changes

- 7a97004: Refactor workflow API: spec-driven `workflow.run` with call-time dependency injection

  - **awaitly**: Replaces `createWorkflow(name, deps, opts)` with a spec-driven API using `Step<F>()` tokens and call-time dependency injection. Adds `workflow.run()` and related types; introduces serialize-resume-state and store-contract for durable execution.
  - **awaitly-analyze**: Static analyzer and fixtures updated for the new workflow API and step signatures.
  - **awaitly-visualizer**: Decision tracker, devtools, event capture, and examples updated for the new workflow shape.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: Persistence adapters updated for new workflow types and run API.
  - **awaitly-docs**: Documentation and guides updated across foundations, comparison, guides, and reference to describe the new workflow API and migration.

## Unreleased

### Minor Changes

- **workflow.run() API and call-time dependency injection:** Plugin rules and docs updated for the spec-driven workflow API. Execution is via `workflow.run(fn, config?)` or `workflow.run(name, fn, config?)`; per-run options (including `deps` override for call-time injection) must come after the callback.
- **no-options-on-executor:** Detects wrong argument order when an options object is passed before the callback to `.run()` / `.runWithState()` (including named-run form `run(name, { ... }, callback)`). Adds `deps` to detected option keys. Error messages now point to `workflow.run(callback, config)` ordering.
- **no-double-wrap-result:** Unchanged behavior; already recognizes `createWorkflow(...).run(...)` and `createWorkflow(...).run(name, callback)`; documents known limitation for variable-based `workflow.run()` (no data flow analysis).
- **README:** no-options-on-executor section updated with workflow.run() examples and per-run config (deps, onEvent).

## 0.14.0

### Minor Changes

- fe5dddf: - **awaitly**: Improved fetch helpers with typed errors (FetchNetworkError, FetchHttpError, FetchParseError, FetchDecodeError, FetchAbortError, FetchTimeoutError), options for timeout, custom error body/error mapping, retry, and for `fetchJson` optional decode and strict Content-Type; added `fetchResponse` export.
  - **eslint-plugin-awaitly**: New rule `no-dynamic-import` to disallow dynamic import() and require(); rule and test updates for no-immediate-execution, require-result-handling, require-thunk-for-key, and stable-cache-keys.
  - **awaitly-analyze**: Updates to ts-morph loader.
  - **awaitly-docs**: Extending Awaitly guide updated to reflect fetch helper patterns.

## 0.13.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

## 0.12.0

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

## 0.11.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

## 0.10.0

### Minor Changes

- 6119f95: Saga step names: require a string name as the first argument to `saga.step()` and `saga.tryStep()` for observability and compensation tracking. Runtime validation rejects empty or non-string names with clear errors. ESLint rule `require-step-id` and static analyzer updated to enforce and analyze step names.

## 0.9.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

## 0.8.0

### Minor Changes

- 1830163: **Step IDs for workflows and steps**

  - **awaitly**: Workflow execution and snapshots now use explicit step IDs. Steps and helpers (`step()`, `step.sleep()`, `step.retry()`, `step.withTimeout()`, `step.try()`, `step.fromResult()`) accept an optional string literal as the first argument for durable execution, resumption, and observability.
  - **eslint-plugin-awaitly**: New rule `require-step-id` enforces that all step calls use a string literal step ID as the first argument.
  - **awaitly-analyze**: Static workflow IR and analyzer updated to support step IDs.
  - **awaitly-visualizer**: IR builder updated for step ID support.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: README and docs updated for step IDs.
  - **awaitly-docs**: Documentation updated across foundations, guides, and reference for step IDs and the new ESLint rule.

## 0.7.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

## 0.6.0

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

## 0.5.0

### Minor Changes

- e9396f1: ### New Features

  - **Persistence Adapters**: Added `awaitly-mongo` and `awaitly-postgres` packages for MongoDB and PostgreSQL persistence with automatic schema creation, TTL support, and connection pooling
  - **Functional Utilities**: New `awaitly/functional` entry point with Effect-inspired utilities including `pipe`, `map`, `flatMap`, `match`, and collection combinators for Result type composition
  - **ESLint Rule**: Added `no-double-wrap-result` rule to detect and prevent double-wrapping Result types in workflow executors

  ### Improvements

  - Enhanced static analyzer with improved workflow detection and analysis
  - Expanded documentation with guides for MongoDB/PostgreSQL persistence, functional utilities, and AI integration patterns

## 0.4.0

### Minor Changes

- b589cb2: Add comprehensive documentation for `bindDeps` utility

  - Added `bindDeps` to API reference with usage examples
  - Created new "Dependency Binding" guide covering the `fn(args, deps)` pattern
  - Added guide to navigation sidebar
  - Includes examples for Express, React, Next.js integration
  - Updated `.gitignore` to exclude `.astro/` build directory

## 0.3.0

### Minor Changes

- e439143: - Add `awaitly/cache` memoization utilities and `awaitly/errors` prebuilt tagged error types.
  - Expand workflow reliability + orchestration (rate limiting/concurrency helpers, improved caching/resume behavior, and workflow cancellation/hooks).
  - Improve `awaitly-analyze` static analysis + Mermaid rendering, and extend `eslint-plugin-awaitly` with rules to prevent floating Results/workflows and require Result handling.
  - Update docs for rate limiting, retries/timeouts, troubleshooting, and workflow comparisons.

## 0.2.0

### Minor Changes

- cc6ebff: - Add browser-compatible static analysis via `awaitly-analyze/browser` (fetch-based WASM loading with configurable base path).
  - Improve static analysis coverage (detect `run()` calls, conditionals/loops/parallel/race patterns) and capture `createWorkflow` docs (`description`, `markdown`) for richer diagrams.
  - Add `eslint-plugin-awaitly` to catch common workflow mistakes (immediate execution, missing thunks for keyed steps, unstable cache keys).
  - Improve `awaitly` workflow DX: `STEP_TIMEOUT` is returned as a typed error (not wrapped) and workflows can include docs metadata for static analysis.
