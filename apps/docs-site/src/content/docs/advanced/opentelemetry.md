---
title: OpenTelemetry
description: Observability with traces and metrics
---

First-class OpenTelemetry metrics from the workflow event stream.

## Autotel adapter

Create an adapter that tracks metrics and optionally creates spans:

```typescript
import { createWorkflow, ok, err, type Result } from 'awaitly';
import { createAutotelAdapter } from 'awaitly/otel';

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

const autotel = createAutotelAdapter({
  serviceName: 'checkout-service',
  createStepSpans: true,        // Create spans for each step
  recordMetrics: true,          // Record step metrics
  recordRetryEvents: true,      // Record retry events
  markErrorsOnSpan: true,       // Mark errors on spans
  defaultAttributes: {          // Custom attributes for all spans
    environment: 'production',
  },
});

// Use with workflow
const workflow = createWorkflow(deps, {
  onEvent: autotel.handleEvent,
});

await workflow(async (step) => {
  const user = await step('fetch-user', () => deps.fetchUser(id));
  const charge = await step('charge-card', () => deps.chargeCard(100));
  return { user, charge };
});
```

## Access metrics

```typescript
const metrics = autotel.getMetrics();

console.log(metrics.stepDurations);
// [{ name: 'fetch-user', durationMs: 45, success: true }, ...]

console.log(metrics.retryCount);     // Total retry count
console.log(metrics.errorCount);     // Total error count
console.log(metrics.cacheHits);      // Cache hit count
console.log(metrics.cacheMisses);    // Cache miss count
```

## Simple event handler

For debug logging without full metrics collection:

```typescript
import { createWorkflow } from 'awaitly/workflow';
import { createAutotelEventHandler } from 'awaitly/otel';

const workflow = createWorkflow(deps, {
  onEvent: createAutotelEventHandler({
    serviceName: 'checkout',
    includeStepDetails: true,
  }),
});

// Set AUTOTEL_DEBUG=true to see console output
```

## With autotel tracing

Wrap workflows with actual OpenTelemetry spans:

```typescript
import { withAutotelTracing } from 'awaitly/otel';
import { trace } from 'autotel';

const traced = withAutotelTracing(trace, { serviceName: 'checkout' });

const result = await traced('process-order', async () => {
  return workflow(async (step) => {
    const user = await step('fetch-user', () => deps.fetchUser(id));
    const charge = await step('charge', () => deps.chargeCard(100));
    return { user, charge };
  });
}, { orderId: '123' }); // Optional attributes
```

## Configuration options

```typescript
{
  serviceName: string;           // Required: identifies the service
  createStepSpans?: boolean;     // Create spans for steps (default: false)
  recordMetrics?: boolean;       // Collect metrics (default: true)
  recordRetryEvents?: boolean;   // Track retries (default: true)
  markErrorsOnSpan?: boolean;    // Mark errors on spans (default: true)
  defaultAttributes?: Record<string, string>; // Added to all spans
}
```

## Span attributes

When `createStepSpans` is enabled, spans include:

| Attribute | Description |
|-----------|-------------|
| `workflow.step.name` | Step name from options |
| `workflow.step.key` | Step cache key (if set) |
| `workflow.step.cached` | Whether result was cached |
| `workflow.step.retry_count` | Number of retries |
| `workflow.step.duration_ms` | Step duration |
| `workflow.step.success` | Whether step succeeded |
| `workflow.step.error` | Error type (if failed) |

## Multiple workflows

Create separate adapters for different workflows:

```typescript
const checkoutTelemetry = createAutotelAdapter({
  serviceName: 'checkout-service',
  defaultAttributes: { workflow: 'checkout' },
});

const inventoryTelemetry = createAutotelAdapter({
  serviceName: 'inventory-service',
  defaultAttributes: { workflow: 'inventory' },
});

const checkoutWorkflow = createWorkflow(checkoutDeps, {
  onEvent: checkoutTelemetry.handleEvent,
});

const inventoryWorkflow = createWorkflow(inventoryDeps, {
  onEvent: inventoryTelemetry.handleEvent,
});
```

## Combining with other event handlers

```typescript
import { createWorkflow } from 'awaitly/workflow';
import { createAutotelAdapter } from 'awaitly/otel';
import { createVisualizer } from 'awaitly-visualizer';

const autotel = createAutotelAdapter({ serviceName: 'checkout' });
const viz = createVisualizer({ workflowName: 'checkout' });

const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    autotel.handleEvent(event);
    viz.handleEvent(event);
  },
});
```

## Custom metrics

Extend the adapter output with your own metrics:

```typescript
const autotel = createAutotelAdapter({ serviceName: 'checkout' });

const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    autotel.handleEvent(event);

    // Custom metric tracking
    if (event.type === 'step_complete' && !event.result.ok) {
      customMetrics.increment('checkout.step.failures', {
        step: event.stepName,
        error: String(event.result.error),
      });
    }
  },
});
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `AUTOTEL_DEBUG` | Set to `true` for console output |
| `OTEL_SERVICE_NAME` | Default service name (overridden by config) |

## Integration with OTEL collectors

The adapter works with standard OpenTelemetry collectors. Configure your collector endpoint:

```typescript
import { trace } from 'autotel';

// Configure your OTEL exporter
trace.configure({
  endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  headers: {
    'api-key': process.env.OTEL_API_KEY,
  },
});

const traced = withAutotelTracing(trace, { serviceName: 'checkout' });
```
