---
"awaitly-durable-lambda": minor
"eslint-plugin-awaitly": minor
"awaitly-analyze": minor
"awaitly": minor
---

Add AWS Lambda durable functions support.

- `awaitly-durable-lambda`: a drop-in, typed handler facade over `@aws/durable-execution-sdk-js`, with typed `context.invoke` through `durableFunction()`, `validateEvent()` for Standard Schema event validation, `replayDiagnostics()`, and typed test runners in `awaitly-durable-lambda/testing`. It works with AWS's OpenTelemetry plugin and autotel-aws through the native `plugins` option.
- `eslint-plugin-awaitly`: `durable-no-nondeterminism`, `durable-context-scope`, `durable-callback-timeout`, and `durable-no-step-closure-mutation`, in `recommended` and as the `durable` config.
- `awaitly-analyze`: diagrams of durable handlers, covering steps, waits, callbacks, invokes, `parallel`, `map`, child contexts, and early returns.
- `awaitly`: `durable-*` slugs.
