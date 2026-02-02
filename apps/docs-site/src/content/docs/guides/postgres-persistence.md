---
title: PostgreSQL Persistence
description: Use PostgreSQL as a persistence backend for awaitly workflows
---

The [`awaitly-postgres`](https://www.npmjs.com/package/awaitly-postgres) package provides a ready-to-use PostgreSQL persistence adapter for awaitly workflows.

**Source code**: [GitHub](https://github.com/jagreehal/awaitly/tree/main/packages/awaitly-postgres)

## Installation

```bash
npm install awaitly-postgres pg
# or
pnpm add awaitly-postgres pg
# or
yarn add awaitly-postgres pg
```

## Quick Start

```typescript
import { postgres } from 'awaitly-postgres';
import { createWorkflow } from 'awaitly/workflow';

// One-liner setup
const store = postgres('postgresql://localhost/mydb');

// Execute + persist
const workflow = createWorkflow({ fetchUser, createOrder });
await workflow(async (step, deps) => {
  const user = await step(() => deps.fetchUser('123'), { key: 'fetch-user' });
  const order = await step(() => deps.createOrder(user), { key: 'create-order' });
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

```typescript
const store = postgres('postgresql://user:password@localhost:5432/dbname');
```

### Object Options

```typescript
const store = postgres({
  url: 'postgresql://localhost/mydb',
  table: 'my_workflow_snapshots',   // Default: 'awaitly_snapshots'
  prefix: 'orders:',                // Default: ''
  autoCreateTable: true,            // Default: true
  lock: { lockTableName: 'my_workflow_locks' },  // Optional: cross-process locking
});
```

### Bring Your Own Pool

```typescript
import { Pool } from 'pg';
import { postgres } from 'awaitly-postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = postgres({
  url: 'postgresql://localhost/mydb',
  pool: pool,
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
// [{ id: 'wf-123', updatedAt: '2024-01-15T10:30:00Z' }, ...]

// List with prefix filter
const orderWorkflows = await store.list({ prefix: 'orders:', limit: 50 });

// Clean shutdown
await store.close();
```

## Table Schema

The adapter automatically creates a table with the following schema:

```sql
CREATE TABLE IF NOT EXISTS awaitly_snapshots (
  id TEXT PRIMARY KEY,
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS awaitly_snapshots_updated_at_idx
ON awaitly_snapshots (updated_at DESC);
```

## With Durable Execution

Use the same `postgres()` store with `durable.run`:

```typescript
import { postgres } from 'awaitly-postgres';
import { durable } from 'awaitly/durable';

const store = postgres(process.env.DATABASE_URL!);

const result = await durable.run(
  { fetchUser, createOrder },
  async (step, { fetchUser, createOrder }) => {
    const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
    const order = await step(() => createOrder(user), { key: 'create-order' });
    return order;
  },
  { id: 'checkout-123', store }
);
```

For cross-process locking, pass `lock` when creating the store so only one process runs a given workflow ID at a time.

## Features

- ✅ **One-liner setup** - Just pass a connection string
- ✅ **Automatic table creation** - No manual schema setup required
- ✅ **JSONB storage** - Native PostgreSQL JSON support
- ✅ **Connection pooling** - Efficient connection management
- ✅ **Pattern matching** - List workflows by prefix
- ✅ **Timestamps** - Automatic `updated_at` tracking

## Production Considerations

### Connection Pooling

The pool is managed automatically. For high-load scenarios, bring your own pool with custom settings:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  min: 5,
  idleTimeoutMillis: 30000,
});

const store = postgres({ url: process.env.DATABASE_URL!, pool });
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

```sql
-- Check table size
SELECT pg_size_pretty(pg_total_relation_size('awaitly_snapshots'));

-- Count by status
SELECT (snapshot->'execution')->>'status' AS status, COUNT(*)
FROM awaitly_snapshots
GROUP BY 1;
```

## Requirements

- Node.js >= 22
- PostgreSQL >= 12
- `pg` package

## Next

[Learn about MongoDB persistence →](./mongo-persistence/)
