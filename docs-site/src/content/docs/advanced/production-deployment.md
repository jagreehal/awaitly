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
const workflow = createWorkflow(deps, {
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

const workflow = createWorkflow(deps, { onEvent: handleWorkflowEvent });
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

const workflow = createWorkflow(deps, { onEvent: handleWorkflowEvent });
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
  checkoutWorkflow(async (step) => {
    // ... workflow logic
  })
);
```

## State Persistence

### Redis adapter

```typescript
import { createStatePersistence, stringifyState, parseState } from 'awaitly/persistence';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const persistence = createStatePersistence(
  {
    get: (key) => redis.get(key),
    set: (key, value, ttlMs) =>
      ttlMs ? redis.setEx(key, Math.floor(ttlMs / 1000), value) : redis.set(key, value),
    delete: (key) => redis.del(key).then((n) => n > 0),
    exists: (key) => redis.exists(key).then((n) => n > 0),
    keys: (pattern) => redis.keys(pattern),
  },
  'workflow:state:' // Key prefix
);

// Save workflow state
const collector = createResumeStateCollector();
const workflow = createWorkflow(deps, { onEvent: collector.handleEvent });

await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  return user;
});

// Save with 24 hour TTL
await persistence.save('run-123', collector.getResumeState(), {
  ttl: 24 * 60 * 60 * 1000,
  metadata: { userId: 'user-1', startedAt: Date.now() },
});

// Resume later
const savedState = await persistence.load('run-123');
const resumed = createWorkflow(deps, { resumeState: savedState });
```

### PostgreSQL adapter

```typescript
import { Pool } from 'pg';
import { stringifyState, parseState } from 'awaitly/persistence';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Schema
await pool.query(`
  CREATE TABLE IF NOT EXISTS workflow_states (
    id VARCHAR(255) PRIMARY KEY,
    state JSONB NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
  );
  CREATE INDEX idx_workflow_states_expires ON workflow_states(expires_at);
`);

// Adapter functions
async function saveWorkflowState(
  id: string,
  state: ResumeState,
  options?: { ttl?: number; metadata?: Record<string, unknown> }
) {
  const json = stringifyState(state);
  const expiresAt = options?.ttl ? new Date(Date.now() + options.ttl) : null;

  await pool.query(
    `INSERT INTO workflow_states (id, state, metadata, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       state = $2, metadata = $3, expires_at = $4, updated_at = NOW()`,
    [id, json, options?.metadata ?? null, expiresAt]
  );
}

async function loadWorkflowState(id: string): Promise<ResumeState | null> {
  const result = await pool.query(
    `SELECT state FROM workflow_states
     WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [id]
  );

  if (result.rows.length === 0) return null;
  return parseState(result.rows[0].state);
}

async function deleteExpiredStates() {
  await pool.query(`DELETE FROM workflow_states WHERE expires_at < NOW()`);
}
```

### DynamoDB adapter

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { stringifyState, parseState } from 'awaitly/persistence';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'workflow-states';

async function saveWorkflowState(
  id: string,
  state: ResumeState,
  options?: { ttl?: number; metadata?: Record<string, unknown> }
) {
  const json = stringifyState(state);
  const ttl = options?.ttl ? Math.floor((Date.now() + options.ttl) / 1000) : undefined;

  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      pk: `workflow#${id}`,
      sk: 'state',
      state: json,
      metadata: options?.metadata,
      createdAt: Date.now(),
      ...(ttl && { ttl }),
    },
  }));
}

async function loadWorkflowState(id: string): Promise<ResumeState | null> {
  const result = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { pk: `workflow#${id}`, sk: 'state' },
  }));

  if (!result.Item) return null;
  return parseState(result.Item.state);
}
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

const workflow = createWorkflow(deps, {
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
const workflow = createWorkflow({
  fetchUser,
  processPayment,
  sendNotification,
});

// Each request creates a new workflow instance
app.post('/checkout', async (req, res) => {
  const result = await workflow(async (step) => {
    // All state is local to this request
    const user = await step(() => fetchUser(req.body.userId));
    const payment = await step(() => processPayment(user, req.body.amount));
    await step(() => sendNotification(user.email, payment));
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

  const workflow = createWorkflow(deps, {
    onEvent: collector.handleEvent,
    resumeState: existingState ?? undefined,
  });

  try {
    const result = await workflow(async (step) => {
      const data = await step(() => fetchData(input.dataId), { key: 'fetch-data' });
      const processed = await step(() => processData(data), { key: 'process' });

      // Save state after expensive operations
      await persistence.save(workflowId, collector.getResumeState());

      const result = await step(() => saveResult(processed), { key: 'save' });
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

const workflow = createWorkflow(deps);

const result = await workflow(async (step) => {
  const user = await step(() => fetchUser('1'));

  // Rate-limited payment
  const payment = await step(
    () => stripeLimit(() => chargeCard(user.cardId, amount)),
    { name: 'charge' }
  );

  // Rate-limited notification
  await step(
    () => emailLimit(() => sendReceipt(user.email, payment)),
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

const workflow = createWorkflow(deps);

const result = await workflow(async (step) => {
  const order = await step(() => fetchOrder(orderId));

  // Circuit breaker protects this step
  const payment = await step(
    () => paymentBreaker(() => chargeCard(order.total)),
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

const workflow = createWorkflow(deps, {
  onEvent: featureFlags.enableCircuitBreakers ? otel.handleEvent : undefined,
});

const result = await workflow(async (step) => {
  const order = await step(() => fetchOrder(orderId));

  if (featureFlags.useNewPaymentFlow) {
    // New payment flow with retries
    return await step.retry(() => newPaymentService(order), { attempts: 3 });
  } else {
    // Legacy payment
    return await step(() => legacyPayment(order));
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

[Learn about Circuit Breakers →](../circuit-breaker/)
