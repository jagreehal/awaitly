# awaitly-postgres

PostgreSQL persistence adapter for [awaitly](https://github.com/jagreehal/awaitly) workflows.

Provides a ready-to-use snapshot store backed by PostgreSQL. The store accepts both workflow snapshots and resume state, so it plugs straight into `durable.run` and `createWorkflow`.

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
import { durable } from 'awaitly/durable';

const store = postgres(process.env.DATABASE_URL!);

const result = await durable.run(
  { fetchUser, createOrder },
  async ({ step, deps: { fetchUser, createOrder } }) => {
    const user = await step('fetch-user', () => fetchUser('123'));
    const order = await step('create-order', () => createOrder(user));
    return order;
  },
  {
    id: 'checkout-123',
    store,
  }
);
```

## Configuration

### Connection URL

```typescript
const store = postgres('postgresql://user:password@localhost:5432/dbname');
```

### Options

```typescript
const store = postgres({
  url: process.env.DATABASE_URL!,
  table: 'my_workflow_snapshots', // optional, default: 'awaitly_snapshots'
  prefix: 'orders:', // optional ID prefix, default: ''
  autoCreateTable: true, // optional, default: true
});
```

### Using an Existing Pool

```typescript
import { Pool } from 'pg';
import { postgres } from 'awaitly-postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = postgres({
  url: process.env.DATABASE_URL!,
  pool,
});
```

### Cross-Process Locking

To ensure only one process runs a given workflow ID at a time, pass the `lock` option. The store then implements `WorkflowLock`, and `durable.run` acquires the lock before running (unless `allowConcurrent: true`) and releases it when done:

```typescript
const store = postgres({
  url: process.env.DATABASE_URL!,
  lock: { lockTableName: 'awaitly_workflow_lock' }, // optional; default table name
});
```

## Using with createWorkflow

The store also works directly with workflow resume state:

```typescript
import { postgres } from 'awaitly-postgres';
import { createWorkflow } from 'awaitly/workflow';

const store = postgres('postgresql://localhost/mydb');
const workflow = createWorkflow(deps);

// Run and persist resume state
const { result, resumeState } = await workflow.runWithState(fn);
await store.save('wf-123', resumeState);

// Restore later
const saved = await store.loadResumeState('wf-123');
if (saved) await workflow.run(fn, { resumeState: saved });
```

## Store API

```typescript
store.save(id, state); // WorkflowSnapshot or ResumeState
store.load(id); // returns whichever was stored
store.loadResumeState(id); // ResumeState | null
store.delete(id);
store.list({ prefix, limit }); // [{ id, updatedAt }]
store.close();
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

The table is created automatically on first use (disable with `autoCreateTable: false`). You can customize the table name via the `table` option.

## Features

- ✅ Automatic table creation
- ✅ Stores workflow snapshots and resume state (JSONB)
- ✅ Optional cross-process locking (`WorkflowLock`)
- ✅ Bring your own `pg` pool
- ✅ Zero configuration required

## Requirements

- Node.js >= 22
- PostgreSQL >= 12
- `pg` package (peer dependency)

## License

MIT
