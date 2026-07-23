# awaitly

## 3.0.0

### Major Changes

- 327f227: Replace the workflow production umbrella with task-shaped `run`, `reliability`, `durable`, `persistence`, `saga`, `hitl`, `streaming`, `webhook`, and `engine` entry points. Persistence adapters now consume the dedicated persistence contract instead of the workflow runtime.

## 2.0.0

### Major Changes

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

### Minor Changes

- 0f9e169: Per-dependency policies: `retry`, `timeout`, `fallback`.

  **awaitly**

  - Policies are value-level function wrappers declared in the deps object — call sites stay pristine: `charge: retry(timeout(charge, 5000), { attempts: 3 })`.
  - Exact error-union math: `retry` preserves the union (the last failure propagates), `timeout` adds `TimeoutError`, `fallback` consumes the base union leaving only the handler's errors.
  - Plain (non-Result) functions are valid inputs: values normalize to `ok()`, throws keep throwing and surface as `UnexpectedError` at the run/workflow layer.
  - Wrappers preserve the base function's name, so workflow events and diagrams keep showing the dep name.
  - Exported from `awaitly` and `awaitly/run`: `retry`, `timeout`, `fallback`, plus `RetryPolicyOptions`, `PolicyFn`, `PolicyDelay` types.

  **awaitly-analyze**

  - Policy chains are read structurally from the deps literal: the analyzer unwraps to the base function for type extraction (error inference no longer depends on resolving wrapper generics), records the chain on `DependencyInfo.policies` (innermost first), and applies the same error-union math — diagrams can state "this edge retries 3× with a 5s timeout" as fact.

- df3c0a2: The graph contract and the live inspector: the static diagram, the runtime, and the visualizer now share one identity, and you can watch real runs paint the graph.

  **awaitly — core decision events.** `step.if` / `step.label` emit a `decision` event (`decisionId`, `label`, `branch`, `value`) through the standard `onEvent` stream — no `trackIf` instrumentation needed to see which branch fired. `step.branch` owns arm execution, so it emits a _scoped_ decision (`phase: "start"` before the arm, `phase: "end"` with duration after, emitted even when the arm throws) — visualizers nest the arm's steps inside the taken branch.

  **awaitly — strict graph validation (`graph` option).** Pass a declared workflow graph — the `WorkflowDiagramDSL` from awaitly-analyze or a plain list of ids — to `run()` or `createWorkflow` (creation-time, overridable per run). Any runtime step or decision id not in the graph fails the workflow immediately, so the diagram is guaranteed to match what actually runs. Ids with `{placeholder}` segments (e.g. `item-{i}`) match any value in that slot. Enforced across the full helper surface, including the independently-implemented `step.try`, `step.fromResult`, `step.withFallback`, and `step.withResource`.

  **One identity contract.** DSL state ids are the semantic ids authored in the code — `step()`'s literal first argument and `step.if()`'s decision id — so analyzer output works directly as the `graph` option and matches runtime event `name`s. Literal cache keys are carried on the new `WorkflowDiagramState.key`; snapshot-driven highlighting matches `currentStepId === (state.key ?? state.id)`. All state ids are collision-safe (`#2` suffixing, `start`/`end` reserved).

  **awaitly-analyze — no silent drops.** An awaited call static analysis can't model now surfaces as a real `unknown` node in the IR plus an `UNANALYZED_AWAIT` warning, instead of vanishing from the diagram. Explicit `step.if` decisions always produce a decision node, even with step-free branches.

  **awaitly-analyze — trace layer.** `traceFromEvents` captures decisions (branch taken) and retry counts; `renderStaticMermaidWithTrace` overlays evaluated decision diamonds alongside step statuses — whole shape visible, executed path painted.

  **awaitly-analyze — `--dev`, the live inspector.** `awaitly-analyze ./workflow.ts --dev` starts a zero-dependency dev server (SSE, no WebSocket setup): it analyzes and watches the file, serves the full static graph, and accepts runtime event streams at `POST /events`. Each run appears in a run bar with its trace overlaid — executed steps colored by status, decisions highlighted, untouched nodes greyed.

  **awaitly-visualizer — `devEvents`.** Wire `onEvent: devEvents("http://localhost:4747")` and every run streams itself into the inspector. Batched per microtask, fire-and-forget, and crash-proof: fetch failures and serialization failures (cyclic context, BigInt) are swallowed — the inspector is a dev convenience, never a dependency. The runtime IR builder also consumes core decision events directly: `step.branch` arms nest inside the taken branch, `step.if` renders as a decision marker with the untaken branch visible.

## 1.35.0

### Minor Changes

- 6789deb: Deps-first `run(deps, fn)` with auto-bound steps and automatic error inference.

  **awaitly**

  - New `run(deps, fn)` form: pass your functions as the first argument and compose through the bound steps object — `run({ getOrder, getUser }, async (s) => s.getOrder(id))`. No type parameters, no string step IDs, no thunks; the result's error union is inferred from the deps object.
  - Plain (non-Result) functions are valid deps: values pass through, throws become `UnexpectedError`, enabling incremental adoption from plain async/await.
  - `createWorkflow` parity: workflow callbacks receive the same bound steps object as `steps` — `workflow(async ({ steps }) => steps.getUser(id))` — routed through the cached step so caching and resume apply.
  - Loop safety: repeat invocations of the same dep auto-suffix the step key (`getUser`, `getUser#2`, ...). Previously a workflow loop calling the same dep twice silently returned the first cached result.
  - `ErrorOf`/`ErrorsOf` now correctly yield `never` (instead of `unknown`) for plain non-Result functions.
  - New exports: `BoundSteps` (awaitly, awaitly/run) and `WorkflowSteps` (awaitly/workflow).

  **awaitly-analyze**

  - Detects the deps-first forms as steps with the dep key as step ID: `s.getOrder(id)`, destructured `({ getOrder }) => getOrder(id)`, renamed bindings, workflow `({ steps })`, and nested `({ steps: { getUser } })`. The deps object passed to `run(deps, fn)` is captured for dependency and error-type resolution, so deps-first workflows visualize with full fidelity.
  - Internals: step-method detection is now a dispatch table, and the static analyzer is decomposed into concern modules (discovery, bindings, step-options, deps-types). No behavior change.

## 1.33.2

### Patch Changes

- 7b87901: Added flow

## 1.33.1

### Patch Changes

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

## 1.33.0

### Minor Changes

- f4945cc: Simplify the `step` API surface and unify retry/error ergonomics:

  - `step.try(...)` now accepts inline `retry`, `timeout`, and `compensate` options (in addition to `error` / `onError`) so edge handling can be configured in one place.
  - Parallel helper naming is consolidated on `step.all(...)`; references and typings now use `all` as the canonical API.
  - Removed deprecated effect-style helpers from `step`: `run`, `andThen`, `match`, `parallel`, `allSettled`, and `tryBoundary`.
  - `RetryOptions<E>` is now the canonical retry config across retry surfaces, using `attempts` / `initialDelay` and `shouldRetry`.
  - `UnexpectedError` is the canonical wrapped error for unexpected failures, and `AwaitlyError` / `isAwaitlyError` include it.

## 1.32.2

### Patch Changes

- 8fbe845: Added error utlity functions

## 1.32.1

### Patch Changes

- 68822e0: Improve durable workflow idempotency and concurrent execution handling.

  - Add in-process idempotency deduplication so concurrent runs with the same idempotency key share a single execution instead of racing.
  - Persist idempotency run markers/results to strengthen cross-process safety and reuse completed results by key.
  - Extend durable concurrency errors with a `reason` field (`in-process` or `cross-process`) for clearer diagnostics.

## 1.32.0

### Minor Changes

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

## 1.31.1

### Patch Changes

- 5c871f5: Add optional step metadata to StepOptions for static analysis and observability.

  - **awaitly**: StepOptions now supports optional fields — Architecture & intent (`intent`, `domain`, `owner`, `tags`), Effects & dependencies (`stateChanges`, `emits`, `calls`), and Error classification (`errorMeta`). Metadata flows into step events, diagnostics, and OpenTelemetry spans.
  - **awaitly-analyze**: Static workflow IR and schema include step metadata; analyzer extracts these fields when present for diagrams and tooling.
  - **awaitly-visualizer**: IR builder and renderers consume and display step metadata from the analyzer output.
  - **awaitly-docs**: Document StepOptions metadata in foundations/step.mdx, reference/api.md, and guides/static-analysis.mdx; add AI SDK + awaitly workflows guide.

## 1.31.0

### Minor Changes

- 52cae14: - **awaitly**: Add result retry support: `tryAsyncRetry` and `RetryConfig` for retrying async operations with configurable backoff without the full workflow engine. New result entrypoint tests and docs import path coverage.
  - **awaitly-analyze**: Static analyzer and showcase fixture updates.
  - **awaitly-docs**: Docs and API reference updates for result types and comparison.

## 1.30.0

### Minor Changes

- ed7d7ef: Minor updates across awaitly packages: core library, analyzers, visualizer, database adapters (postgres, libsql, mongo), ESLint plugin, and docs.

## 1.29.0

### Minor Changes

- e08ccd0: - **awaitly**: `step.workflow()`, `step.withFallback()`, and `step.withResource()` run through the cached step wrapper (events, cache, onAfterStep). `Workflow.run` / `runWithState` support optional `ExtraE` generic for error-union inference.
  - **awaitly-analyze**: Parser and DSL/Mermaid output support `step.workflow`, `step.withFallback`, and `step.withResource`. Child workflow refs invoked via `step.workflow("id", () => childWorkflow.run(...))` are detected and emitted as workflow-ref nodes; step.workflow steps get a "(Workflow)" label suffix.
  - **eslint-plugin-awaitly**: `require-step-id`, `no-immediate-execution`, `require-thunk-for-key`, `stable-cache-keys`, and `no-floating-result` now apply to `step.workflow`, `step.withFallback`, and `step.withResource`.
  - **docs**: Foundations (step.mdx) and ESLint plugin guide updated for the new step helpers; .claude skills (awaitly-patterns, awaitly-analyze) updated with Step Helpers table and analyzer notes.

## 1.28.0

### Minor Changes

- 7a97004: Refactor workflow API: spec-driven `workflow.run` with call-time dependency injection

  - **awaitly**: Replaces `createWorkflow(name, deps, opts)` with a spec-driven API using `Step<F>()` tokens and call-time dependency injection. Adds `workflow.run()` and related types; introduces serialize-resume-state and store-contract for durable execution.
  - **awaitly-analyze**: Static analyzer and fixtures updated for the new workflow API and step signatures.
  - **awaitly-visualizer**: Decision tracker, devtools, event capture, and examples updated for the new workflow shape.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: Persistence adapters updated for new workflow types and run API.
  - **awaitly-docs**: Documentation and guides updated across foundations, comparison, guides, and reference to describe the new workflow API and migration.

## 1.27.0

### Minor Changes

- 2fae4a4: - Add render-md-mermaid GitHub workflow and tests
  - Add payment flow diagram fixture and tests
  - Update docs, DSL, HTML, and Mermaid output; static analyzer and types

## 1.26.0

### Minor Changes

- fe5dddf: - **awaitly**: Improved fetch helpers with typed errors (FetchNetworkError, FetchHttpError, FetchParseError, FetchDecodeError, FetchAbortError, FetchTimeoutError), options for timeout, custom error body/error mapping, retry, and for `fetchJson` optional decode and strict Content-Type; added `fetchResponse` export.
  - **eslint-plugin-awaitly**: New rule `no-dynamic-import` to disallow dynamic import() and require(); rule and test updates for no-immediate-execution, require-result-handling, require-thunk-for-key, and stable-cache-keys.
  - **awaitly-analyze**: Updates to ts-morph loader.
  - **awaitly-docs**: Extending Awaitly guide updated to reflect fetch helper patterns.

## 1.25.0

### Minor Changes

- 5eec7cc: Use string constant for unexpected errors; improve tsconfig and docs

  - **awaitly:** `run()` and workflows without custom `catchUnexpected` now return the string `"UNEXPECTED_ERROR"` for uncaught exceptions instead of an `UnexpectedError` object. The thrown value is preserved in `result.cause`. `isUnexpectedError()` and `matchError()` accept both the string and the legacy object shape. Added `tsconfig.quality.json`; main tsconfig no longer excludes test files from typecheck.
  - **awaitly-docs:** Updated foundations and getting-started docs for the new error model; fixed Astro check (config and AnimatedWorkflowDiagram types).

## 1.24.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

## 1.23.0

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

## 1.22.0

### Minor Changes

- 84bfb7a: - **awaitly**: Add `awaitly/result` subpath export for minimal bundle; improve JSDoc in core, workflow, and webhook modules; export all main API on `Awaitly` namespace alongside existing named exports.
  - **awaitly-docs**: Document `awaitly/result` in installation and API reference; update comparison docs (vs neverthrow, try/catch, promise, effect, Vercel Workflow) to use `Awaitly.*` namespace (e.g. `Awaitly.ok`, `Awaitly.err`); fix API generator dedupe and truncation.

## 1.21.0

### Minor Changes

- f68ccdb: ### createWorkflow introspection (WorkflowClass parity)

  - **createWorkflow return value** now exposes `name`, `deps`, `options`, and `snapshot` (read-only). Aligns with WorkflowClass for inspection and persistence. Use `workflow.snapshot` for one-off access or `workflow.getSnapshot()` when reusing. `deps` and `options` are frozen.
  - **WorkflowSnapshot** gains optional `workflowName` (set by the engine when creating a snapshot).
  - **awaitly/core** exports `matchWhen` and type `MatchTag` for tagged-union pattern matching.

  ### Docs

  - API reference: Workflow instance (createWorkflow return value) and Pattern matching (awaitly/core). Foundations and quick reference updated. Functional utilities guide links to core pattern matching.

  ### Tests and quality

  - **awaitly-postgres**, **awaitly-mongo**: Integration tests skip when the database is unavailable (beforeAll connection check + `it.skipIf`), so `pnpm quality` passes without a running Postgres/Mongo.

## 1.20.0

### Minor Changes

- dceec3d: - **awaitly**: Add workflow hook primitive. Suspend a workflow until your app receives an HTTP callback, then resume with the callback payload using `injectHook()`. New exports: `pendingHook`, `createHook`, `injectHook`, `isPendingHook`, `hasPendingHook`, `getPendingHooks`, and the `PendingHook` type. Server-agnostic: you own the callback URL and call `injectHook(state, { hookId, value })` when the request arrives.
  - **awaitly-analyze**: Static analyzer and test updates.

## 1.19.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

## 1.18.0

### Minor Changes

- 6119f95: Saga step names: require a string name as the first argument to `saga.step()` and `saga.tryStep()` for observability and compensation tracking. Runtime validation rejects empty or non-string names with clear errors. ESLint rule `require-step-id` and static analyzer updated to enforce and analyze step names.

## 1.17.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

## 1.16.0

### Minor Changes

- d4cd1ac: Add example-nextjs verification playground: Next.js App Router app that proves the framework-integration docs using awaitly workflows, Drizzle (libsql/SQLite), and TanStack Query. Includes Server Action signup, API route signup, and Get user (React Query + ResultError) with typed error handling. README updated with setup, run, and layout.

## 1.15.0

### Minor Changes

- 1830163: **Step IDs for workflows and steps**

  - **awaitly**: Workflow execution and snapshots now use explicit step IDs. Steps and helpers (`step()`, `step.sleep()`, `step.retry()`, `step.withTimeout()`, `step.try()`, `step.fromResult()`) accept an optional string literal as the first argument for durable execution, resumption, and observability.
  - **eslint-plugin-awaitly**: New rule `require-step-id` enforces that all step calls use a string literal step ID as the first argument.
  - **awaitly-analyze**: Static workflow IR and analyzer updated to support step IDs.
  - **awaitly-visualizer**: IR builder updated for step ID support.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: README and docs updated for step IDs.
  - **awaitly-docs**: Documentation updated across foundations, guides, and reference for step IDs and the new ESLint rule.

## 1.14.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

## 1.13.0

### Minor Changes

- 6114dd9: Split workflow visualization and devtools out of the main `awaitly` package into a new `awaitly-visualizer` package. The core package no longer ships visualize/devtools entry points; use `awaitly-visualizer` for Mermaid diagrams, ASCII art, HTML rendering, Kroki integration, and Slack/Discord/webhook notifiers. Persistence packages (`awaitly-postgres`, `awaitly-libsql`, `awaitly-mongo`) gain dedicated lock modules. Docs and browser-test app updated for the new layout.

## 1.12.0

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

## 1.11.0

### Minor Changes

- e9396f1: ### New Features

  - **Persistence Adapters**: Added `awaitly-mongo` and `awaitly-postgres` packages for MongoDB and PostgreSQL persistence with automatic schema creation, TTL support, and connection pooling
  - **Functional Utilities**: New `awaitly/functional` entry point with Effect-inspired utilities including `pipe`, `map`, `flatMap`, `match`, and collection combinators for Result type composition
  - **ESLint Rule**: Added `no-double-wrap-result` rule to detect and prevent double-wrapping Result types in workflow executors

  ### Improvements

  - Enhanced static analyzer with improved workflow detection and analysis
  - Expanded documentation with guides for MongoDB/PostgreSQL persistence, functional utilities, and AI integration patterns

## 1.10.0

### Minor Changes

- 826eb3a: Add browser support for workflow visualization module. The `awaitly/visualize` export now includes a browser-safe version that excludes Node.js-specific features (`createDevServer`, `createLiveVisualizer`) and provides all visualization capabilities (ASCII, Mermaid, HTML rendering, decision tracking, performance analysis) for browser environments. Node.js-specific features throw helpful errors when called in the browser.

## 1.9.0

### Minor Changes

- b589cb2: Add comprehensive documentation for `bindDeps` utility

  - Added `bindDeps` to API reference with usage examples
  - Created new "Dependency Binding" guide covering the `fn(args, deps)` pattern
  - Added guide to navigation sidebar
  - Includes examples for Express, React, Next.js integration
  - Updated `.gitignore` to exclude `.astro/` build directory

## 1.8.0

### Minor Changes

- e439143: - Add `awaitly/cache` memoization utilities and `awaitly/errors` prebuilt tagged error types.
  - Expand workflow reliability + orchestration (rate limiting/concurrency helpers, improved caching/resume behavior, and workflow cancellation/hooks).
  - Improve `awaitly-analyze` static analysis + Mermaid rendering, and extend `eslint-plugin-awaitly` with rules to prevent floating Results/workflows and require Result handling.
  - Update docs for rate limiting, retries/timeouts, troubleshooting, and workflow comparisons.

## 1.7.0

### Minor Changes

- cc6ebff: - Add browser-compatible static analysis via `awaitly-analyze/browser` (fetch-based WASM loading with configurable base path).
  - Improve static analysis coverage (detect `run()` calls, conditionals/loops/parallel/race patterns) and capture `createWorkflow` docs (`description`, `markdown`) for richer diagrams.
  - Add `eslint-plugin-awaitly` to catch common workflow mistakes (immediate execution, missing thunks for keyed steps, unstable cache keys).
  - Improve `awaitly` workflow DX: `STEP_TIMEOUT` is returned as a typed error (not wrapped) and workflows can include docs metadata for static analysis.

## 1.6.0

### Minor Changes

- 946a2a0: Add documentation for OpenTelemetry integration and workflow visualization features
