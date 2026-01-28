# awaitly-libsql

libSQL / SQLite persistence adapter for [awaitly](https://github.com/jagreehal/awaitly) workflows.

Provides a `StatePersistence` backed by [libSQL](https://docs.turso.tech/libsql) (SQLite-compatible),
suitable for local development (`file:` URLs, `:memory:`) and remote deployments (e.g. Turso).

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
import { createLibSqlPersistence } from "awaitly-libsql";
import { durable } from "awaitly/durable";

const store = await createLibSqlPersistence({
  // Local file database (good for dev)
  url: "file:./awaitly.db",
  // Optional: custom table name (default: "awaitly_workflow_state")
  // tableName: "awaitly_workflow_state",
});

const result = await durable.run(
  { fetchUser, createOrder },
  async (step, { fetchUser, createOrder }) => {
    const user = await step(() => fetchUser("123"), { key: "fetch-user" });
    const order = await step(() => createOrder(user), { key: "create-order" });
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
const store = await createLibSqlPersistence({
  url: process.env.LIBSQL_URL!,          // e.g. "libsql://your-db.turso.io"
  authToken: process.env.LIBSQL_AUTH_TOKEN,
  tableName: "awaitly_workflow_state",
});
```

## Tenant-Aware Keying (Recommended)

To make it easier to avoid cross-tenant leaks in multi-tenant setups, use a
tenant-specific key prefix:

```ts
const tenantId = "acme-tenant-123";

const store = await createLibSqlPersistence({
  url: "file:./awaitly.db",
  prefix: `tenant:${tenantId}:workflow:state:`,
});
```

All workflow keys will be stored with the configured prefix.

## Table Schema

The adapter automatically creates a table with the following schema:

```sql
CREATE TABLE awaitly_workflow_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX idx_awaitly_workflow_state_expires_at
ON awaitly_workflow_state(expires_at);
```

The `expires_at` column stores ISO 8601 timestamps and is used for TTL support.

## Using the KeyValueStore Directly

If you want lower-level control, you can use `LibSqlKeyValueStore` directly
and wire it into `createStatePersistence`:

```ts
import { LibSqlKeyValueStore } from "awaitly-libsql";
import { createStatePersistence } from "awaitly/persistence";

const store = new LibSqlKeyValueStore({
  url: "file:./awaitly.db",
  tableName: "awaitly_workflow_state",
});

const persistence = createStatePersistence(store, "custom:prefix:");
```

## Requirements

- Node.js >= 22
- `@libsql/client` package

## License

MIT

