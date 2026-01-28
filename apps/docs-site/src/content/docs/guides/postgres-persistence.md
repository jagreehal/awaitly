---
title: PostgreSQL Persistence
description: Use PostgreSQL as a persistence backend for awaitly workflows
---

The [`awaitly-postgres`](https://www.npmjs.com/package/awaitly-postgres) package provides a ready-to-use PostgreSQL persistence adapter for awaitly workflows. Provide your connection string and you're ready to go.

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
import { createPostgresPersistence } from 'awaitly-postgres';
import { durable } from 'awaitly/durable';

const store = await createPostgresPersistence({
  connectionString: process.env.DATABASE_URL,
});

const result = await durable.run(
  { fetchUser, createOrder },
  async (step, { fetchUser, createOrder }) => {
    const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
    const order = await step(() => createOrder(user), { key: 'create-order' });
    return order;
  },
  {
    id: 'checkout-123',
    store,
  }
);
```

## Configuration

### Connection String

```typescript
const store = await createPostgresPersistence({
  connectionString: 'postgresql://user:password@localhost:5432/dbname',
});
```

### Individual Options

```typescript
const store = await createPostgresPersistence({
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  user: 'postgres',
  password: 'password',
  tableName: 'custom_workflow_state', // optional, default: 'awaitly_workflow_state'
  prefix: 'myapp:workflow:', // optional, default: 'workflow:state:'
});
```

### Using Existing Pool

If you already have a PostgreSQL connection pool, you can reuse it:

```typescript
import { Pool } from 'pg';
import { createPostgresPersistence } from 'awaitly-postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = await createPostgresPersistence({
  existingPool: pool,
});
```

### Pool Configuration

Customize connection pool settings:

```typescript
const store = await createPostgresPersistence({
  connectionString: process.env.DATABASE_URL,
  pool: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
});
```

## Table Schema

The adapter automatically creates a table with the following schema:

```sql
CREATE TABLE awaitly_workflow_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMP
);

CREATE INDEX idx_awaitly_workflow_state_expires_at 
ON awaitly_workflow_state(expires_at) 
WHERE expires_at IS NOT NULL;
```

The table is created automatically on first use. You can customize the table name via the `tableName` option.

## Features

- ✅ **Automatic table creation** - No manual schema setup required
- ✅ **TTL support** - Automatic expiration of old workflow state
- ✅ **Connection pooling** - Efficient connection management
- ✅ **Pattern matching** - Query keys using glob patterns
- ✅ **Zero configuration** - Works out of the box

## Advanced Usage

### Direct KeyValueStore Access

If you need more control, you can use the `PostgresKeyValueStore` class directly:

```typescript
import { PostgresKeyValueStore } from 'awaitly-postgres';
import { createStatePersistence } from 'awaitly/persistence';

const store = new PostgresKeyValueStore({
  connectionString: process.env.DATABASE_URL,
});

const persistence = createStatePersistence(store, 'custom:prefix:');
```

## Implementation Details

The [`awaitly-postgres`](https://www.npmjs.com/package/awaitly-postgres) package is a reference implementation of the `KeyValueStore` interface. Here's how it works:

### KeyValueStore Implementation

The `PostgresKeyValueStore` class implements all five required methods:

- **`get(key)`**: Queries PostgreSQL with expiration check
- **`set(key, value, {ttl})`**: Uses `INSERT ... ON CONFLICT UPDATE` for upserts
- **`delete(key)`**: Standard `DELETE` query
- **`exists(key)`**: Optimized existence check with `LIMIT 1`
- **`keys(pattern)`**: Converts glob patterns (`*`) to SQL `LIKE` queries

### Automatic Table Creation

The adapter creates the table and index on first use:

```sql
CREATE TABLE IF NOT EXISTS awaitly_workflow_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_awaitly_workflow_state_expires_at 
ON awaitly_workflow_state(expires_at) 
WHERE expires_at IS NOT NULL;
```

### Pattern Matching

Glob patterns are converted to SQL `LIKE` patterns:

```typescript
// User pattern: "workflow:state:*"
// SQL pattern: "workflow:state:%"
const likePattern = pattern.replace(/\*/g, '%');
```

### Connection Pooling

Uses `pg.Pool` for efficient connection management. The pool is shared across all operations and handles connection lifecycle automatically.

## Production Considerations

### Connection Pooling

The adapter uses `pg.Pool` for connection management. Configure pool size based on your workload:

```typescript
const store = await createPostgresPersistence({
  connectionString: process.env.DATABASE_URL,
  pool: {
    max: 20, // Maximum pool size
    min: 5,  // Minimum pool size
    idleTimeoutMillis: 30000,
  },
});
```

### Table Maintenance

The `expires_at` index helps with automatic cleanup, but you may want to periodically clean up expired rows:

```sql
DELETE FROM awaitly_workflow_state 
WHERE expires_at IS NOT NULL 
  AND expires_at < NOW();
```

### Monitoring

Monitor table size and query performance:

```sql
-- Check table size
SELECT pg_size_pretty(pg_total_relation_size('awaitly_workflow_state'));

-- Check index usage
SELECT * FROM pg_stat_user_indexes 
WHERE indexrelname = 'idx_awaitly_workflow_state_expires_at';
```

## Requirements

- Node.js >= 22
- PostgreSQL >= 12
- `pg` package

## Next

[Learn about MongoDB persistence →](./mongo-persistence/)
