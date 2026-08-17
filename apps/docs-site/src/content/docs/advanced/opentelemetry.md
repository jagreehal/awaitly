---
title: OpenTelemetry
description: Automatic traces for runs, steps, retries, scopes, sagas, and durable execution
---

awaitly emits OpenTelemetry spans on its own. You write no adapter, no `onEvent` bridge, and no `runOtel` wrapper.

Configure a provider once at startup and every `run()` and `workflow.run()` joins the active trace. Without a provider, the same code hits OpenTelemetry's no-op implementation and costs about 0.2 microseconds per step.

## What you get that an event bridge cannot give you

awaitly runs each step inside its own active span. Any client you have already instrumented, your database driver, your HTTP client, your own custom spans, lands underneath the step that called it:

```text
POST /checkout
└─ run checkout
   ├─ step load-cart
   │  └─ pg.query          ← your database instrumentation, not awaitly's
   ├─ step charge
   │  ├─ attempt charge
   │  └─ attempt charge
   └─ parallel send-receipts
      ├─ undici.request
      └─ audit write
```

Building this from the `onEvent` stream is not possible. A callback fires beside the step rather than inside it, so spans you start from `step_start` cannot become the parent of work the step goes on to do. Your database spans end up in a flat pile next to the workflow instead of inside it.

## You need a ContextManager

That nesting depends on a registered `ContextManager`. Register one or every span starts its own trace:

```text
without a ContextManager          with a ContextManager
─────────────────────────         ─────────────────────────
pg.query      trace 42a2…         POST /checkout  trace 2076…
step load-cart trace dc70…        └─ run checkout
run checkout  trace 0cf9…            └─ step load-cart
                                        └─ pg.query
```

`NodeSDK` registers one for you. A hand-built `BasicTracerProvider` does not, so add `AsyncLocalStorageContextManager` yourself:

```typescript
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(new BasicTracerProvider({ /* ... */ }));
```

## Setup with Autotel

[Autotel](https://github.com/jagreehal/autotel) wires traces, metrics, logs, export, and shutdown from one entry point, including the context manager. awaitly reads the same global provider, so its spans show up without wrappers:

```typescript
import { init, shutdown } from 'autotel';
import { createWorkflow, ok } from 'awaitly';

init({
  service: 'checkout-api',
  devtools: true,
});

const checkout = createWorkflow('checkout', {
  loadCart: async (cartId: string) => ok({ id: cartId, total: 42 }),
  charge: async (total: number) => ok({ paymentId: 'pay-1', total }),
});

const result = await checkout.run(async ({ step, deps }) => {
  const cart = await step('load-cart', () => deps.loadCart('cart-1'));
  return step('charge', () => deps.charge(cart.total));
});

await shutdown();
```

`init()` is the whole observability setup here. Skip Autotel's `trace()` helper around awaitly steps, since awaitly already opens the run and step spans.

## Setup with the OpenTelemetry SDK

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  serviceName: 'checkout-api',
  traceExporter: new OTLPTraceExporter(),
});

sdk.start();

// Import application code after the SDK starts.
await import('./app.js');

await sdk.shutdown();
```

`NodeSDK` brings its own context manager. Set the endpoint, headers, sampling, and resource attributes through the SDK or the standard `OTEL_*` environment variables.

## Spans

| Span | Created for |
| --- | --- |
| `run <workflow>` | `run()` and `workflow.run()` |
| `step <name>` | Steps, including the error-mapping variants |
| `attempt <name>` | Each physical attempt, once retry is configured |
| `parallel <name>` | `step.all()` |
| `race <name>` | `step.race()` |
| `saga` | Low-level `runSaga()` |
| `saga step <name>` | Low-level saga steps |
| `compensate <name>` | Saga rollback actions |
| `engine process <workflow>` | One queued workflow the engine picks up |

Span status stays UNSET on success, because the OpenTelemetry spec reserves OK for the application and instrumentation cannot be overridden once it sets a status. Read `awaitly.outcome` instead. Failures set ERROR, and a cancelled operation records `cancelled` without marking the span failed.

## Attributes

awaitly records identifiers and bounded semantic fields. Result values and workflow input stay out of telemetry.

| Attribute | Meaning |
| --- | --- |
| `awaitly.workflow.id` | Execution ID |
| `awaitly.workflow.name` | Workflow name, when available |
| `awaitly.step.id` | Physical step execution ID |
| `awaitly.step.name` | Step name |
| `awaitly.step.key` | Explicit cache or resume key, when present |
| `awaitly.step.attempt` | Current retry attempt |
| `awaitly.step.max_attempts` | Configured attempt limit |
| `awaitly.scope.id` | Scope execution ID |
| `awaitly.scope.name` | Scope name |
| `awaitly.scope.type` | `parallel`, `race`, or `allSettled` |
| `awaitly.outcome` | `success`, `error`, or `cancelled` |
| `error.type` | Typed error discriminant or thrown error class |

Typed error payloads never reach span attributes, which keeps customer IDs, payment details, and validation input out of your tracing backend.

## Add your own spans inside a step

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('checkout-api');

const user = await step('load-user', () =>
  tracer.startActiveSpan('database query', async (span) => {
    try {
      return await deps.loadUser(userId);
    } finally {
      span.end();
    }
  })
);
```

`database query` lands under `step load-user`.

## Durable engine propagation

`createEngine().enqueue()` injects the active context into the queued snapshot, and `engine.tick()` extracts it before running the workflow. Baggage and anything else riding on context reaches the workflow that way.

The job span starts a new trace and records the enqueuing span as a link. A queued workflow can sit in the store for hours and survive a process restart, so parenting it to the enqueuing request would hold that request's trace open until the job drains, and backends drop or mis-render spans arriving that late. Links express the same causality without the cost, which is what the OpenTelemetry messaging conventions call for. Jaeger, Honeycomb, and Datadog all render the jump.

The carrier uses your configured global propagator. With the W3C propagator, the snapshot metadata holds `traceparent` and an optional `tracestate`.

## Turning it off

Three levels, narrowest wins:

```typescript
// One run, one workflow, or one engine
await run(work, { telemetry: false });
await checkout.run(workflowFn, { telemetry: false });
createEngine({ store, workflows, telemetry: false });

// The whole process, from code
import { setTelemetryEnabled } from 'awaitly';
setTelemetryEnabled(false);
```

```bash
# The whole process, no code change and no redeploy
AWAITLY_TELEMETRY=0 node server.js
```

A per-run `telemetry` value overrides the process setting in both directions, so you can keep tracing one workflow while the rest of the process stays quiet:

```typescript
setTelemetryEnabled(false);
await checkout.run(workflowFn, { telemetry: true }); // still traced
```

Turning awaitly's spans off leaves your other instrumentation alone. Your database and HTTP clients keep tracing.

## Metrics and logs

Automatic tracing stays inside the small `run` path, and awaitly pulls no metric or log SDK into that bundle.

Reach for Autotel when you want one provider covering trace export, log correlation, and application metrics. For workflow metrics, read the typed event stream:

```typescript
import { metrics } from '@opentelemetry/api';
import { createWorkflow } from 'awaitly';

const meter = metrics.getMeter('checkout-api');
const retries = meter.createCounter('awaitly.step.retries');

const checkout = createWorkflow('checkout', deps, {
  onEvent(event) {
    if (event.type === 'step_retry') {
      retries.add(1, { step: event.name ?? event.stepId });
    }
  },
});
```

You keep metric names and cardinality under your own control, and the event stream stays available for structured logs and product events.

## Testing

Pair `InMemorySpanExporter` with `SimpleSpanProcessor`, then assert span names, attributes, and parent IDs after `provider.forceFlush()`. Register `AsyncLocalStorageContextManager` in the test too, or parent assertions fail for the same reason they fail in production. Drive the test through `run()` or `workflow.run()` so it exercises the propagation path your service uses.

```typescript
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
trace.setGlobalTracerProvider(provider);

await run(work, { workflowName: 'checkout' });
await provider.forceFlush();

const names = exporter.getFinishedSpans().map((span) => span.name);
```
