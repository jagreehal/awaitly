# eslint-plugin-awaitly

## 3.2.0

### Minor Changes

- de708b1: Automatic OpenTelemetry tracing, tagged errors that survive the wire, an
  injectable clock, and a lint rule that keeps inferred error unions distinct.

  ## Tracing

  Spans now cover runs, steps, retry attempts, parallel and race scopes, sagas,
  compensations, and queued engine workflows. Register a provider once at startup
  and your workflow structure reaches your tracing backend.

  Each step runs inside its own active span, so spans from clients you already
  instrument (pg, undici, your HTTP layer) nest inside the step that made the
  call. The `onEvent` bridge could never do that: a callback fires beside the step
  rather than inside it, so those spans landed in a flat pile next to the workflow.

  Nesting needs a registered `ContextManager`. `NodeSDK` installs one. A
  hand-built `BasicTracerProvider` does not, and without one every span starts its
  own trace.

  `@opentelemetry/api` is now a dependency. It no-ops until you register an SDK
  and costs under a microsecond per step in that state, so tracing is on by
  default. Turn it off with `AWAITLY_TELEMETRY=0`, `setTelemetryEnabled(false)`,
  or `telemetry: false` on a single run, workflow, or engine. A per-run value
  overrides the process setting in either direction.

  Span status stays UNSET on success, since the spec reserves OK for the
  application and a status set by instrumentation cannot be overridden. Read
  `awaitly.outcome`.

  The engine carries trace context from `enqueue()` to the worker. A queued
  workflow can outlive the request that enqueued it, so its span starts a new
  trace and records the enqueuing span as a link rather than parenting to a span
  that may have ended hours earlier.

  ## Errors across the wire

  `TaggedError.toJSON` preserves the discriminant, message, and enumerable props.
  It omits the stack so a sender does not expose its file paths.

  `fromPromise` and `tryAsync` accept `PromiseLike`, matching the `then` contract
  each implementation already awaits. Framework and library thenables typecheck
  without an adapter.

  `awaitly/error-require-discriminant` joins `recommended-strict`. It reports
  classes that extend `Error` without a string-literal `type` or `_tag`, which is
  what keeps separate error classes distinct in inferred unions.

  ## Clock

  Injectable `Clock` for deterministic retry, sleep, timeout, and circuit-breaker
  tests.

  **Breaking:** retry no longer retries `UnexpectedError` or untagged throws by
  default. Typed errors still retry. Pass `retryIf: () => true` to opt back into
  retrying throws.

## 3.1.0

### Minor Changes

- 2655501: Stop widening error literals, type-check timeout errors, drop the cause parameter from `Result`, match mixed error unions, lint deps bypasses, and fail empty diagrams.

  ## `awaitly`

  **`err()` was destroying discriminants.** Its error type parameter was not `const`, so an error object inferred as its widened shape:

  ```ts
  err({ type: "NOT_FOUND", id }); // was: Err<{ type: string; id: string }>
  ```

  Any dependency without an explicit return annotation therefore produced `result.error.type: string` — no narrowing, no exhaustive `switch` — and `as const` was the only way to get the literal back. The `err()` docblock already documented the literal behaviour, so the docs described something that did not happen. `err()` now takes a `const` type parameter.

  The same `as const` tax applied to every other error-producing helper. `from`, `fromPromise`, `tryAsync`, `fromNullable`, `mapError`, `mapTry`, `mapErrorTry`, and `tryAsyncRetry` now take `const` error parameters, so error mappers keep their literals without a caller-written assertion:

  ```ts
  tryAsync(
    () => charge(amount),
    (cause) => ({ type: "CHARGE_FAILED", cause })
  );
  // error type is { readonly type: 'CHARGE_FAILED'; readonly cause: unknown }
  ```

  `step.try`, `step.fromResult`, `step.fromNullable`, `catchUnexpected`, and `errors: [...]` already had `const` parameters and are unchanged.

  **Breaking:** inferred error literals now carry `readonly` modifiers, so an inferred error object holding an array is a readonly tuple and will not assign to a mutable `string[]`. Annotating the function's return type — the documented pattern — makes the error contextual and avoids this. The `Mutable<E>` unwrapper that would strip the modifiers was deliberately not applied: it flattens `Error` and `TaggedError` instances into structural objects, a worse and far more common regression.

  **Hover noise:** `run()` and `createWorkflow()` declared `NoInfer<E>` in their _return_ types. Return positions are not inference sites, so this was display-only, and it rendered as `Result<User, UnexpectedError | NoInfer<UserNotFound>, unknown>`. The wrapper is gone from those return types; the `NoInfer` guards on `onError`, `onEvent`, and `step` — which do pin `E` against an annotated callback parameter — are unchanged.

  Docstrings and documentation that taught the now-unnecessary `as const` have been updated, including a troubleshooting section and a `step()` aside that asserted the opposite of current behaviour.

  **Follow-up:** `const` alone does not produce literal inference through a _callback's return position_, and the behaviour differs by compiler — TypeScript 6.x infers the literal from `const E` while 5.9 widens to `string`. Object literals were fine either way; bare strings were not, so `tryAsync(fn, () => 'FETCH_ERROR')` still widened on the compiler this package actually depends on. The error parameters of `from`, `fromPromise`, `tryAsync`, `fromNullable`, `mapError`, `mapTry`, `mapErrorTry`, `tryAsyncRetry` and `tryAsyncBoundary` are now `const E extends ErrorValue`, where the new exported `ErrorValue` is `unknown` written out as a union of its constituents — it accepts exactly what `unknown` accepts, and the spelling is what restores literal inference.

  **`step.withTimeout` now type-checks its timeout error.** `TimeoutOptions.error` was `unknown` and `TimeoutBehavior`'s function form returned `unknown`, so a custom timeout error never reached the result union — the documented example produced a workflow whose error type did not mention the timeout at all. Both are now generic over the timeout error, and `step.withTimeout` constrains it to the workflow's error union the same way `step.try` does:

  ```ts
  const workflow = createWorkflow({ apiCall }, { errors: ["API_TIMEOUT"] });
  await workflow.run(async ({ step, deps }) =>
    step.withTimeout("apiCall", () => deps.apiCall(), {
      ms: 5000,
      onTimeout: () => "API_TIMEOUT", // in the union; an undeclared tag is now a compile error
    })
  );
  ```

  **Breaking:** a custom timeout error whose tag is not in the workflow's error union no longer compiles. Declare it with `errors: [...]`. The `'error'`/`'option'`/`'disconnect'` behaviours are unchanged.

  **`Result` and `AsyncResult` now take two type parameters, not three.** The third was the cause type, and it was the reason every hover ended in a stray `, unknown` — TypeScript never elides a trailing type argument, even when it equals the default, so `Result<User, UserNotFound>` printed as `Result<User, UserNotFound, unknown>` no matter how it was written:

  ```ts
  // before
  Result<User, UnexpectedError | NoInfer<UserNotFound>, unknown>;
  // after
  Result<User, UnexpectedError | UserNotFound>;
  ```

  `Err<E, C = unknown>` keeps its cause parameter, so `err(error, { cause })` still infers the cause type and `ExtractCause`/`CauseOf` still read it off an `Err`. What changes is that a value widened to a `Result` no longer carries the type — and since annotating a function's return type is exactly such a widening, this was already the case for essentially all real code: `AsyncResult<User, 'NOT_FOUND'>` had a cause of `unknown` before this change too. The `cause` value is untouched at runtime.

  **Breaking:** `Result<T, E, C>` and `AsyncResult<T, E, C>` no longer accept a third argument — drop it. The `err` handlers of `match`, `tapError`, `mapError` and `unwrapOrElse` receive `cause: unknown` rather than a typed cause; narrow it at the point of use, or read it off the `Err` before widening.

  **`matchError` now handles unions that mix string tags and `TaggedError` classes.** awaitly supports both error shapes, so this union is a natural thing to write:

  ```ts
  const getUser = async (
    id: string
  ): AsyncResult<User, "NOT_FOUND" | ValidationError> => {
    /* … */
  };
  ```

  Nothing could match it exhaustively. `matchError` was constrained to `E extends string`, `TaggedError.match` takes only tagged classes, and the `Match` pipeline is keyed on `_tag` objects — so a mixed union fell between all three and left `instanceof` chains as the only option. A `switch` could not close the gap either: `case ValidationError:` compares the error against the _constructor_, which never matches an instance.

  Handlers are now keyed by tag, where a bare string is its own tag and anything else is keyed by its `type` (falling back to the deprecated `_tag`). The matched member arrives narrowed, so a class's props are reachable without an `instanceof` check:

  ```ts
  const message = matchError(result.error, {
    NOT_FOUND: () => "User not found",
    FETCH_ERROR: () => "Fetch error",
    ValidationError: (e) => `Bad input: ${e.userId}`, // e is ValidationError
    UnexpectedError: (e) => `Unexpected: ${e.message}`,
  });
  ```

  Exhaustiveness is still enforced — a missing handler is a compile error, and a misspelled tag reports `Did you mean to write 'ValidationError'?`.

  This is additive. `MatchErrorHandlers<E, R>` keeps adding the `UnexpectedError` key, so string-only unions type exactly as before, and an unmatched tag at runtime now throws a named error instead of `undefined is not a function`.

  ## `eslint-plugin-awaitly`

  New lint rule: `awaitly/step-no-deps-bypass`.

  A workflow can register dependencies and then call the module-level functions anyway:

  ```ts
  const wf = createWorkflow("checkout", { validateCart, chargeCard });

  wf.run(async ({ step }) => {
    // registered as a dep, called directly — deps is now just a name registry
    const cart = await step("validateCart", () => validateCart(input));
  });
  ```

  This compiles, runs, and passes its tests. What it silently loses is injection: `wf.run(fn, { deps: mockDeps })` has no effect on that step, so the test double never runs and the DI story is only true on paper. Nothing in the type system catches it, because the deps object is still well-typed and still drives the inferred error union.

  The rule reports a bare call to any registered dep name inside a workflow callback and points at `deps.<name>(...)`. It covers `createWorkflow`, `createSagaWorkflow`, and the deps-first `run(deps, fn)` form, where the bound steps parameter (`s.fn(...)`) counts as correct. Dep names shadowed by a callback parameter are left alone, and a deps object assembled with a spread is skipped, since its keys cannot be enumerated statically.

  Enabled in both `recommended` and `recommended-strict`. The slug `step-no-deps-bypass` joins the shared spine in `awaitly/slugs`.

  ## `awaitly-analyze`

  Fix two defects that let `--assert-diagrammable` pass on a workflow the analyzer could not read.

  **The named-run overload was invisible.** `run` is overloaded: the callback comes first in `run(fn)`, but second in `run('run-id', fn)`. Invocation discovery took `args[0]` unconditionally, so the named form handed the analyzer a string literal instead of the callback. The workflow was still discovered and its dependencies resolved, so the output looked plausible while every step was missing:

  ```ts
  // Diagrammed correctly
  wf.run(async ({ step, deps }) => {
    await step("validateCart", () => deps.validateCart(cart));
  });

  // Reported six dependencies and zero steps
  wf.run("checkout", async ({ step, deps }) => {
    await step("validateCart", () => deps.validateCart(cart));
  });
  ```

  The callback is now selected by shape: an inline function wins, otherwise the first non-string argument, which keeps `run(handler)` and `run('run-id', handler)` working where the callback is passed by identifier.

  **An empty diagram scored 100/100.** `computeDiagrammability` returned `score: 100, deterministic: true` whenever a workflow produced no flow nodes. Combined with the above, `--assert-diagrammable` exited 0 on every named-run workflow, and `--doctor` reported "fully diagrammable" about a diagram with nothing in it. A workflow that resolves to no nodes now reports a new `empty-diagram` issue with `deterministic: false` and `score: 0`, so the CI gate fails and says why.

## 3.0.0

### Major Changes

- da2f3e3: A DX pass over imports, error unions, and static analysis. The theme: a user reaching for `as const`, a cast, or a restated error list is a library problem, so each of those is removed rather than documented.

  ## Four entry points instead of thirteen

  | Entry             | Carries                                                                               |
  | ----------------- | ------------------------------------------------------------------------------------- |
  | `awaitly`         | Results, `run`, `createWorkflow`, steps, resources, batching, policies                |
  | `awaitly/result`  | Result-only size guarantee                                                            |
  | `awaitly/durable` | durable execution, persistence, sagas, human-in-the-loop, streaming, webhooks, engine |
  | `awaitly/testing` | harness code, kept out of production bundles                                          |

  Nine subpaths are removed. Every export they carried is still published — `run`/`workflow`/`reliability` → `awaitly`, and `persistence`/`saga`/`hitl`/`streaming`/`webhook`/`engine` → `awaitly/durable`. `awaitly` still re-exports nothing from `awaitly/durable`, so CommonJS and non-tree-shaking consumers don't pull the production graph in through the front door.

  ## No more `as const` on declared errors

  ```diff
  - createWorkflow("checkout", deps, { errors: ["NOT_FOUND"] as const })
  + createWorkflow("checkout", deps, { errors: ["NOT_FOUND"] })
  ```

  The option's type parameter is now a `const` type parameter — the same modifier `Deps` already used — so the literals survive without help.

  ## `any` / `anyAsync` require a non-empty array

  The parameter is a non-empty tuple, so an empty array is a compile error and `EmptyInputError` is gone from both return types. Deleting an error case beats declaring one: there is one fewer failure mode to handle, and the mistake is caught before it ships. The runtime guard remains for JavaScript callers.

  Code passing a `Result[]` typed as a plain array rather than a literal or tuple needs a non-empty tuple type or a length check, since TypeScript cannot tell whether such an array has elements.

  ## A rejected promise is unexpected, not a declared error

  A rejection is a thrown exception, and `catchUnexpected` / `UnexpectedError` already exist for those. `allAsync` and `anyAsync` were catching rejections and reporting `PromiseRejectedError`, which put a failure nobody modelled into every caller's union — and because a step's errors must belong to the workflow's declared union, the documented race did not type-check without a cast:

  ```diff
  - const fastest = await step.race("cacheRace", () =>
  -   anyAsync([deps.cacheA(), deps.cacheB()]) as AsyncResult<string, "MISS">
  - );
  + const fastest = await step.race("cacheRace", () => anyAsync([deps.cacheA(), deps.cacheB()]));
  ```

  `anyAsync` also stops letting a rejection hide a real error. It races, so a thrown racer simply loses and the others still compete. But when every racer failed it reported whichever settled _first_, so a thrown racer could mask another racer's modelled error depending on timing. A modelled failure now always wins, and the exception propagates only when every racer threw.

  `allSettledAsync` is unchanged and still reports `PromiseRejectedError` per item — telling you every outcome is what it is for. The type, constant, and guard stay exported.

  Code matching on `PROMISE_REJECTED` from `allAsync` or `anyAsync` needs a `try`/`catch`, or to handle `UnexpectedError` inside a workflow.

  ## Resume safety: `onBeforeStep` and step-order drift

  Bound step keys are position-derived (`getUser`, `getUser#2`, …), so inserting or reordering a dep call shifted every later suffix — a resumed run could read a _different_ step's checkpoint under the same key and continue with the wrong value. Avoiding that relied on remembering to bump `version`.

  Snapshots now record the executed step order, and a mismatched resume fails with `WorkflowShapeDriftError` instead of replaying. The new `onBeforeStep(stepKey, workflowId, context, info)` fires before each step, including one about to be served from cache or a snapshot and before that value is read — the only point where a stale checkpoint can still be rejected, since `onAfterStep` never fires for a replayed step.

  ## Branch ids are derived, so two lint rules are gone

  The analyzer derives a stable id from a branch's own expression (`user.isPremium` → `user-is-premium`), so raw `if` / `for...of` stay diagrammable. That was the entire reason `workflow-prefer-step-if` and `workflow-prefer-step-foreach` existed; both are removed, along with their entries in `recommended` and `strict`. Configs that set either rule explicitly must drop the entry, since ESLint errors on unknown rule names.

  Derivation is deliberately conservative: every operator encodes to a distinct word, and an expression it cannot encode losslessly (calls, arithmetic) yields no id and the node stays unlabelled. These ids identify branches in diagrams and graph validation, so being injective matters more than covering every expression.

  ## `step.race` is diagrammed as it is actually called

  The analyzer only matched `step.race([...])` and `step.race({...})` — shapes the runtime never accepted and that `require-step-id` rejects, since it wants a string first argument. The real signature is `step.race(name, operation)`, a scope wrapper whose racers come from what the callback runs. Given that, the analyzer produced a race node with **zero children**, so every real race rendered as an empty fork-and-join. Both dead branches are removed.

  Two gaps kept the documented pattern from rendering even once the signature was recognised:

  - `anyAsync([a(), b()])` produced no children when its racers were invoked directly, missing the implicit-step fallback `allAsync` already had.
  - A cast hid the expression under it, and `() => anyAsync([...]) as AsyncResult<T, E>` was the usual way to absorb the extra error types. Parentheses, `as`, and `!` are now unwrapped wherever a callback is analyzed, so this applies to every construct rather than just races.

  A race scope now carries its `name`, and wrapping `anyAsync` reports one race instead of nesting a race inside a race.

  ## A child workflow passed as a dep is shown as a workflow reference

  Passing a child workflow as a dep — `enrichUser: (id) => childWorkflow.run(fn)` — is how the child's errors join the parent's union, so it is the composition worth reaching for. But the reference sits in the deps object rather than the callback, and only the callback was scanned for `<x>.run(...)`, so calling that dep drew a plain step.

  Dependencies now carry `workflowRef`, and a step calling one renders as a reference and counts toward `workflowRefCount`. Detection runs before policy unwrapping, so `retry(() => child.run(fn))` is still recognised; only a plain `<identifier>.run` / `.runWithState` is matched.

  Relatedly, `step.workflow` cannot widen a parent's error union — `E` is fixed before the callback is typed and TypeScript cannot infer it back out of a callback body — so its JSDoc claim that the child's errors flow in was false. It now documents what it does and points at the dep pattern.

  ## Inferred and declared step errors read alike

  A step's errors are inferred from its dep's return type when `errors` is not passed, but they arrived as TypeScript writes them — `"NOT_FOUND"`, quotes included — while a declared `errors: ["NOT_FOUND"]` arrived bare. The same step rendered differently depending on whether the author restated something the types already knew. Inferred names are now unquoted. Errors containing a delimiter are still not split: a dep failing with `"A|B"` stays one error.

  This is what makes the redundant per-step `errors` option safe to drop from examples; it remains supported as an assertion.

## 2.0.0

### Major Changes

- 327f227: Replace the workflow production umbrella with task-shaped `run`, `reliability`, `durable`, `persistence`, `saga`, `hitl`, `streaming`, `webhook`, and `engine` entry points. Persistence adapters now consume the dedicated persistence contract instead of the workflow runtime.

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
