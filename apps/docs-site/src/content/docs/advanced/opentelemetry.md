---
title: OpenTelemetry
description: Automatic traces and metrics for runs, steps, retries, scopes, sagas, and durable execution
---

awaitly emits OpenTelemetry spans on its own. You write no adapter, no `onEvent` bridge, and no `runOtel` wrapper.

Configure a provider once at startup and every `run()` and `workflow.run()` joins the active trace. Without a provider, the same code hits OpenTelemetry's no-op implementation and costs about 0.3 microseconds per step.

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

## Nothing to wrap

`run()` starts the span before it calls your function, and `step()` starts one before it calls yours. Your code already runs inside a span, so a wrapper around either gives you two spans for one call:

```typescript
// Two spans for one step
await step('charge', () => trace(charge)(args, deps));

// One span, named by the step
await step('charge', () => deps.charge(args));
```

Work you `await` without a `step()` gets no span of its own and reports under `run`. Wrap the functions no step calls, such as route handlers and cron entry points.

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
| `run <workflow>` | `run()` and `workflow.run()`. The name comes from `run(fn, { workflowName: 'checkout' })`, `createWorkflow('checkout', deps)`, or else a named callback (`run(async function checkout() {...})`). An inline arrow gives plain `run`, and awaitly warns once while an SDK is recording. Minifiers rename functions, so pass `workflowName` in minified builds |
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
| `code.file.path`, `code.line.number`, `code.column.number`, `code.function.name` | The line of your code that started the run or step |

Typed error payloads never reach span attributes, which keeps customer IDs, payment details, and validation input out of your tracing backend. A typed failure still records an `exception` event, carrying only `exception.type`, so your backend's exception views include it.

## Find the line that ran

Run and step spans carry the OpenTelemetry `code.*` attributes for the line of your code that called them, so a slow span in Tempo or Honeycomb takes you to `checkout.ts:29`. awaitly reads the stack only when a span is recording, so an app with no SDK skips that work.

Run Node with `--enable-source-maps` to map bundled code back to your source files. In minified builds, `code.function.name` shows the minified name.

## Span events

awaitly records point-in-time moments as events on the span they happened in:

| Event | On | Attributes |
| --- | --- | --- |
| `awaitly.step.retry` | step | `awaitly.step.attempt` (the attempt about to run), `awaitly.step.max_attempts`, `awaitly.retry.delay_ms`, `error.type` |
| `awaitly.step.retries_exhausted` | step | `awaitly.step.attempt`, `error.type` |
| `awaitly.step.timeout` | step | `awaitly.step.timeout_ms`, `awaitly.step.attempt` |
| `awaitly.step.cache_hit` | run | `awaitly.step.name`, `awaitly.step.key` |
| `awaitly.step.skipped` | run or step | `awaitly.step.name`, `awaitly.decision.id` |
| `awaitly.decision` | run or step | `awaitly.decision.id`, `awaitly.decision.branch`, `awaitly.decision.label` |

A decision event records the branch it took and leaves out the value it tested.

## Attributes for a whole run

Pass `attributes` to put the same attributes on a run's span and every span inside it, nested workflows included. Use it for request-scoped ids you want to filter traces by:

```typescript
await checkout.run(workflowFn, { attributes: { 'tenant.id': tenantId } });
await run(work, { attributes: { 'tenant.id': tenantId } });
createWorkflow('checkout', deps, { attributes: { 'deployment.region': 'eu' } });
```

`annotateSpan()` sets attributes on the span running right now: the step span inside a step, else the run span. It does nothing when no SDK is recording.

```typescript
import { annotateSpan } from 'awaitly';

await step('charge', () => {
  annotateSpan({ 'payment.provider': 'stripe' });
  return deps.charge(order);
});
```

## Incoming requests and messages

`createWebhookHandler()` continues the caller's trace from the request's `traceparent` header, and `createEventHandler()` from `traceparent` in the message metadata. When HTTP instrumentation has already opened a server span for the request, that span stays the parent. Both use your registered propagator, so register one (`NodeSDK` does).

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

## Metrics

With a `MeterProvider` registered (`NodeSDK` and Autotel both register one), awaitly records:

| Metric | Type | Attributes |
| --- | --- | --- |
| `awaitly.workflow.duration` | histogram, seconds | `awaitly.workflow.name`, `awaitly.outcome`, `error.type` |
| `awaitly.step.duration` | histogram, seconds | `awaitly.workflow.name`, `awaitly.step.name`, `awaitly.outcome`, `error.type` |
| `awaitly.step.retries` | counter | `awaitly.workflow.name`, `awaitly.step.name`, `error.type` of the failed attempt |

Workflow and step names are literal ids, so these attributes stay low-cardinality. awaitly leaves out run ids, step keys and payloads. An unnamed run has no `awaitly.workflow.name`. With no `MeterProvider`, awaitly skips metric timing.

`telemetry: false` turns metrics off along with spans.

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

`awaitly/testing` turns the finished spans into a tree for an inline snapshot. It reads them structurally, so it adds no SDK dependency:

```typescript
import { formatSpanTree, spanTree } from 'awaitly/testing';

expect(formatSpanTree(exporter.getFinishedSpans())).toMatchInlineSnapshot(`
  "run checkout ✗ CARD_DECLINED
    step load
    step charge ✗ CARD_DECLINED"
`);

const [root] = spanTree(exporter.getFinishedSpans()); // { name, attributes, events, status, children }
```

## See production runs on the diagram

`awaitly-analyze --trace` reads OpenTelemetry spans as well as recorded events: an OTLP JSON export, or a trace fetched from Tempo (`GET /api/v2/traces/<id>`, one trace or an array of them). The analyzer matches step spans to the diagram by step name, and by `code.line.number` when two steps share one.

With `--format=xstate`, the output pairs the workflow's MachineJSON with [autovisualizer](https://github.com/jagreehal/autovisualizer) `counts`: how often each step succeeded or failed, which way each decision went, and how often each compensation ran. autovisualizer draws a transition with a count of 0 as a dashed line.

```bash
awaitly-analyze src/checkout.ts --format=xstate --trace=tempo-traces.json > checkout.json
```

```html
<auto-visualizer id="checkout"></auto-visualizer>
<script type="module">
  const { definition, counts } = await (await fetch('/checkout.json')).json();
  const chart = document.getElementById('checkout');
  chart.setAttribute('definition', JSON.stringify(definition));
  chart.setAttribute('counts', JSON.stringify(counts));
</script>
```

From code, `tracesFromSpans()` and `countsFromTraces()` in `awaitly-analyze` do the same.
