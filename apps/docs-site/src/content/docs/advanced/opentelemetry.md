---
title: OpenTelemetry
description: Observability with traces and metrics
---

Every workflow emits a typed event stream through the `onEvent` option. Wiring those events into OpenTelemetry gives you spans and metrics without any awaitly-specific adapter.

:::note
A first-class OpenTelemetry adapter is planned as a separate ecosystem package. Until it ships, the event stream shown below is the supported integration point.
:::

## The event stream

`createWorkflow` accepts an `onEvent` callback that receives a `WorkflowEvent` for everything the engine does — workflow lifecycle, step lifecycle, retries, timeouts, and cache activity:

```typescript
import { ok, err, type Result } from 'awaitly';
import { createWorkflow, type WorkflowEvent } from 'awaitly/workflow';

// Define your dependencies with Result-returning functions
type UserNotFound = { type: 'USER_NOT_FOUND'; id: string };
type CardDeclined = { type: 'CARD_DECLINED'; reason: string };

const deps = {
  fetchUser: async (id: string): Promise<Result<User, UserNotFound>> => {
    const user = await db.users.find(id);
    return user ? ok(user) : err({ type: 'USER_NOT_FOUND', id });
  },
  chargeCard: async (amount: number): Promise<Result<Charge, CardDeclined>> => {
    const result = await paymentGateway.charge(amount);
    return result.success
      ? ok(result.charge)
      : err({ type: 'CARD_DECLINED', reason: result.error });
  },
};

const workflow = createWorkflow('checkout', deps, {
  onEvent: (event) => {
    if (event.type === 'step_start') {
      console.log(`Step ${event.name ?? event.stepId} started`);
    }
    if (event.type === 'step_success') {
      console.log(`Step ${event.name ?? event.stepId} took ${event.durationMs}ms`);
    }
  },
});

await workflow.run(async ({ step, deps }) => {
  const user = await step('fetch-user', () => deps.fetchUser(id));
  const charge = await step('charge-card', () => deps.chargeCard(100));
  return { user, charge };
});
```

## Spans from workflow events

Map workflow and step events onto OpenTelemetry spans. Start a span on `step_start`, end it on `step_success`/`step_error`, and use `stepId` to correlate:

```typescript
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { createWorkflow, type WorkflowEvent } from 'awaitly/workflow';

const tracer = trace.getTracer('checkout-service');

function createSpanHandler() {
  let workflowSpan: Span | undefined;
  const stepSpans = new Map<string, Span>();

  return (event: WorkflowEvent<unknown>) => {
    switch (event.type) {
      case 'workflow_start':
        workflowSpan = tracer.startSpan(`workflow ${event.workflowName ?? event.workflowId}`);
        break;

      case 'workflow_success':
        workflowSpan?.setStatus({ code: SpanStatusCode.OK });
        workflowSpan?.end();
        break;

      case 'workflow_error':
        workflowSpan?.setStatus({ code: SpanStatusCode.ERROR });
        workflowSpan?.end();
        break;

      case 'step_start': {
        const span = tracer.startSpan(`step ${event.name ?? event.stepId}`, {
          attributes: {
            'workflow.id': event.workflowId,
            'workflow.step.id': event.stepId,
            'workflow.step.key': event.stepKey,
          },
        });
        stepSpans.set(event.stepId, span);
        break;
      }

      case 'step_success': {
        const span = stepSpans.get(event.stepId);
        span?.setAttribute('workflow.step.duration_ms', event.durationMs);
        span?.setStatus({ code: SpanStatusCode.OK });
        span?.end();
        stepSpans.delete(event.stepId);
        break;
      }

      case 'step_error': {
        const span = stepSpans.get(event.stepId);
        span?.setAttribute('workflow.step.duration_ms', event.durationMs);
        span?.setStatus({
          code: SpanStatusCode.ERROR,
          message: String(event.error),
        });
        span?.end();
        stepSpans.delete(event.stepId);
        break;
      }
    }
  };
}

const workflow = createWorkflow('checkout', deps, {
  onEvent: createSpanHandler(),
});
```

## Metrics from workflow events

The same stream drives counters and histograms. Retry and cache events are first-class, so you do not have to derive them:

```typescript
import { metrics } from '@opentelemetry/api';
import { createWorkflow, type WorkflowEvent } from 'awaitly/workflow';

const meter = metrics.getMeter('checkout-service');

const stepDuration = meter.createHistogram('workflow.step.duration', { unit: 'ms' });
const stepErrors = meter.createCounter('workflow.step.errors');
const stepRetries = meter.createCounter('workflow.step.retries');
const cacheHits = meter.createCounter('workflow.step.cache_hits');
const cacheMisses = meter.createCounter('workflow.step.cache_misses');

function recordMetrics(event: WorkflowEvent<unknown>) {
  switch (event.type) {
    case 'step_success':
      stepDuration.record(event.durationMs, { step: event.name ?? event.stepId });
      break;
    case 'step_error':
      stepDuration.record(event.durationMs, { step: event.name ?? event.stepId });
      stepErrors.add(1, { step: event.name ?? event.stepId });
      break;
    case 'step_retry':
      stepRetries.add(1, {
        step: event.name ?? event.stepId,
        attempt: event.attempt,
      });
      break;
    case 'step_cache_hit':
      cacheHits.add(1, { step: event.stepKey });
      break;
    case 'step_cache_miss':
      cacheMisses.add(1, { step: event.stepKey });
      break;
  }
}

const workflow = createWorkflow('checkout', deps, {
  onEvent: recordMetrics,
});
```

## Event reference

The events most useful for observability:

| Event `type` | When it fires | Key fields |
|--------------|---------------|------------|
| `workflow_start` | Run begins | `workflowId`, `workflowName`, `ts` |
| `workflow_success` | Run returns `ok` | `durationMs` |
| `workflow_error` | Run returns `err` | `durationMs`, `error` |
| `step_start` | Step begins (once, before first attempt) | `stepId`, `stepKey`, `name` |
| `step_success` | Step succeeds | `durationMs` |
| `step_error` | Step fails | `durationMs`, `error`, `diagnostics` |
| `step_retry` | Attempt failed, retry scheduled | `attempt`, `maxAttempts`, `delayMs`, `error` |
| `step_retries_exhausted` | All attempts failed | `attempts`, `lastError` |
| `step_timeout` | Step hit its timeout | `timeoutMs`, `attempt` |
| `step_cache_hit` / `step_cache_miss` | Keyed step consulted the cache | `stepKey` |
| `step_skipped` | Conditional step did not run | `reason` |

All events carry `workflowId`, an optional `workflowName`, and a `ts` timestamp; discriminate on `event.type` and TypeScript narrows the rest.

## Combining with other event handlers

`onEvent` is a single callback, so fan out to as many consumers as you need:

```typescript
import { createWorkflow } from 'awaitly/workflow';
import { createVisualizer } from 'awaitly-visualizer';

const spans = createSpanHandler();
const viz = createVisualizer({ workflowName: 'checkout' });

const workflow = createWorkflow('checkout', deps, {
  onEvent: (event) => {
    spans(event);
    recordMetrics(event);
    viz.handleEvent(event);
  },
});
```

## Custom metrics

Anything else you want to track hangs off the same switch. For example, counting business-level failures by error type:

```typescript
const declinedCards = meter.createCounter('checkout.card_declines');

const workflow = createWorkflow('checkout', deps, {
  onEvent: (event) => {
    recordMetrics(event);

    if (event.type === 'step_error' && (event.error as { type?: string }).type === 'CARD_DECLINED') {
      declinedCards.add(1, { step: event.name ?? event.stepId });
    }
  },
});
```

## Exporting

Span and metric export is standard OpenTelemetry SDK configuration — nothing awaitly-specific. Point your `NodeSDK` (or equivalent) at your collector and the handlers above feed it:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  serviceName: 'checkout-service',
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: { 'api-key': process.env.OTEL_API_KEY },
  }),
});

sdk.start();
```
