---
"eslint-plugin-awaitly": minor
"awaitly-analyze": minor
"awaitly": minor
"awaitly-docs": minor
---

### Effect-style step helpers

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
