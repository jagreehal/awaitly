# awaitly-visualizer

## 25.0.0

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

- df3c0a2: The graph contract and the live inspector: the static diagram, the runtime, and the visualizer now share one identity, and you can watch real runs paint the graph.

  **awaitly — core decision events.** `step.if` / `step.label` emit a `decision` event (`decisionId`, `label`, `branch`, `value`) through the standard `onEvent` stream — no `trackIf` instrumentation needed to see which branch fired. `step.branch` owns arm execution, so it emits a _scoped_ decision (`phase: "start"` before the arm, `phase: "end"` with duration after, emitted even when the arm throws) — visualizers nest the arm's steps inside the taken branch.

  **awaitly — strict graph validation (`graph` option).** Pass a declared workflow graph — the `WorkflowDiagramDSL` from awaitly-analyze or a plain list of ids — to `run()` or `createWorkflow` (creation-time, overridable per run). Any runtime step or decision id not in the graph fails the workflow immediately, so the diagram is guaranteed to match what actually runs. Ids with `{placeholder}` segments (e.g. `item-{i}`) match any value in that slot. Enforced across the full helper surface, including the independently-implemented `step.try`, `step.fromResult`, `step.withFallback`, and `step.withResource`.

  **One identity contract.** DSL state ids are the semantic ids authored in the code — `step()`'s literal first argument and `step.if()`'s decision id — so analyzer output works directly as the `graph` option and matches runtime event `name`s. Literal cache keys are carried on the new `WorkflowDiagramState.key`; snapshot-driven highlighting matches `currentStepId === (state.key ?? state.id)`. All state ids are collision-safe (`#2` suffixing, `start`/`end` reserved).

  **awaitly-analyze — no silent drops.** An awaited call static analysis can't model now surfaces as a real `unknown` node in the IR plus an `UNANALYZED_AWAIT` warning, instead of vanishing from the diagram. Explicit `step.if` decisions always produce a decision node, even with step-free branches.

  **awaitly-analyze — trace layer.** `traceFromEvents` captures decisions (branch taken) and retry counts; `renderStaticMermaidWithTrace` overlays evaluated decision diamonds alongside step statuses — whole shape visible, executed path painted.

  **awaitly-analyze — `--dev`, the live inspector.** `awaitly-analyze ./workflow.ts --dev` starts a zero-dependency dev server (SSE, no WebSocket setup): it analyzes and watches the file, serves the full static graph, and accepts runtime event streams at `POST /events`. Each run appears in a run bar with its trace overlaid — executed steps colored by status, decisions highlighted, untouched nodes greyed.

  **awaitly-visualizer — `devEvents`.** Wire `onEvent: devEvents("http://localhost:4747")` and every run streams itself into the inspector. Batched per microtask, fire-and-forget, and crash-proof: fetch failures and serialization failures (cyclic context, BigInt) are swallowed — the inspector is a dev convenience, never a dependency. The runtime IR builder also consumes core decision events directly: `step.branch` arms nest inside the taken branch, `step.if` renders as a decision marker with the untaken branch visible.

### Patch Changes

- Updated dependencies [e13d94e]
- Updated dependencies [0f9e169]
- Updated dependencies [df3c0a2]
  - awaitly@2.0.0

## 24.0.0

### Patch Changes

- Updated dependencies [6789deb]
  - awaitly@1.35.0

## 23.0.1

### Patch Changes

- 0b6f723: chore: update dependencies + migrate to vite 8

  Minor/patch dependency refresh via npm-check-updates (`--target minor`, 3-day publish cooldown) — no major version bumps. Forced `vite ^8` across the workspace via a pnpm override (vitest already supports it). TypeScript stays on 5.x and eslint on 9.x (their majors are deliberately deferred).

## 22.0.1

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

- Updated dependencies [c35805a]
  - awaitly@1.33.1

## 22.0.0

### Patch Changes

- Updated dependencies [f4945cc]
  - awaitly@1.33.0

## 21.0.0

### Patch Changes

- Updated dependencies [f48a8e9]
  - awaitly@1.32.0

## 20.0.1

### Patch Changes

- 5c871f5: Add optional step metadata to StepOptions for static analysis and observability.

  - **awaitly**: StepOptions now supports optional fields — Architecture & intent (`intent`, `domain`, `owner`, `tags`), Effects & dependencies (`stateChanges`, `emits`, `calls`), and Error classification (`errorMeta`). Metadata flows into step events, diagnostics, and OpenTelemetry spans.
  - **awaitly-analyze**: Static workflow IR and schema include step metadata; analyzer extracts these fields when present for diagrams and tooling.
  - **awaitly-visualizer**: IR builder and renderers consume and display step metadata from the analyzer output.
  - **awaitly-docs**: Document StepOptions metadata in foundations/step.mdx, reference/api.md, and guides/static-analysis.mdx; add AI SDK + awaitly workflows guide.

- Updated dependencies [5c871f5]
  - awaitly@1.31.1

## 20.0.0

### Patch Changes

- Updated dependencies [52cae14]
  - awaitly@1.31.0

## 19.0.0

### Minor Changes

- ed7d7ef: Minor updates across awaitly packages: core library, analyzers, visualizer, database adapters (postgres, libsql, mongo), ESLint plugin, and docs.

### Patch Changes

- Updated dependencies [ed7d7ef]
  - awaitly@1.30.0

## 18.1.0

### Minor Changes

- 102e866: - **awaitly-analyze**: Fix Mermaid diagram labels: normalize literal `\n` in `escapeLabel` so saga steps (e.g. "Notify (try)") and step annotations render on one line instead of showing backslash-n. Update tests to expect current dep-step label output (no "(dep: ...)" in diagram labels).

## 18.0.0

### Patch Changes

- Updated dependencies [e08ccd0]
  - awaitly@1.29.0

## 17.0.0

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

## 16.0.0

### Minor Changes

- 2fae4a4: - Add render-md-mermaid GitHub workflow and tests
  - Add payment flow diagram fixture and tests
  - Update docs, DSL, HTML, and Mermaid output; static analyzer and types

### Patch Changes

- Updated dependencies [2fae4a4]
  - awaitly@1.27.0

## 15.0.0

### Patch Changes

- Updated dependencies [fe5dddf]
  - awaitly@1.26.0

## 14.0.0

### Patch Changes

- Updated dependencies [5eec7cc]
  - awaitly@1.25.0

## 13.0.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

### Patch Changes

- Updated dependencies [c3a9f08]
  - awaitly@1.24.0

## 12.0.0

### Patch Changes

- Updated dependencies [98f110a]
  - awaitly@1.23.0

## 11.0.0

### Patch Changes

- Updated dependencies [84bfb7a]
  - awaitly@1.22.0

## 10.0.0

### Patch Changes

- Updated dependencies [f68ccdb]
  - awaitly@1.21.0

## 9.0.0

### Patch Changes

- Updated dependencies [dceec3d]
  - awaitly@1.20.0

## 8.0.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

### Patch Changes

- Updated dependencies [34022b8]
  - awaitly@1.19.0

## 7.0.0

### Patch Changes

- Updated dependencies [6119f95]
  - awaitly@1.18.0

## 6.0.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

### Patch Changes

- Updated dependencies [afc8f6c]
  - awaitly@1.17.0

## 5.0.0

### Patch Changes

- Updated dependencies [d4cd1ac]
  - awaitly@1.16.0

## 4.0.0

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

## 3.0.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

### Patch Changes

- Updated dependencies [f5957ad]
  - awaitly@1.14.0

## 2.0.1

### Patch Changes

- c9924c7: - **awaitly-visualizer**: Add `./devtools` export with `createDevtools`, `quickVisualize`, `createConsoleLogger`, and `renderDiff` for timeline visualization, run comparison, and console logging from a single entry point.
  - **awaitly-docs**: Document `awaitly-visualizer/devtools` in the visualization guide and API reference; add devtools usage examples and migration note from `awaitly/devtools`.
  - **awaitly-postgres**: (version bump only; no code changes in this changeset)

## 2.0.0

### Minor Changes

- 6114dd9: Split workflow visualization and devtools out of the main `awaitly` package into a new `awaitly-visualizer` package. The core package no longer ships visualize/devtools entry points; use `awaitly-visualizer` for Mermaid diagrams, ASCII art, HTML rendering, Kroki integration, and Slack/Discord/webhook notifiers. Persistence packages (`awaitly-postgres`, `awaitly-libsql`, `awaitly-mongo`) gain dedicated lock modules. Docs and browser-test app updated for the new layout.

### Patch Changes

- Updated dependencies [6114dd9]
  - awaitly@1.13.0
