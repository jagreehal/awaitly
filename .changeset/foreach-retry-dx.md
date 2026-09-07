---
"awaitly-analyze": patch
"awaitly": minor
---

`step.retry` and `step.withTimeout` accept `errors: [...]`, so a tag raised by a custom `onTimeout` handler or an attempt can be declared on the call itself.

Static analysis reads a `step.forEach` `run` body that is `step.retry` or `step.withTimeout` as that helper, keeping its retry or timeout policy on the loop body and inferring its errors from the dep signature. Mermaid labels a `step.forEach` with its loop id, `stepIdPattern`, and `max` bound, draws the `IterationLimitError` exit for a bounded loop, includes backoff on retry nodes, and emits only the style classes a diagram uses.
