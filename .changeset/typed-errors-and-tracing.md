---
"awaitly": minor
"eslint-plugin-awaitly": minor
---

Automatic OpenTelemetry tracing, tagged errors that survive the wire, an
injectable clock, and a lint rule that keeps inferred error unions distinct.

## Tracing

Spans now cover runs, steps, retry attempts, parallel and race scopes, sagas,
compensations, and queued engine workflows. Register a provider once at startup
and your workflow structure reaches your tracing backend.

Each step runs inside its own active span, so spans from clients you already
instrument (pg, undici, your HTTP layer) nest inside the step that made the
call. The `onEvent` bridge could never do that: a callback fires beside the step
rather than inside it, so those spans landed in a flat pile next to the workflow.

Nesting needs a registered `ContextManager`. `NodeSDK` installs one. A
hand-built `BasicTracerProvider` does not, and without one every span starts its
own trace.

`@opentelemetry/api` is now a dependency. It no-ops until you register an SDK
and costs under a microsecond per step in that state, so tracing is on by
default. Turn it off with `AWAITLY_TELEMETRY=0`, `setTelemetryEnabled(false)`,
or `telemetry: false` on a single run, workflow, or engine. A per-run value
overrides the process setting in either direction.

Span status stays UNSET on success, since the spec reserves OK for the
application and a status set by instrumentation cannot be overridden. Read
`awaitly.outcome`.

The engine carries trace context from `enqueue()` to the worker. A queued
workflow can outlive the request that enqueued it, so its span starts a new
trace and records the enqueuing span as a link rather than parenting to a span
that may have ended hours earlier.

## Errors across the wire

`TaggedError.toJSON` preserves the discriminant, message, and enumerable props.
It omits the stack so a sender does not expose its file paths.

`fromPromise` and `tryAsync` accept `PromiseLike`, matching the `then` contract
each implementation already awaits. Framework and library thenables typecheck
without an adapter.

`awaitly/error-require-discriminant` joins `recommended-strict`. It reports
classes that extend `Error` without a string-literal `type` or `_tag`, which is
what keeps separate error classes distinct in inferred unions.

## Clock

Injectable `Clock` for deterministic retry, sleep, timeout, and circuit-breaker
tests.

**Breaking:** retry no longer retries `UnexpectedError` or untagged throws by
default. Typed errors still retry. Pass `retryIf: () => true` to opt back into
retrying throws.
