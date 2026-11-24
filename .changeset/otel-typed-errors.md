---
"awaitly": minor
"eslint-plugin-awaitly": minor
---

Typed errors keep their messages and fields out of spans. A `TaggedError` records ERROR status and `error.type`, plus the message and stack of the `Error` it carries as `cause`. Spans add an `exception` event when something threw, including a throw that `step.try` or `catchUnexpected` maps to a typed error.

`instanceof TaggedError` recognizes errors across `awaitly`, `awaitly/durable` and `awaitly/testing`. Failed `runSaga` results carry `cause`.

The lint rule `awaitly/workflow-unnamed-trace` flags runs that trace as a bare `run`, in ESLint and oxlint.
