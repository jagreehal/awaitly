---
'awaitly': patch
---

OpenTelemetry spans now show your code's errors and call sites.

- A throw recorded as an `UnexpectedError` puts what your code threw on the `exception` event and the span status: its class as `exception.type`, its message and its stack. `error.type` stays `UnexpectedError`.
- A typed error with an `Error` as `cause` (`err({ type: 'SEND_FAILED', cause })`) adds that error's message and stack to the `exception` event and the span status. Its other fields stay out of telemetry.
- `exception.type` matches `error.type` on every span: `TimeoutError` where it used to read `runtime-step-timeout`.
- A step called from the callback you pass to `run()` or `workflow.run()` records no `code.function.name`. A step called from a named function records that function's name.
