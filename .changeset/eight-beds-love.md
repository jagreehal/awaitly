---
'awaitly': minor
---

Simplify the `step` API surface and unify retry/error ergonomics:

- `step.try(...)` now accepts inline `retry`, `timeout`, and `compensate` options (in addition to `error` / `onError`) so edge handling can be configured in one place.
- Parallel helper naming is consolidated on `step.all(...)`; references and typings now use `all` as the canonical API.
- Removed deprecated effect-style helpers from `step`: `run`, `andThen`, `match`, `parallel`, `allSettled`, and `tryBoundary`.
- `RetryOptions<E>` is now the canonical retry config across retry surfaces, using `attempts` / `initialDelay` and `shouldRetry`.
- `UnexpectedError` is the canonical wrapped error for unexpected failures, and `AwaitlyError` / `isAwaitlyError` include it.
