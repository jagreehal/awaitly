---
"awaitly": major
"awaitly-analyze": minor
"awaitly-visualizer": minor
"awaitly-postgres": minor
"awaitly-mongo": minor
"awaitly-libsql": minor
---

The canonical core: 36 entry points become 4, one way to write everything.

**Breaking — entry points.** The exports map is now exactly:

| Entry | Contents |
| --- | --- |
| `awaitly` | The front door: Result primitives, `run()` + step engine, per-dep policies, `TaggedError`, pre-built errors, pattern matching (`Match`, `matchValue`), durations, circuit breaker, rate limiting, cache, singleflight, declarative conditionals (`when`/`unless`), slug runtime |
| `awaitly/result` | The size guarantee: Result primitives only — the whole entry minifies under ~10KB with zero bundler trust required |
| `awaitly/workflow` | The production tier: `createWorkflow`, durable execution, persistence, human-in-the-loop, sagas, streaming, webhooks, engine, resources, batching |
| `awaitly/testing` | Test utilities |

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
