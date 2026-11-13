---
"awaitly-analyze": minor
---

Diagrams and XState output show saga rollback.

- Mermaid draws each `compensate` callback as an undo edge, in LIFO order, with the `SagaCompensationError` path. The CLI picks Mermaid for compensated sagas, and `--no-errors` hides the rollback.
- `--format=xstate` gives each compensation its own state. A failing step, child workflow or saga step enters the compensations recorded on the path that ran. A failed compensation lets the older ones run and ends on `compensation_failed`, matching the runtime.
- Loops and parallel blocks roll back through an `<id>_undo` state: send `undo:<compensation>` for each completed iteration or parallel step, then `done`. `allSettled` holds rollback until every branch settles.
