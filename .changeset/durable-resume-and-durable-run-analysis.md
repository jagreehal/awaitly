---
"awaitly": major
"awaitly-analyze": minor
---

Per-iteration checkpoints for `step.forEach`, crash retry on resume, and static analysis of `durable.run`.

## awaitly

**`step.forEach` iterations each get their own checkpoint.** A step written inside a
forEach callback now keys by its iteration, so a resume skips the items that already
completed and re-runs only the rest. `stepIdPattern` names the iteration for both the
diagram and the checkpoint, nested loops concatenate, and the scope is held per run so
concurrent runs stay independent. The same scoping applies to `step.try`,
`step.fromResult`, `step.withFallback`, and `step.withResource`; the `step.item` form
passes its inner handler the persisted workflow step, so completed items are durable
straight away.

**`resumeFailedSteps` decides what a resume restores.** A step that failed by *throwing*
recorded a crash — the worker died, the socket dropped — while a step that failed with a
typed `err` reached a decision. The new default, `'crashed'`, retries thrown failures and
keeps typed errors decided; `'all'` restores every failed step, as before.

**`step.retry` and `step.withTimeout` are durable under `durable.run`.** They now
checkpoint by id (and by forEach iteration) whenever steps are being persisted, so a
retried step is skipped on resume, while keeping their uncached behaviour against a plain
cache. A restored crash also keeps its cause, so a resumed failure still names what went
wrong.

**`durable.run` accepts the stores shipped for it.** The new `DurableStore` type, exported
from `awaitly/durable`, is the contract the awaitly-mongo, awaitly-postgres, and
awaitly-libsql adapters implement, so `durable.run(deps, fn, { store: mongo(url) })`
typechecks directly.

Breaking: the `resumeFailedSteps` and `step.retry` defaults change what an existing
workflow does on resume, and forEach checkpoints written by an earlier version re-run once.

## awaitly-analyze

**`durable.run()` is discovered**, including through an alias, and diagrams like `run()`.
**`runWithState` diagrams like `run`.** **Steps in the deps-first form are named by their
id** for both callback shapes — bound steps (`run(deps, async (s) => s.loadBatch())`) and
the workflow form (`run(deps, async ({ step, deps }) => step("loadBatch", ...))`).

**Workflows get a readable name**, taken from the enclosing function, then a string-literal
durable `id`, and only then `run@file:line`. **The generated types file agrees with the
diagram**: its error union is built from declared errors, per-step `errors: [...]`, and the
dependency Result error types, with unions split and literals normalized.

Note: generated `*.types.ts` filenames follow the workflow name, so a committed one may be
written under a new name.
