# awaitly-libsql

libSQL / SQLite persistence adapter for [awaitly](https://github.com/jagreehal/awaitly) workflows.

Provides a ready-to-use snapshot store backed by [libSQL](https://docs.turso.tech/libsql) (SQLite-compatible),
suitable for local development (`file:` URLs, `:memory:`) and remote deployments (e.g. Turso). The store accepts
both workflow snapshots and resume state, so it plugs straight into `durable.run` and `createWorkflow`.

## Installation

```bash
npm install awaitly-libsql @libsql/client
# or
pnpm add awaitly-libsql @libsql/client
# or
yarn add awaitly-libsql @libsql/client
```

## Quick Start

```ts
import { libsql } from "awaitly-libsql";
import { durable } from "awaitly/durable";

// Local file database (good for dev)
const store = libsql("file:./awaitly.db");

const result = await durable.run(
  { fetchUser, createOrder },
  async ({ step, deps: { fetchUser, createOrder } }) => {
    const user = await step("fetch-user", () => fetchUser("123"));
    const order = await step("create-order", () => createOrder(user));
    return order;
  },
  {
    id: "checkout-123",
    store,
  }
);
```

## Remote libSQL / Turso

```ts
const store = libsql({
  url: process.env.LIBSQL_URL!, // e.g. "libsql://your-db.turso.io"
  authToken: process.env.LIBSQL_AUTH_TOKEN,
  table: "awaitly_snapshots", // optional, default: "awaitly_snapshots"
});
```

## Cross-Process Locking

To ensure only one process runs a given workflow ID at a time (when `durable.run` is used without `allowConcurrent: true`), pass the `lock` option. The store will implement `WorkflowLock` (lease + owner token):

```ts
const store = libsql({
  url: "file:./awaitly.db",
  lock: { lockTableName: "awaitly_workflow_lock" }, // optional; default table name
});

// durable.run(..., { id, store }) will tryAcquire before running and release in finally
```

## Tenant-Aware Keying (Recommended)

To make it easier to avoid cross-tenant leaks in multi-tenant setups, use a
tenant-specific ID prefix:

```ts
const tenantId = "acme-tenant-123";

const store = libsql({
  url: "file:./awaitly.db",
  prefix: `tenant:${tenantId}:`,
});
```

All workflow IDs will be stored with the configured prefix.

## Using with createWorkflow

The store also works directly with workflow resume state:

```ts
import { libsql } from "awaitly-libsql";
import { createWorkflow } from "awaitly/workflow";

const store = libsql("file:./awaitly.db");
const workflow = createWorkflow(deps);

// Run and persist resume state
const { result, resumeState } = await workflow.runWithState(fn);
await store.save("wf-123", resumeState);

// Restore later
const saved = await store.loadResumeState("wf-123");
if (saved) await workflow.run(fn, { resumeState: saved });
```

## Store API

```ts
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
  snapshot TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS awaitly_snapshots_updated_at_idx
ON awaitly_snapshots (updated_at DESC);
```

You can customize the table name via the `table` option.

## Requirements

- Node.js >= 22
- `@libsql/client` package

## License

MIT
