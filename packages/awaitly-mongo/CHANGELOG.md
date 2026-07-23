# awaitly-mongo

## 27.0.0

### Major Changes

- 327f227: Replace the workflow production umbrella with task-shaped `run`, `reliability`, `durable`, `persistence`, `saga`, `hitl`, `streaming`, `webhook`, and `engine` entry points. Persistence adapters now consume the dedicated persistence contract instead of the workflow runtime.

### Patch Changes

- Updated dependencies [327f227]
  - awaitly@3.0.0

## 26.0.0

### Minor Changes

- e13d94e: The canonical core: 36 entry points become 4, one way to write everything.

  **Breaking — entry points.** The exports map is now exactly:

  | Entry              | Contents                                                                                                                                                                                                                                                                        |
  | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `awaitly`          | The front door: Result primitives, `run()` + step engine, per-dep policies, `TaggedError`, pre-built errors, pattern matching (`Match`, `matchValue`), durations, circuit breaker, rate limiting, cache, singleflight, declarative conditionals (`when`/`unless`), slug runtime |
  | `awaitly/result`   | The size guarantee: Result primitives only — the whole entry minifies under ~10KB with zero bundler trust required                                                                                                                                                              |
  | `awaitly/workflow` | The production tier: `createWorkflow`, durable execution, persistence, human-in-the-loop, sagas, streaming, webhooks, engine, resources, batching                                                                                                                               |
  | `awaitly/testing`  | Test utilities                                                                                                                                                                                                                                                                  |

  Migration map for removed sub-paths: `result`/`run`/`core`/`errors`/`tagged-error`/`match`/`duration`/`circuit-breaker`/`ratelimit`/`cache`/`singleflight`/`policies`/`conditional`/`slugs` → `awaitly`; `durable`/`persistence`/`engine`/`hitl`/`saga`/`streaming`/`webhook`/`resource`/`batch` → `awaitly/workflow`. Resume-state versioning/migration helpers (`createVersionedState`, `createKeyRenameMigration`, `composeMigrations`, etc.) are exported from `awaitly/workflow`. Deleted without absorption: `flow`, `functional` (pipe/compose), `bind-deps`, `resolver`, `diagnostics`, `reliability` (umbrella), `otel`/`fetch`/`adapters` (future ecosystem packages), and the Schedule combinators from `awaitly/retry` (name clashes with Result combinators; per-dep policies cover retry/timeout).

  **Breaking — the `Awaitly` namespace object is removed**, along with root re-exports of `pipe`/`flow`/`compose`. One way to write it: named imports. The namespace was also the single biggest tree-shaking defeat — a runtime object holding every export materializes the whole module graph in every consumer bundle.

  **Bundle size — the claim is now enforced, not incidental.** dist ships unminified ESM (pre-minifying stripped `@__PURE__` annotations and rewrote patterns into unshakeable forms — that single setting cost every bundler consumer ~27KB on minimal imports). With the namespace gone, error classes PURE-annotated, and `run.strict` assembled without top-level mutation: `import { ok, err, isOk, isErr } from 'awaitly'` tree-shakes to ~4.6KB minified; the same from `awaitly/result` is ~3.3KB; `run` + policies is ~32KB. CI enforces all of these budgets.

  **One error model, one `match`.** The discriminant is `type` everywhere: string errors are unit variants matching themselves, tagged objects match on `type`, and `TaggedError` instances now expose `type` as the canonical discriminant (`_tag` remains as a deprecated alias through the migration window). `match(result, { ok, USER_NOT_FOUND, TimeoutError, UnexpectedError })` is exhaustive over the inferred union and dispatches across all shapes; the two-arm `{ ok, err }` form remains as the catch-all.

  **Per-dependency policies: `retry`, `timeout`, `fallback`.**

  - Policies are value-level function wrappers declared in the deps object — call sites stay pristine: `charge: retry(timeout(charge, 5000), { attempts: 3 })`.
  - Exact error-union math: `retry` preserves the union (the last failure propagates), `timeout` adds `TimeoutError`, `fallback` consumes the base union leaving only the handler's errors.
  - Plain (non-Result) functions are valid inputs: values normalize to `ok()`, throws keep throwing and surface as `UnexpectedError` at the run/workflow layer.
  - Wrappers preserve the base function's name, so workflow events and diagrams keep showing the dep name.
  - Exported from `awaitly`: `retry`, `timeout`, `fallback`, plus `RetryPolicyOptions`, `PolicyFn`, `PolicyDelay` types.

  **awaitly-analyze** — policy-aware static analysis, plus the diagrammability gate and runtime trace overlay:

  - Policy chains are read structurally from the deps literal: the analyzer unwraps to the base function for type extraction (error inference no longer depends on resolving wrapper generics), records the chain on `DependencyInfo.policies` (innermost first), and applies the same error-union math — diagrams can state "this edge retries 3× with a 5s timeout" as fact.
  - Diagrammability verdict with an `--assert-diagrammable` CI gate, and a runtime trace overlay that draws the executed path over the static skeleton.

  **eslint-plugin-awaitly** — always-on rules steering raw control flow (`if`/`throw`/`try`) toward the first-class constructs (`match`, tagged errors, `when`/`unless`).

### Patch Changes

- Updated dependencies [e13d94e]
- Updated dependencies [0f9e169]
- Updated dependencies [df3c0a2]
  - awaitly@2.0.0

## 25.0.0

### Patch Changes

- Updated dependencies [6789deb]
  - awaitly@1.35.0

## 23.0.0

### Patch Changes

- Updated dependencies [f4945cc]
  - awaitly@1.33.0

## 22.0.0

### Patch Changes

- f48a8e9: ### awaitly

  **UnexpectedError class migration** — Replace `UNEXPECTED_ERROR` string constant and plain object with an `UnexpectedError` TaggedError class. `isUnexpectedError()` now returns a proper type guard (`e is UnexpectedError`), `matchError` uses class-based keys, and `defaultCatchUnexpected` returns `new UnexpectedError({ cause })`. All error unions, resolvers, sagas, webhooks, and workflow types updated accordingly.

  **Workflow engine** — Add `createEngine()` (`awaitly/engine`) for durable workflow orchestration with configurable concurrency, polling, cron-style scheduling, and lifecycle events.

  **Input validation** — Add `validateInput()` using the Standard Schema spec (`@standard-schema/spec` optional peer dep) for schema validation with Zod, Valibot, or ArkType. Includes `InputValidationError` type and `isInputValidationError` guard.

  **Test runner** — Add `testWorkflow()` (`awaitly/testing`) for running real workflows with structured per-step result tracking and event capture without mocking.

  **Durable improvements** — Add `LeaseExpiredError`, `IdempotencyConflictError` error types with type guards, and `WorkflowLock.renew()` for lease extension.

  ### awaitly-analyze

  **Workflow diff engine** — Add `diffWorkflows()` for comparing two workflow IR snapshots with rename and move detection. Includes three renderers (markdown, JSON, Mermaid) and CLI support via `--diff` with local files, git refs (`main:src/wf.ts`), single-file HEAD comparison, and GitHub PR auto-discovery (`gh:#123`).

  **Railway diagrams** — Add railway-style Mermaid flowchart generation showing linear happy path with ok/err branching per step.

  ### awaitly-libsql / awaitly-mongo / awaitly-postgres

  Add `renew()` method to lock implementations for lease extension, supporting the new `WorkflowLock.renew()` interface.

- Updated dependencies [f48a8e9]
  - awaitly@1.32.0

## 21.0.0

### Patch Changes

- Updated dependencies [52cae14]
  - awaitly@1.31.0

## 20.0.0

### Minor Changes

- ed7d7ef: Minor updates across awaitly packages: core library, analyzers, visualizer, database adapters (postgres, libsql, mongo), ESLint plugin, and docs.

### Patch Changes

- Updated dependencies [ed7d7ef]
  - awaitly@1.30.0

## 19.1.0

### Minor Changes

- 102e866: - **awaitly-analyze**: Fix Mermaid diagram labels: normalize literal `\n` in `escapeLabel` so saga steps (e.g. "Notify (try)") and step annotations render on one line instead of showing backslash-n. Update tests to expect current dep-step label output (no "(dep: ...)" in diagram labels).

## 19.0.0

### Patch Changes

- Updated dependencies [e08ccd0]
  - awaitly@1.29.0

## 18.0.0

### Minor Changes

- 7a97004: Refactor workflow API: spec-driven `workflow.run` with call-time dependency injection

  - **awaitly**: Replaces `createWorkflow(name, deps, opts)` with a spec-driven API using `Step<F>()` tokens and call-time dependency injection. Adds `workflow.run()` and related types; introduces serialize-resume-state and store-contract for durable execution.
  - **awaitly-analyze**: Static analyzer and fixtures updated for the new workflow API and step signatures.
  - **awaitly-visualizer**: Decision tracker, devtools, event capture, and examples updated for the new workflow shape.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: Persistence adapters updated for new workflow types and run API.
  - **awaitly-docs**: Documentation and guides updated across foundations, comparison, guides, and reference to describe the new workflow API and migration.

### Patch Changes

- Updated dependencies [7a97004]
  - awaitly@1.28.0

## 17.0.0

### Patch Changes

- Updated dependencies [2fae4a4]
  - awaitly@1.27.0

## 16.0.0

### Patch Changes

- Updated dependencies [fe5dddf]
  - awaitly@1.26.0

## 15.0.0

### Patch Changes

- Updated dependencies [5eec7cc]
  - awaitly@1.25.0

## 14.0.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

### Patch Changes

- Updated dependencies [c3a9f08]
  - awaitly@1.24.0

## 13.0.0

### Patch Changes

- Updated dependencies [98f110a]
  - awaitly@1.23.0

## 12.0.0

### Patch Changes

- Updated dependencies [84bfb7a]
  - awaitly@1.22.0

## 11.0.0

### Patch Changes

- f68ccdb: ### createWorkflow introspection (WorkflowClass parity)

  - **createWorkflow return value** now exposes `name`, `deps`, `options`, and `snapshot` (read-only). Aligns with WorkflowClass for inspection and persistence. Use `workflow.snapshot` for one-off access or `workflow.getSnapshot()` when reusing. `deps` and `options` are frozen.
  - **WorkflowSnapshot** gains optional `workflowName` (set by the engine when creating a snapshot).
  - **awaitly/core** exports `matchWhen` and type `MatchTag` for tagged-union pattern matching.

  ### Docs

  - API reference: Workflow instance (createWorkflow return value) and Pattern matching (awaitly/core). Foundations and quick reference updated. Functional utilities guide links to core pattern matching.

  ### Tests and quality

  - **awaitly-postgres**, **awaitly-mongo**: Integration tests skip when the database is unavailable (beforeAll connection check + `it.skipIf`), so `pnpm quality` passes without a running Postgres/Mongo.

- Updated dependencies [f68ccdb]
  - awaitly@1.21.0

## 10.0.0

### Patch Changes

- Updated dependencies [dceec3d]
  - awaitly@1.20.0

## 9.1.0

### Minor Changes

- 69c2fa8: - **awaitly-analyze**: Static analyzer enhancements (path generation, complexity metrics, Mermaid output), kitchen-sink fixtures, and fixture tsconfig for type-checking test sources.
  - **awaitly-docs**: Astro and content config updates for docs site.

## 9.0.0

### Patch Changes

- Updated dependencies [34022b8]
  - awaitly@1.19.0

## 8.0.0

### Patch Changes

- Updated dependencies [6119f95]
  - awaitly@1.18.0

## 7.0.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

### Patch Changes

- Updated dependencies [afc8f6c]
  - awaitly@1.17.0

## 6.0.0

### Patch Changes

- Updated dependencies [d4cd1ac]
  - awaitly@1.16.0

## 5.0.0

### Minor Changes

- 1830163: **Step IDs for workflows and steps**

  - **awaitly**: Workflow execution and snapshots now use explicit step IDs. Steps and helpers (`step()`, `step.sleep()`, `step.retry()`, `step.withTimeout()`, `step.try()`, `step.fromResult()`) accept an optional string literal as the first argument for durable execution, resumption, and observability.
  - **eslint-plugin-awaitly**: New rule `require-step-id` enforces that all step calls use a string literal step ID as the first argument.
  - **awaitly-analyze**: Static workflow IR and analyzer updated to support step IDs.
  - **awaitly-visualizer**: IR builder updated for step ID support.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: README and docs updated for step IDs.
  - **awaitly-docs**: Documentation updated across foundations, guides, and reference for step IDs and the new ESLint rule.

### Patch Changes

- Updated dependencies [1830163]
  - awaitly@1.15.0

## 4.0.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

### Patch Changes

- Updated dependencies [f5957ad]
  - awaitly@1.14.0

## 3.0.0

### Minor Changes

- 6114dd9: Split workflow visualization and devtools out of the main `awaitly` package into a new `awaitly-visualizer` package. The core package no longer ships visualize/devtools entry points; use `awaitly-visualizer` for Mermaid diagrams, ASCII art, HTML rendering, Kroki integration, and Slack/Discord/webhook notifiers. Persistence packages (`awaitly-postgres`, `awaitly-libsql`, `awaitly-mongo`) gain dedicated lock modules. Docs and browser-test app updated for the new layout.

### Patch Changes

- Updated dependencies [6114dd9]
  - awaitly@1.13.0

## 2.0.0

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
  - awaitly@1.12.0

## 1.0.0

### Patch Changes

- Updated dependencies [e9396f1]
  - awaitly@1.11.0
