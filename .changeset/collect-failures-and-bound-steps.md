---
"awaitly": minor
"awaitly-analyze": minor
"eslint-plugin-awaitly": minor
---

`step.allSettled(name, { key: () => op() })` runs every operation in parallel and collects every failure. You get `{ values, errors }`, with `errors` typed as the union the operations return, and those errors stay out of the run's error union. Each operation runs as step `name.key` with its own events, span, cache entry and checkpoint.

`awaitly-analyze` draws each operation under its id, labels kept errors in Mermaid and railway diagrams, and carries the XState machine past the join.

`match` names an arm the Result cannot produce: `match: this Result has no "GONE" error. Remove the "GONE" arm.`

`partition` merges Results with different error types into one union.

`awaitly/step-no-try-catch-wrap` covers bound steps in `run(deps, fn)`, such as `s.getUser(id)` and `{ getUser }`. The concurrency rules cover every `run(deps, fn)` callback, and `no-floating-result` and `require-step-id` cover `step.allSettled`.
