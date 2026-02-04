---
title: MongoDB Persistence
description: Use MongoDB as a persistence backend for awaitly workflows
---

The [`awaitly-mongo`](https://www.npmjs.com/package/awaitly-mongo) package provides a ready-to-use MongoDB persistence adapter for awaitly workflows.

**Source code**: [GitHub](https://github.com/jagreehal/awaitly/tree/main/packages/awaitly-mongo)

## Installation

```bash
npm install awaitly-mongo mongodb
# or
pnpm add awaitly-mongo mongodb
# or
yarn add awaitly-mongo mongodb
```

## Quick Start

```typescript
import { mongo } from 'awaitly-mongo';
import { createWorkflow } from 'awaitly/workflow';

// One-liner setup
const store = mongo('mongodb://localhost:27017/mydb');

// Execute + persist
const workflow = createWorkflow({ fetchUser, createOrder });
await workflow(async (step, deps) => {
  const user = await step('fetchUser', () => deps.fetchUser('123'), { key: 'fetch-user' });
  const order = await step('createOrder', () => deps.createOrder(user), { key: 'create-order' });
  return order;
});

await store.save('checkout-123', workflow.getSnapshot());

// Later: restore + resume
const snapshot = await store.load('checkout-123');
const workflow2 = createWorkflow({ fetchUser, createOrder }, { snapshot });
await workflow2(/* same workflow fn */);
```

## Configuration

### String Shorthand

Database name is parsed from the URL:

```typescript
const store = mongo('mongodb://localhost:27017/mydb');
```

### Object Options

```typescript
const store = mongo({
  url: 'mongodb://localhost:27017',
  database: 'myapp',
  collection: 'my_workflow_snapshots',  // Default: 'awaitly_snapshots'
  prefix: 'orders:',                     // Default: ''
  lock: { lockCollectionName: 'my_workflow_locks' },  // Optional: cross-process locking
});
```

### Bring Your Own Client

```typescript
import { MongoClient } from 'mongodb';
import { mongo } from 'awaitly-mongo';

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();

const store = mongo({
  url: 'mongodb://localhost:27017/mydb',
  client: client,
});
```

## Store Interface

The store implements the `SnapshotStore` interface:

```typescript
interface SnapshotStore {
  save(id: string, snapshot: WorkflowSnapshot): Promise<void>;
  load(id: string): Promise<WorkflowSnapshot | null>;
  delete(id: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>>;
  close(): Promise<void>;
}
```

### Usage Examples

```typescript
// Save snapshot
await store.save('wf-123', workflow.getSnapshot());

// Load snapshot (returns null if not found)
const snapshot = await store.load('wf-123');

// Delete snapshot
await store.delete('wf-123');

// List recent workflows
const workflows = await store.list({ limit: 100 });
// [{ id: 'wf-123', updatedAt: '2024-01-15T10:30:00.000Z' }, ...]

// List with prefix filter
const orderWorkflows = await store.list({ prefix: 'orders:', limit: 50 });

// Clean shutdown
await store.close();
```

## Document Schema

The adapter stores documents with **string `_id`** (not ObjectId) so arbitrary IDs and prefixes work correctly:

```typescript
{
  _id: string,              // Workflow ID (with prefix); stored as string
  snapshot: WorkflowSnapshot,
  updatedAt: Date
}
```

An index on `updatedAt` is created for efficient list queries.

## With Durable Execution

Use the same `mongo()` store with `durable.run`:

```typescript
import { mongo } from 'awaitly-mongo';
import { durable } from 'awaitly/durable';

const store = mongo(process.env.MONGODB_URI!);

const result = await durable.run(
  { fetchUser, createOrder },
  async (step, { fetchUser, createOrder }) => {
    const user = await step('fetchUser', () => fetchUser('123'), { key: 'fetch-user' });
    const order = await step('createOrder', () => createOrder(user), { key: 'create-order' });
    return order;
  },
  { id: 'checkout-123', store }
);
```

For cross-process locking, pass `lock` when creating the store so only one process runs a given workflow ID at a time.

## Features

- ✅ **One-liner setup** - Just pass a connection string
- ✅ **Automatic collection creation** - No manual setup required
- ✅ **Connection reuse** - Share existing client instances
- ✅ **Pattern matching** - List workflows by prefix
- ✅ **Timestamps** - Automatic `updatedAt` tracking

## Production Considerations

### Connection Pooling

MongoDB handles connection pooling automatically. For existing clients:

```typescript
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI!, {
  maxPoolSize: 50,
  minPoolSize: 5,
  maxIdleTimeMS: 30000,
});
await client.connect();

const store = mongo({
  url: process.env.MONGODB_URI!,
  client: client,
});
```

### Cleanup

List and delete completed workflows:

```typescript
const completed = await store.list({ limit: 1000 });
for (const { id } of completed) {
  const snapshot = await store.load(id);
  if (snapshot?.execution.status === 'completed') {
    await store.delete(id);
  }
}
```

### Monitoring

```javascript
// Check collection stats
const stats = await db.collection('awaitly_snapshots').stats();

// Check indexes
const indexes = await db.collection('awaitly_snapshots').indexes();
```

### Sharding

For large-scale deployments:

```javascript
sh.enableSharding('myapp');
sh.shardCollection('myapp.awaitly_snapshots', { _id: 'hashed' });
```

## Requirements

- Node.js >= 22
- MongoDB >= 4.2
- `mongodb` package

## Next

[Learn about PostgreSQL persistence →](./postgres-persistence/)
