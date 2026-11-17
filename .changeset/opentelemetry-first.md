---
"awaitly": minor
"awaitly-analyze": minor
---

OpenTelemetry metrics, span events and call sites, plus production run counts on the analyzer diagram.

awaitly:

- Run spans take their name from `workflowName`, the `createWorkflow` name, or a named callback. An inline arrow traces as `run`, and awaitly warns once while an SDK is recording.
- Run and step spans carry `code.file.path`, `code.line.number`, `code.column.number` and `code.function.name` for the line that started them.
- With a `MeterProvider` registered, awaitly records `awaitly.workflow.duration` and `awaitly.step.duration` histograms and an `awaitly.step.retries` counter.
- Retries, timeouts, cache hits, skipped steps and decisions appear as span events.
- `attributes` on `run()`, `createWorkflow()` and `workflow.run()` applies to every span in the run, nested runs included. `annotateSpan()` sets attributes on the current span.
- Typed errors record an `exception` event with `exception.type` only.
- `createWebhookHandler()` and `createEventHandler()` continue the caller's trace from `traceparent`.
- `spanTree()` and `formatSpanTree()` in `awaitly/testing` give you span trees for inline snapshots.

awaitly-analyze:

- `--trace` reads OTLP JSON and Tempo traces. With `--format=xstate` it outputs `{ definition, counts }` for autovisualizer, counting each step outcome, decision branch and compensation.
- New exports: `tracesFromSpans` and `countsFromTraces`.
