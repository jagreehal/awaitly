---
title: Durable Execution
description: Automatic state persistence with crash recovery
---

Durable execution wraps workflows with automatic checkpointing. State is persisted after each keyed step, enabling crash recovery and resume from any point.

## Quick Start

```typescript
import { durable, createMemoryStatePersistence } from 'awaitly/durable';

const store = createMemoryStatePersistence();

const result = await durable.run(
  { fetchUser, createOrder, sendEmail },
  async (step, { fetchUser, createOrder, sendEmail }) => {
    // Each keyed step is automatically checkpointed
    const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
    const order = await step(() => createOrder(user), { key: 'create-order' });
    await step(() => sendEmail(order), { key: 'send-email' });
    return order;
  },
  {
    id: 'checkout-123',
    store,
  }
);
```

## How It Works

1. **On start**: Load existing state from store (if any)
2. **Version check**: Reject if stored version differs from current
3. **Resume**: Skip completed steps using cached results
4. **Execute**: Run remaining steps, persisting after each one
5. **On success**: Delete stored state (clean up)
6. **On error/cancellation**: State remains for future resume

## State Persistence Stores

### Memory Store (Testing/Development)

```typescript
import { createMemoryStatePersistence } from 'awaitly/durable';

const store = createMemoryStatePersistence({
  ttl: 60 * 60 * 1000, // 1 hour expiration (optional, milliseconds)
});
```

### File Store (Local Development)

```typescript
import { createFileStatePersistence } from 'awaitly/durable';
import * as fs from 'node:fs/promises';

const store = createFileStatePersistence({
  directory: './workflow-state',
  fs: {
    readFile: (p) => fs.readFile(p, 'utf-8'),
    writeFile: (p, data) => fs.writeFile(p, data, 'utf-8'),
    unlink: (p) => fs.unlink(p),
    exists: async (p) => fs.access(p).then(() => true).catch(() => false),
    readdir: (p) => fs.readdir(p),
    mkdir: (p, opts) => fs.mkdir(p, opts),
  },
});

// Initialize directory before first use
await store.init();
```

### PostgreSQL Store (Production)

```typescript
import { createPostgresPersistence } from 'awaitly-postgres';

const store = await createPostgresPersistence({
  connectionString: process.env.DATABASE_URL,
});
```

[Learn more about PostgreSQL persistence →](./postgres-persistence)

### MongoDB Store (Production)

```typescript
import { createMongoPersistence } from 'awaitly-mongo';

const store = await createMongoPersistence({
  connectionString: process.env.MONGODB_URI,
});
```

[Learn more about MongoDB persistence →](./mongo-persistence)

### Custom Store (Advanced)

Implement the `StatePersistence` interface for other backends:

```typescript
import { createStatePersistence } from 'awaitly/persistence';

const redisStore = createStatePersistence(
  {
    get: (key) => redis.get(key),
    set: (key, value, opts) =>
      redis.set(key, value, opts?.ttl ? { EX: opts.ttl } : undefined),
    delete: (key) => redis.del(key).then((n) => n > 0),
    exists: (key) => redis.exists(key).then((n) => n > 0),
    keys: (pattern) => redis.keys(pattern),
  },
  'workflow:state:'
);
```

## Version Management

Increment the version when making breaking changes to workflow logic:

```typescript
const result = await durable.run(
  deps,
  workflowFn,
  {
    id: 'order-123',
    store,
    version: 2, // Increment when adding/removing/reordering steps
  }
);

if (!result.ok && isVersionMismatch(result.error)) {
  console.log(
    `Cannot resume: stored v${result.error.storedVersion}, ` +
    `current v${result.error.currentVersion}`
  );
  // Option 1: Delete old state and restart
  await durable.deleteState(store, 'order-123');
  // Option 2: Run old version to completion first
}
```

## Cancellation and Resume

Durable workflows integrate with AbortSignal for graceful cancellation:

```typescript
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

const result = await durable.run(
  deps,
  async (step) => {
    const user = await step(() => fetchUser(id), { key: 'fetch-user' });
    const order = await step(() => createOrder(user), { key: 'create-order' });
    await step(() => processPayment(order), { key: 'payment' }); // May get cancelled here
    return order;
  },
  {
    id: 'order-123',
    store,
    signal: controller.signal,
  }
);

if (!result.ok && isWorkflowCancelled(result.error)) {
  console.log(`Cancelled at: ${result.error.lastStepKey}`);
  // State is persisted, resume later with same ID
}
```

Resume by calling with the same ID:

```typescript
// Later: resume the cancelled workflow
const result = await durable.run(deps, workflowFn, {
  id: 'order-123', // Same ID
  store,
});
// Completed steps are skipped, execution continues from last checkpoint
```

## Concurrent Execution

By default, running the same workflow ID concurrently is rejected:

```typescript
const result = await durable.run(deps, fn, { id: 'order-123', store });

if (!result.ok && isConcurrentExecution(result.error)) {
  console.log(`Workflow ${result.error.workflowId} is already running`);
}
```

Allow concurrent executions if needed:

```typescript
const result = await durable.run(deps, fn, {
  id: 'order-123',
  store,
  allowConcurrent: true, // Multiple instances can run
});
```

## Event Handling

Monitor workflow and persistence events:

```typescript
const result = await durable.run(
  deps,
  workflowFn,
  {
    id: 'order-123',
    store,
    onEvent: (event, ctx) => {
      switch (event.type) {
        case 'step_start':
          console.log(`Starting: ${event.stepKey}`);
          break;
        case 'step_complete':
          console.log(`Completed: ${event.stepKey}`);
          break;
        case 'persist_success':
          console.log(`Persisted: ${event.stepKey}`);
          break;
        case 'persist_error':
          // Workflow continues, but state may not be recoverable
          console.warn(`Persist failed: ${event.stepKey}`, event.error);
          break;
      }
    },
  }
);
```

## Helper Methods

```typescript
// Check if workflow has persisted state
const canResume = await durable.hasState(store, 'order-123');

// Delete persisted state (cancel resume capability)
const deleted = await durable.deleteState(store, 'order-123');

// List all pending workflows
const pending = await durable.listPending(store);
```

## Idempotency Requirements

Steps may be retried on resume. Ensure they are idempotent:

```typescript
// Good: Idempotent - same result on retry
const order = await step(() => createOrder({
  idempotencyKey: `order-${userId}-${timestamp}`,
  ...orderData,
}), { key: 'create-order' });

// Bad: Non-idempotent - may create duplicates
const order = await step(() => createOrder(orderData), { key: 'create-order' });
```

## Serialization Caveats

State is JSON-serialized. Be aware of limitations:

- Error stack traces are lost (only message and cause preserved)
- Dates become strings (use timestamps instead)
- Functions and symbols cannot be serialized
- Circular references will fail

```typescript
// Good: Serializable result
await step(() => ok({ userId: '123', createdAt: Date.now() }), { key: 'create' });

// Bad: Non-serializable
await step(() => ok({ user, connection: dbConn }), { key: 'create' });
```

## Complete Example

```typescript
import { ok, err, type AsyncResult } from 'awaitly';
import { durable, createMemoryStatePersistence, isWorkflowCancelled } from 'awaitly/durable';

// Define Result-returning functions
const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
  const user = await db.users.find(id);
  return user ? ok(user) : err('NOT_FOUND');
};

const createOrder = async (user: User, items: Item[]): AsyncResult<Order, 'EMPTY_CART'> => {
  if (items.length === 0) return err('EMPTY_CART');
  return ok(await db.orders.create({ userId: user.id, items }));
};

const sendConfirmation = async (order: Order): AsyncResult<void, 'EMAIL_FAILED'> => {
  try {
    await mailer.send(order.user.email, { orderId: order.id });
    return ok(undefined);
  } catch {
    return err('EMAIL_FAILED');
  }
};

// Create store
const store = createMemoryStatePersistence();

// Run durable workflow
async function processCheckout(orderId: string, userId: string, items: Item[]) {
  const result = await durable.run(
    { fetchUser, createOrder, sendConfirmation },
    async (step, deps) => {
      const user = await step(() => deps.fetchUser(userId), { key: 'fetch-user' });
      const order = await step(() => deps.createOrder(user, items), { key: 'create-order' });
      await step(() => deps.sendConfirmation(order), { key: 'send-email' });
      return order;
    },
    {
      id: `checkout-${orderId}`,
      store,
      version: 1,
      metadata: { userId, orderId },
    }
  );

  if (result.ok) {
    console.log('Order completed:', result.value.id);
  } else if (isWorkflowCancelled(result.error)) {
    console.log('Workflow paused, can resume later');
  } else {
    console.error('Workflow failed:', result.error);
  }

  return result;
}
```

## Next

[Learn about Human-in-the-Loop →](../human-in-loop/)
