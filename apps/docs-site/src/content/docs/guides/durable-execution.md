---
title: Durable Execution
description: Automatic state persistence with crash recovery
---

Durable execution wraps workflows with automatic checkpointing. State is persisted after each keyed step, enabling crash recovery and resume from any point.

## Mental model (durable)

```mermaid
flowchart TD
  durableRun[durable.run(deps, fn, { id, store, version })]
  load[store.load(id)]
  versionCheck[version_check]
  build[createWorkflow(deps, { resumeState })]
  run[workflow.run(fn)]
  persist[persist_after_each_keyed_step]
  success[on_success_delete_state]
  failure[on_error_or_cancel_keep_state]

  durableRun --> load
  load --> versionCheck
  versionCheck --> build
  build --> run
  run --> persist
  persist --> run
  run --> success
  run --> failure
```

## When to use durable vs manual persistence

- **Use durable** when you want **automatic checkpointing after every keyed step** (crash recovery with minimal wiring).
- **Use manual persistence** when you want **custom checkpoint timing** (save only at specific milestones, partial checkpoints, custom schemas).

See also: [Where options go/persistence/#where-options-go-creation-vs-per-run) (creation vs per-run).

## Quick Start

If you omit `store`, Awaitly uses an in-memory store (per process). This supports resume/retry within the same Node process, but state is lost on restart.

```typescript
import { durable } from 'awaitly/durable';

const result = await durable.run(
  { fetchUser, createOrder, sendEmail },
  async (step, { fetchUser, createOrder, sendEmail }) => {
    const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
    const order = await step(() => createOrder(user), { key: 'create-order' });
    await step(() => sendEmail(order), { key: 'send-email' });
    return order;
  },
  { id: 'checkout-123' }
);
```

:::caution[Default store: unique IDs]
When using the default in-memory store, workflow IDs must be unique within the process.
:::

To persist across restarts or share state across processes, pass a **SnapshotStore** (e.g. from `postgres()`, `mongo()`, or `libsql()`):

```typescript
import { durable } from 'awaitly/durable';
import { postgres } from 'awaitly-postgres';

const store = postgres('postgresql://localhost/mydb');

const result = await durable.run(
  { fetchUser, createOrder, sendEmail },
  async (step, { fetchUser, createOrder, sendEmail }) => {
    const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
    const order = await step(() => createOrder(user), { key: 'create-order' });
    await step(() => sendEmail(order), { key: 'send-email' });
    return order;
  },
  { id: 'checkout-123', store }
);
```

IDs should be unique per workflow instance; don't run the same id concurrently unless you have a store/locking strategy that supports it.

## How It Works

1. **On start**: Load existing state from store (if any)
2. **Version check**: Reject if stored version differs from current
3. **Resume**: Skip completed steps using cached results
4. **Execute**: Run remaining steps, persisting after each one
5. **On success**: Delete stored state (clean up)
6. **On error/cancellation**: State remains for future resume

## Snapshot Stores

Durable uses a **SnapshotStore** (`save`, `load`, `delete`, `list`, `close`). When you omit `store`, an in-memory store is used (per process).

### In-memory (default)

Omit `store` for testing or single-process usage. State is lost on restart.

```typescript
const result = await durable.run(deps, workflowFn, { id: 'checkout-123' });
```

### PostgreSQL (production)

```typescript
import { postgres } from 'awaitly-postgres';

const store = postgres(process.env.DATABASE_URL!);
const result = await durable.run(deps, workflowFn, { id: 'checkout-123', store });
```

[Learn more about PostgreSQL persistence →](./postgres-persistence/)

### MongoDB (production)

```typescript
import { mongo } from 'awaitly-mongo';

const store = mongo(process.env.MONGODB_URI!);
const result = await durable.run(deps, workflowFn, { id: 'checkout-123', store });
```

[Learn more about MongoDB persistence →](./mongo-persistence/)

### libSQL / SQLite (production)

```typescript
import { libsql } from 'awaitly-libsql';

const store = libsql('file:./workflow.db');
const result = await durable.run(deps, workflowFn, { id: 'checkout-123', store });
```

### Custom store

Implement the **SnapshotStore** interface from `awaitly/persistence`:

```typescript
import type { SnapshotStore, WorkflowSnapshot } from 'awaitly/persistence';

const store: SnapshotStore = {
  async save(id, snapshot) {
    await redis.set(id, JSON.stringify(snapshot));
  },
  async load(id) {
    const data = await redis.get(id);
    return data ? JSON.parse(data) : null;
  },
  async delete(id) {
    await redis.del(id);
  },
  async list(options) {
    // Return { id, updatedAt }[] from your backend
    return [];
  },
  async close() {},
};
```

## Version Management

Awaitly **fails fast on version mismatch**: if stored state was written by a different workflow version, resume is rejected with `VersionMismatchError`. The error includes `workflowId`, `storedVersion`, `requestedVersion`, and an actionable message.

### When to bump version

Bump the `version` option when you make breaking changes that old checkpoints cannot satisfy:

- **Step names/keys** – You renamed or changed a step’s `key` (e.g. `'fetch-user'` → `'load-user'`). Old state has cached results under the old key.
- **Step order** – You added, removed, or reordered keyed steps. Resuming from old state would skip or replay the wrong steps.
- **Step outputs** – You changed what a step returns in a way that later steps or the workflow logic no longer accept (e.g. type or shape change). Old cached results would be invalid.

If you only change non-durable logic (e.g. logging, non-keyed steps, or code after the last keyed step), you usually do **not** need to bump.

### Handling version mismatch

Two safe next actions:

1. **Clear state and re-run** – Delete stored state for this id and run again from scratch: `durable.deleteState(store, result.error.workflowId)` then call `durable.run(...)` again.
2. **Migrate** – Transform stored state to the new version (e.g. load, transform step keys or results, save with new version) or run the old version to completion first.

The error message suggests these options and includes the workflow id for use with `durable.deleteState(store, id)`.

```typescript
const result = await durable.run(deps, workflowFn, { id: 'order-123', store, version: 2 });

if (!result.ok && isVersionMismatch(result.error)) {
  const { workflowId, storedVersion, requestedVersion, message } = result.error;
  console.error(message);
  // Option 1: Clear state and re-run
  await durable.deleteState(store, workflowId);
  // then durable.run(...) again
  // Option 2: Migrate stored state to new version, or run old version to completion
}
```

### Optional: onVersionMismatch hook

Without wrapping `durable.run` in your own logic, you can handle version mismatch inline:

- **`'throw'`** (default) – Return the `VersionMismatchError`.
- **`'clear'`** – Delete state for this id and run from scratch in the same call.
- **`{ migratedSnapshot }`** – Supply a `WorkflowSnapshot` to use as the resume state (e.g. after migrating step keys or results).

```typescript
const result = await durable.run(deps, workflowFn, {
  id: 'order-123',
  store,
  version: 2,
  onVersionMismatch: ({ id, storedVersion, requestedVersion }) => {
    // Clear and run from scratch
    return 'clear';
    // Or: return 'throw'; or return { migratedSnapshot: yourMigratedSnapshot };
  },
});
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
// Get state by id (truth lives on the store)
const state = await store.load('order-123');

// Check if workflow has persisted state
const canResume = await durable.hasState(store, 'order-123');

// Delete persisted state (cancel resume capability)
const deleted = await durable.deleteState(store, 'order-123');

// List pending workflows (use options for pagination — don't load the world)
const pending = await durable.listPending(store);
const page = await durable.listPending(store, { limit: 50, offset: 0, orderBy: 'updatedAt', orderDir: 'desc' });

// Bulk delete (best-effort; uses store.deleteMany when present)
const { deleted: n } = await durable.deleteStates(store, ids, { concurrency: 10, continueOnError: true });

// Clear all workflow state (uses store.clear() when present, else paginated delete)
await durable.clearState(store);
```

## Crash recovery and queue worker pattern

A workflow instance has an `id` and persists progress (keyed steps / resume state) in the store. If the process crashes or you deploy a new version, in-process state is gone—but the store still has unfinished instances. On restart, query the store for unfinished instances (e.g. `durable.listPending(store)` or your own DB query), then for each id call `durable.run(..., { id, store })`. Awaitly loads state by id and continues from the next keyed step; completed steps are skipped using cached results.

**Key enabling pieces:**

- **Persistent store** (Postgres, Mongo, file, or KV) keyed by workflow id.
- **A pending list**: `durable.listPending(store)` or a DB query on your state table (e.g. `status != complete`).
- **Resume**: `durable.run` loads state by id and uses cached keyed steps to skip completed work.

**Queue worker shape:** on startup, get pending ids (e.g. `listPending(store)`), then for each id run `durable.run(..., { id, store })`. Continuously, poll or subscribe for new ids and run `durable.run(..., { id, store })` (optionally with a claim step in your own DB).

```typescript
// On startup (or on a schedule): discover and run pending workflows
const pendingIds = await durable.listPending(store);
for (const id of pendingIds) {
  const result = await durable.run(deps, workflowFn, { id, store });
  if (!result.ok) {
    console.error(`Workflow ${id} failed:`, result.error);
  }
}
```

**What you add (optional):**

- **Discover**: list non-complete ids via `durable.listPending(store)` or a custom query with metadata (e.g. status, updatedAt).
- **Claim/lock**: so multiple workers don’t run the same id (e.g. Postgres `SELECT ... FOR UPDATE SKIP LOCKED`, or a Mongo/Redis claim pattern)—this is adapter/application logic, not in core Awaitly.
- **Trigger**: pull (sweep pending) vs push (enqueue id, then worker runs). `durable.run` is the execution primitive either way.

**Pagination and ordering:** Do not load the world into memory. For large deployments, use `durable.listPending(store, options)` with `limit` and `offset` (or `nextOffset` from the previous page). Postgres, Mongo, and LibSQL adapters implement `listPage(options)` and return `ListPageResult` with `ids`, optional `total`, and `nextOffset`. Example: `const page = await durable.listPending(store, { limit: 50, offset: 0, orderBy: 'updatedAt', orderDir: 'desc' });` then iterate `page.ids` and use `page.nextOffset` for the next page.

**Bulk delete:** Use `durable.deleteStates(store, ids, { concurrency?, continueOnError? })` for admin/cleanup. It loops over `store.delete(id)` with optional bounded concurrency; when the store implements `deleteMany(ids)` (Postgres, Mongo, LibSQL), that is used for efficiency. Returns `{ deleted, errors? }` when `continueOnError` is true.

**Delete semantics (ack/reset):** Deleting state is effectively an ack or reset—the workflow can no longer resume from that state. If you delete while a workflow is running, the in-flight run continues; when it finishes it may try to delete again (no-op) or save (recreating state). For multi-worker safety, prefer deleting only when the workflow is not running, or when you hold the lock (e.g. after a successful run or after claiming the id). Core does not require the lock for delete; adapters that support locking do not enforce “delete only with lock”—so document and enforce in your worker logic if needed.

See also: [Persistence](./persistence) and the store adapters above (Postgres, Mongo).

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
import { durable, isWorkflowCancelled } from 'awaitly/durable';

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

// Omit store for in-memory; for production use postgres() / mongo() / libsql()
async function processCheckout(orderId: string, userId: string, items: Item[]) {
  const result = await durable.run(
    { fetchUser, createOrder, sendConfirmation },
    async (step) => {
      const user = await step(() => deps.fetchUser(userId), { key: 'fetch-user' });
      const order = await step(() => deps.createOrder(user, items), { key: 'create-order' });
      await step(() => deps.sendConfirmation(order), { key: 'send-email' });
      return order;
    },
    {
      id: `checkout-${orderId}`,
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

[Learn about Human-in-the-Loop →](/guides/human-in-loop/)
