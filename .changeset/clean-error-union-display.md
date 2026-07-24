---
"awaitly": patch
---

Show inferred error unions as concrete literals in editor hovers and type errors.

`run(deps, fn)`, `createWorkflow`, `createSagaWorkflow`, and `durable.run` previously surfaced their inferred error type as an opaque alias — `ErrorsOf<{ …whole deps object… }>` / `ErrorsOfDeps<{ … }>` — because a named type alias over a generic never expands in TypeScript's display. `result.error` (and the `step` / `onError` / `onEvent` callback parameters) now render as the concrete literal union, e.g. `'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError`.

The error type was always correct; this only changes how it is displayed, so a typo like `result.error === 'NOT_FUOND'` now reads as an obvious compile error. Structurally identical types — no runtime or public API changes.
