# OpenTelemetry Integration

Collect metrics and create spans from workflow events using the autotel adapter. Get observability into your workflows without modifying business logic.

## Table of Contents

- [Overview](#overview)
- [Basic Setup](#basic-setup)
- [Adapter Configuration](#adapter-configuration)
- [Collected Metrics](#collected-metrics)
- [Tracing Integration](#tracing-integration)
- [Debug Mode](#debug-mode)
- [API Reference](#api-reference)

## Overview

The autotel adapter translates workflow events into metrics and optionally creates OpenTelemetry spans:

```typescript
import { createAutotelAdapter } from 'awaitly/otel';
import { createWorkflow } from 'awaitly';

// Create adapter
const otel = createAutotelAdapter({ serviceName: 'checkout' });

// Wire into workflow
const workflow = createWorkflow(deps, {
  onEvent: otel.handleEvent,
});

// Automatic tracking:
// - Step durations
// - Retry counts
// - Error counts
// - Cache hit/miss rates
```

## Basic Setup

### Create Adapter

```typescript
import { createAutotelAdapter } from 'awaitly/otel';

const otel = createAutotelAdapter({
  serviceName: 'checkout',
});
```

### Connect to Workflow

```typescript
import { createWorkflow } from 'awaitly';

const workflow = createWorkflow(deps, {
  onEvent: otel.handleEvent,
});
```

### Run and Inspect Metrics

```typescript
const result = await workflow(async (step) => {
  const user = await step(() => fetchUser(id), { name: 'fetch-user' });
  const payment = await step(() => chargeCard(amount), { name: 'charge-card' });
  return { user, payment };
});

// Get collected metrics
const metrics = otel.getMetrics();
console.log({
  stepDurations: metrics.stepDurations,
  retryCount: metrics.retryCount,
  errorCount: metrics.errorCount,
  cacheHits: metrics.cacheHits,
  cacheMisses: metrics.cacheMisses,
});
```

## Adapter Configuration

```typescript
interface AutotelAdapterConfig {
  // Service name prefix for spans/metrics
  // Default: 'workflow'
  serviceName?: string;

  // Create spans for each step
  // Default: true
  createStepSpans?: boolean;

  // Record step metrics
  // Default: true
  recordMetrics?: boolean;

  // Custom attributes for all spans
  defaultAttributes?: Record<string, string | number | boolean>;

  // Record retry events as span events
  // Default: true
  recordRetryEvents?: boolean;

  // Mark workflow errors as span errors
  // Default: true
  markErrorsOnSpan?: boolean;
}
```

### Configuration Examples

**Basic:**

```typescript
const otel = createAutotelAdapter({
  serviceName: 'order-service',
});
```

**With Default Attributes:**

```typescript
const otel = createAutotelAdapter({
  serviceName: 'order-service',
  defaultAttributes: {
    'service.version': '1.0.0',
    'deployment.environment': process.env.NODE_ENV ?? 'development',
  },
});
```

**Metrics Only (No Spans):**

```typescript
const otel = createAutotelAdapter({
  serviceName: 'order-service',
  createStepSpans: false,  // Don't create spans
  recordMetrics: true,
});
```

**Full Configuration:**

```typescript
const otel = createAutotelAdapter({
  serviceName: 'checkout',
  createStepSpans: true,
  recordMetrics: true,
  recordRetryEvents: true,
  markErrorsOnSpan: true,
  defaultAttributes: {
    'service.name': 'checkout-service',
    'service.version': '2.1.0',
    'service.namespace': 'ecommerce',
  },
});
```

## Collected Metrics

### Step Durations

```typescript
const metrics = otel.getMetrics();

for (const step of metrics.stepDurations) {
  console.log({
    name: step.name,           // 'checkout.fetch-user'
    durationMs: step.durationMs,
    success: step.success,
    attributes: step.attributes,
  });
}
```

### Counters

```typescript
const metrics = otel.getMetrics();

console.log({
  retryCount: metrics.retryCount,    // Total retries across all steps
  errorCount: metrics.errorCount,    // Total errors (steps + workflow)
  cacheHits: metrics.cacheHits,      // Cache hits
  cacheMisses: metrics.cacheMisses,  // Cache misses
});
```

### Active Spans

```typescript
const active = otel.getActiveSpansCount();
console.log({
  workflows: active.workflows,  // Currently running workflows
  steps: active.steps,          // Currently running steps
});
```

### Resetting Metrics

```typescript
otel.reset();  // Clear all metrics and active spans
```

## Tracing Integration

### With Autotel Library

```typescript
import { init, trace } from 'autotel';
import { withAutotelTracing, createAutotelAdapter } from 'awaitly/otel';

// Initialize autotel
init({
  service: 'checkout-api',
  endpoint: 'http://localhost:4318/v1/traces',
});

// Create tracing wrapper
const traced = withAutotelTracing(trace, { serviceName: 'checkout' });

// Create adapter for metrics
const otel = createAutotelAdapter({ serviceName: 'checkout' });

// Use both
const result = await traced('process-order', async () => {
  const workflow = createWorkflow(deps, {
    onEvent: otel.handleEvent,
  });

  return workflow(async (step) => {
    // Steps are tracked by adapter
    const user = await step(() => fetchUser(id), { name: 'fetch-user' });
    return user;
  });
}, {
  'order.id': orderId,
  'user.id': userId,
});
```

### Custom Span Attributes

```typescript
const traced = withAutotelTracing(trace, { serviceName: 'checkout' });

const result = await traced(
  'process-payment',
  async () => { /* workflow */ },
  {
    'payment.amount': amount,
    'payment.currency': 'USD',
    'user.tier': user.tier,
  }
);
```

## Debug Mode

### Console Logging

Enable debug logging with the `AUTOTEL_DEBUG` environment variable:

```bash
AUTOTEL_DEBUG=true node app.js
```

Or use the event handler directly:

```typescript
import { createAutotelEventHandler } from 'awaitly/otel';

const handler = createAutotelEventHandler({
  serviceName: 'checkout',
  includeStepDetails: true,
});

const workflow = createWorkflow(deps, {
  onEvent: handler,
});

// With AUTOTEL_DEBUG=true, logs:
// [checkout] Workflow started: wf_123
// [checkout] Step started: fetch-user
// [checkout] Step success: fetch-user (45ms)
// [checkout] Workflow success: wf_123 (120ms)
```

### Combining Handlers

```typescript
const otel = createAutotelAdapter({ serviceName: 'checkout' });
const debug = createAutotelEventHandler({ serviceName: 'checkout' });

const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    otel.handleEvent(event);  // Collect metrics
    debug(event);             // Debug logging
  },
});
```

## API Reference

### Functions

| Function | Description |
|----------|-------------|
| `createAutotelAdapter(config?)` | Create metrics/spans adapter |
| `createAutotelEventHandler(options?)` | Create debug event handler |
| `withAutotelTracing(traceFn, options?)` | Create tracing wrapper |

### AutotelAdapter Methods

| Method | Description |
|--------|-------------|
| `handleEvent(event)` | Process workflow event |
| `getActiveSpansCount()` | Get active workflow/step counts |
| `getMetrics()` | Get collected metrics |
| `reset()` | Clear all state |

### Types

```typescript
interface AutotelMetrics {
  stepDurations: Array<{
    name: string;
    durationMs: number;
    success: boolean;
    attributes?: Record<string, string | number | boolean>;
  }>;
  retryCount: number;
  errorCount: number;
  cacheHits: number;
  cacheMisses: number;
  defaultAttributes: Record<string, string | number | boolean>;
}

interface AutotelAdapter {
  handleEvent: (event: WorkflowEvent<unknown>) => void;
  getActiveSpansCount: () => { workflows: number; steps: number };
  getMetrics: () => AutotelMetrics;
  reset: () => void;
}
```

### Events Tracked

| Event | Metrics Updated |
|-------|-----------------|
| `workflow_start` | Active workflows +1 |
| `workflow_success` | Active workflows -1 |
| `workflow_error` | Active workflows -1, errorCount +1 |
| `step_start` | Active steps +1 |
| `step_success` | Active steps -1, stepDurations +1 |
| `step_error` | Active steps -1, stepDurations +1, errorCount +1 |
| `step_retry` | retryCount +1 |
| `step_cache_hit` | cacheHits +1 |
| `step_cache_miss` | cacheMisses +1 |
