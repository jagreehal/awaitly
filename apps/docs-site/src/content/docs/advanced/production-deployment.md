---
title: Production Deployment
description: Deploy awaitly workflows to production
---

Best practices for running awaitly in production: observability, error tracking, persistence, and scaling.

## Observability with OpenTelemetry

### Basic setup

```typescript
import { createAutotelAdapter } from 'awaitly/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Initialize OpenTelemetry SDK
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
  }),
  serviceName: 'checkout-service',
});
sdk.start();

// Create awaitly adapter
const otel = createAutotelAdapter({ serviceName: 'checkout-service' });

// Use in workflow
const workflow = createWorkflow('workflow', deps, {
  onEvent: otel.handleEvent,
});
```

### Custom span attributes

```typescript
import { createAutotelAdapter } from 'awaitly/otel';

const otel = createAutotelAdapter({
  serviceName: 'checkout-service',
  enrichSpan: (span, event) => {
    // Add custom attributes based on event type
    if (event.type === 'step_start') {
      span.setAttribute('step.name', event.name ?? 'unnamed');
      span.setAttribute('step.key', event.stepKey ?? '');
    }

    if (event.type === 'step_complete') {
      span.setAttribute('step.duration_ms', event.durationMs ?? 0);
      span.setAttribute('step.cached', event.cached ?? false);
    }

    if (event.type === 'step_error') {
      span.setAttribute('error.type', typeof event.error === 'string' ? event.error : 'object');
    }
  },
});
```

### Datadog integration

```typescript
// Using Datadog's OTLP endpoint
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const exporter = new OTLPTraceExporter({
  url: 'https://trace.agent.datadoghq.com/v1/traces',
  headers: {
    'DD-API-KEY': process.env.DD_API_KEY,
  },
});
```

### Grafana Cloud / Tempo

```typescript
const exporter = new OTLPTraceExporter({
  url: `https://tempo-us-central1.grafana.net/tempo/v1/traces`,
  headers: {
    Authorization: `Basic ${Buffer.from(`${process.env.GRAFANA_USER}:${process.env.GRAFANA_API_KEY}`).toString('base64')}`,
  },
});
```

### Metrics collection

```typescript
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

// Setup metrics
const meterProvider = new MeterProvider();
meterProvider.addMetricReader(new PrometheusExporter({ port: 9464 }));

const meter = meterProvider.getMeter('awaitly-workflows');
const workflowDuration = meter.createHistogram('workflow_duration_ms');
const stepErrors = meter.createCounter('step_errors_total');

// Custom event handler with metrics
function handleWorkflowEvent(event: WorkflowEvent) {
  otel.handleEvent(event);

  if (event.type === 'workflow_complete') {
    workflowDuration.record(event.durationMs, {
      workflow: event.workflowName ?? 'unknown',
      status: 'success',
    });
  }

  if (event.type === 'workflow_error') {
    workflowDuration.record(event.durationMs, {
      workflow: event.workflowName ?? 'unknown',
      status: 'error',
    });
  }

  if (event.type === 'step_error') {
    stepErrors.add(1, {
      step: event.name ?? event.stepKey ?? 'unknown',
      error: typeof event.error === 'string' ? event.error : 'object',
    });
  }
}

const workflow = createWorkflow('workflow', deps, { onEvent: handleWorkflowEvent });
```

## Error Tracking with Sentry

### Basic integration

```typescript
import * as Sentry from '@sentry/node';
import { createWorkflow, type WorkflowEvent } from 'awaitly/workflow';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

function handleWorkflowEvent(event: WorkflowEvent) {
  // Report unexpected errors to Sentry
  if (event.type === 'workflow_error') {
    const error = event.error;

    if (typeof error === 'object' && error !== null && 'type' in error) {
      if ((error as { type: string }).type === 'UNEXPECTED_ERROR') {
        Sentry.captureException((error as { cause?: unknown }).cause, {
          tags: {
            workflow: event.workflowName ?? 'unknown',
          },
          extra: {
            workflowId: event.workflowId,
            durationMs: event.durationMs,
          },
        });
      }
    }
  }

  // Track step errors for monitoring
  if (event.type === 'step_error') {
    Sentry.addBreadcrumb({
      category: 'workflow',
      message: `Step failed: ${event.name ?? event.stepKey}`,
      level: 'error',
      data: {
        error: event.error,
        stepKey: event.stepKey,
      },
    });
  }
}

const workflow = createWorkflow('workflow', deps, { onEvent: handleWorkflowEvent });
```

### Structured error context

```typescript
// Wrap workflow execution with Sentry transaction
async function runWithSentry<T>(
  workflowName: string,
  fn: () => Promise<Result<T, unknown>>
): Promise<Result<T, unknown>> {
  return Sentry.startSpan(
    { name: workflowName, op: 'workflow' },
    async () => {
      const result = await fn();

      if (!result.ok) {
        Sentry.setContext('workflow_error', {
          error: result.error,
          workflowName,
        });
      }

      return result;
    }
  );
}

// Usage
const result = await runWithSentry('checkout', () =>
  checkoutWorkflow.run(async ({ step }) => {
    // ... workflow logic
  })
);
```

## State Persistence

Use a **SnapshotStore** (`save`, `load`, `delete`, `list`, `close`) with **WorkflowSnapshot**. Prefer the official adapters (PostgreSQL, MongoDB, libSQL) or implement the interface for Redis/DynamoDB.

### Official adapters (recommended)

```typescript
import { postgres } from 'awaitly-postgres';
import { createWorkflow, createResumeStateCollector } from 'awaitly/workflow';
// or: import { mongo } from 'awaitly-mongo';
// or: import { libsql } from 'awaitly-libsql';

const store = postgres(process.env.DATABASE_URL!);
const collector = createResumeStateCollector();
const workflow = createWorkflow('workflow', deps, { onEvent: collector.handleEvent });
await workflow.run(async ({ step, deps }) => {
  const user = await step('fetchUser', () => deps.fetchUser('1'), { key: 'user:1' });
  return user;
});

await store.save('run-123', collector.getResumeState());

// Resume later (prefer loadResumeState when store supports it)
const savedState = await store.load('run-123');
await workflow.run(/* same workflow fn */, { resumeState: savedState ?? undefined });
```

See [Persistence](/guides/persistence/) and [PostgreSQL](/guides/postgres-persistence/) guides.

### Redis (custom SnapshotStore)

Implement the `SnapshotStore` interface from `awaitly/persistence`:

```typescript
import type { SnapshotStore, WorkflowSnapshot } from 'awaitly/persistence';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const store: SnapshotStore = {
  async save(id, snapshot) {
    await redis.set(`workflow:${id}`, JSON.stringify(snapshot));
  },
  async load(id) {
    const data = await redis.get(`workflow:${id}`);
    return data ? JSON.parse(data) : null;
  },
  async delete(id) {
    await redis.del(`workflow:${id}`);
  },
  async list(options) {
    const keys = await redis.keys('workflow:*');
    return keys.map((k) => ({ id: k.replace('workflow:', ''), updatedAt: new Date().toISOString() })).slice(0, options?.limit ?? 100);
  },
  async close() {
    await redis.quit();
  },
};

await store.save('run-123', collector.getResumeState());
const savedState = await store.load('run-123');
await workflow.run(/* same workflow fn */, { resumeState: savedState ?? undefined });
```

### PostgreSQL (custom schema)

If you need a custom table, implement `SnapshotStore` and store `WorkflowSnapshot` as JSONB:

```typescript
import type { SnapshotStore, WorkflowSnapshot } from 'awaitly/persistence';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const store: SnapshotStore = {
  async save(id, snapshot) {
    await pool.query(
      `INSERT INTO workflow_snapshots (id, snapshot, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET snapshot = $2, updated_at = NOW()`,
      [id, JSON.stringify(snapshot)]
    );
  },
  async load(id) {
    const r = await pool.query('SELECT snapshot FROM workflow_snapshots WHERE id = $1', [id]);
    return r.rows.length ? (r.rows[0].snapshot as WorkflowSnapshot) : null;
  },
  async delete(id) {
    await pool.query('DELETE FROM workflow_snapshots WHERE id = $1', [id]);
  },
  async list(options) {
    const limit = options?.limit ?? 100;
    const r = await pool.query(
      'SELECT id, updated_at FROM workflow_snapshots ORDER BY updated_at DESC LIMIT $1',
      [limit]
    );
    return r.rows.map((row) => ({ id: row.id, updatedAt: row.updated_at.toISOString() }));
  },
  async close() {
    await pool.end();
  },
};
```

### DynamoDB (custom SnapshotStore)

Implement `SnapshotStore` and store `WorkflowSnapshot` as JSON:

```typescript
import type { SnapshotStore, WorkflowSnapshot } from 'awaitly/persistence';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'workflow-snapshots';

const store: SnapshotStore = {
  async save(id, snapshot) {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: `workflow#${id}`,
        sk: 'snapshot',
        snapshot: JSON.stringify(snapshot),
        updatedAt: new Date().toISOString(),
      },
    }));
  },
  async load(id) {
    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { pk: `workflow#${id}`, sk: 'snapshot' },
    }));
    if (!result.Item?.snapshot) return null;
    return JSON.parse(result.Item.snapshot) as WorkflowSnapshot;
  },
  async delete(id) {
    await docClient.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: `workflow#${id}`, sk: 'snapshot' },
    }));
  },
  async list(options) {
    const r = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      Limit: options?.limit ?? 100,
    }));
    const items = (r.Items ?? []).map((i) => ({ id: (i.pk as string).replace('workflow#', ''), updatedAt: i.updatedAt as string }));
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return items;
  },
  async close() {},
};
```

## Health Checks

### Basic health endpoint

```typescript
import express from 'express';

const app = express();

// Track active workflows
const activeWorkflows = new Map<string, { startedAt: number; name: string }>();

function trackWorkflowStart(id: string, name: string) {
  activeWorkflows.set(id, { startedAt: Date.now(), name });
}

function trackWorkflowEnd(id: string) {
  activeWorkflows.delete(id);
}

// Health endpoint
app.get('/health', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    stripe: await checkStripe(),
  };

  const healthy = Object.values(checks).every((c) => c.status === 'ok');

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    checks,
    activeWorkflows: activeWorkflows.size,
    timestamp: new Date().toISOString(),
  });
});

// Readiness endpoint (for Kubernetes)
app.get('/ready', async (req, res) => {
  // Check if the service can accept new workflows
  const canAcceptWork = activeWorkflows.size < 100; // Example limit

  res.status(canAcceptWork ? 200 : 503).json({
    ready: canAcceptWork,
    activeWorkflows: activeWorkflows.size,
  });
});

// Dependency check helpers
async function checkDatabase(): Promise<{ status: 'ok' | 'error'; latency?: number }> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { status: 'ok', latency: Date.now() - start };
  } catch {
    return { status: 'error' };
  }
}

async function checkRedis(): Promise<{ status: 'ok' | 'error'; latency?: number }> {
  const start = Date.now();
  try {
    await redis.ping();
    return { status: 'ok', latency: Date.now() - start };
  } catch {
    return { status: 'error' };
  }
}
```

### Workflow health tracking

```typescript
// Track workflow health in event handler
function createHealthTracker() {
  const stats = {
    total: 0,
    successful: 0,
    failed: 0,
    avgDuration: 0,
    lastError: null as { time: number; error: unknown } | null,
  };

  return {
    handleEvent(event: WorkflowEvent) {
      if (event.type === 'workflow_complete') {
        stats.total++;
        stats.successful++;
        stats.avgDuration = (stats.avgDuration * (stats.total - 1) + (event.durationMs ?? 0)) / stats.total;
      }

      if (event.type === 'workflow_error') {
        stats.total++;
        stats.failed++;
        stats.lastError = { time: Date.now(), error: event.error };
      }
    },

    getStats() {
      return {
        ...stats,
        successRate: stats.total > 0 ? stats.successful / stats.total : 1,
      };
    },
  };
}

const healthTracker = createHealthTracker();

const workflow = createWorkflow('workflow', deps, {
  onEvent: (event) => {
    healthTracker.handleEvent(event);
    otel.handleEvent(event);
  },
});

// Expose in health endpoint
app.get('/health/workflows', (req, res) => {
  res.json(healthTracker.getStats());
});
```

## Scaling Considerations

### Horizontal scaling with stateless workflows

```typescript
// Stateless workflow - no shared state between instances
const workflow = createWorkflow('workflow', { fetchUser,
  processPayment,
  sendNotification,
});

// Each request creates a new workflow instance
app.post('/checkout', async (req, res) => {
  const result = await workflow.run(async ({ step, deps }) => {
    // All state is local to this request
    const user = await step('fetchUser', () => deps.fetchUser(req.body.userId));
    const payment = await step('processPayment', () => deps.processPayment(user, req.body.amount));
    await step('sendNotification', () => deps.sendNotification(user.email, payment));
    return payment;
  });

  res.json(result.ok ? result.value : { error: result.error });
});
```

### Distributed workflows with persistence

```typescript
// For long-running workflows, use persistence for horizontal scaling
async function startDistributedWorkflow(workflowId: string, input: WorkflowInput) {
  const collector = createResumeStateCollector();

  // Check if workflow already started (resume)
  const existingState = await persistence.load(workflowId);

  const workflow = createWorkflow('workflow', deps, {
    onEvent: collector.handleEvent,
    resumeState: existingState ?? undefined,
  });

  try {
    const result = await workflow.run(async ({ step, deps }) => {
      const data = await step('fetchData', () => deps.fetchData(input.dataId), { key: 'fetch-data' });
      const processed = await step('processData', () => deps.processData(data), { key: 'process' });

      // Save state after expensive operations
      await persistence.save(workflowId, collector.getResumeState());

      const result = await step('saveResult', () => deps.saveResult(processed), { key: 'save' });
      return result;
    });

    // Clean up on success
    await persistence.delete(workflowId);
    return result;
  } catch (error) {
    // Save state for later retry
    await persistence.save(workflowId, collector.getResumeState(), {
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      metadata: { error: String(error), lastAttempt: Date.now() },
    });
    throw error;
  }
}
```

### Rate limiting for external APIs

```typescript
import { createRateLimiter } from 'awaitly/ratelimit';

// Limit Stripe API calls
const stripeLimit = createRateLimiter('stripe', {
  maxRequests: 100,
  windowMs: 1000, // 100 requests per second
});

// Limit email sending
const emailLimit = createRateLimiter('email', {
  maxRequests: 10,
  windowMs: 1000, // 10 emails per second
});

const workflow = createWorkflow('workflow', deps);

const result = await workflow.run(async ({ step, deps }) => {
  const user = await step('fetchUser', () => deps.fetchUser('1'));

  // Rate-limited payment
  const payment = await step(
    () => stripeLimit(() => deps.chargeCard(user.cardId, amount)),
    { name: 'charge' }
  );

  // Rate-limited notification
  await step(
    () => emailLimit(() => deps.sendReceipt(user.email, payment)),
    { name: 'send-receipt' }
  );

  return payment;
});
```

### Circuit breaker for unreliable dependencies

```typescript
import { createCircuitBreaker } from 'awaitly/circuit-breaker';

// Protect against cascading failures
const paymentBreaker = createCircuitBreaker('payment-service', {
  failureThreshold: 5,      // Open after 5 failures
  resetTimeout: 30000,      // Try again after 30 seconds
  halfOpenRequests: 3,      // Allow 3 test requests when half-open
});

const workflow = createWorkflow('workflow', deps);

const result = await workflow.run(async ({ step, deps }) => {
  const order = await step('fetchOrder', () => deps.fetchOrder(orderId));

  // Circuit breaker protects this step
  const payment = await step(
    () => paymentBreaker(() => deps.chargeCard(order.total)),
    { name: 'charge' }
  );

  return payment;
});

// Check circuit state in health endpoint
app.get('/health/circuits', (req, res) => {
  res.json({
    payment: paymentBreaker.getState(), // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
  });
});
```

## Environment Configuration

### Configuration pattern

```typescript
// config.ts
import { z } from 'zod';

const configSchema = z.object({
  // Service
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string(),

  // External services
  STRIPE_SECRET_KEY: z.string(),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  // Workflow settings
  WORKFLOW_STATE_TTL_MS: z.coerce.number().default(24 * 60 * 60 * 1000),
  WORKFLOW_MAX_RETRIES: z.coerce.number().default(3),
});

export const config = configSchema.parse(process.env);
```

### Feature flags for gradual rollout

```typescript
// Use feature flags to gradually enable new workflow features
const featureFlags = {
  useNewPaymentFlow: process.env.ENABLE_NEW_PAYMENT === 'true',
  enableCircuitBreakers: process.env.ENABLE_CIRCUIT_BREAKERS !== 'false',
};

const workflow = createWorkflow('workflow', deps, {
  onEvent: featureFlags.enableCircuitBreakers ? otel.handleEvent : undefined,
});

const result = await workflow.run(async ({ step, deps }) => {
  const order = await step('fetchOrder', () => deps.fetchOrder(orderId));

  if (featureFlags.useNewPaymentFlow) {
    // New payment flow with retries
    return await step.retry('newPayment', () => deps.newPaymentService(order), { attempts: 3 });
  } else {
    // Legacy payment
    return await step('legacyPayment', () => deps.legacyPayment(order));
  }
});
```

## Graceful Shutdown

```typescript
// Handle shutdown signals
let isShuttingDown = false;

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('Shutting down gracefully...');

  // Stop accepting new requests
  server.close();

  // Wait for active workflows to complete (with timeout)
  const timeout = setTimeout(() => {
    console.log('Forcing shutdown after timeout');
    process.exit(1);
  }, 30000);

  // Wait for active workflows
  while (activeWorkflows.size > 0) {
    console.log(`Waiting for ${activeWorkflows.size} active workflows...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  clearTimeout(timeout);

  // Close connections
  await redis.quit();
  await pool.end();
  await sdk.shutdown(); // OpenTelemetry

  console.log('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

## Next

[Learn about Circuit Breakers →](/advanced/circuit-breaker/)
