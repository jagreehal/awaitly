# awaitly-postgres

PostgreSQL persistence adapter for [awaitly](https://github.com/jagreehal/awaitly) workflows.

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
    const user = await step('fetchUser', () => fetchUser('123'), { key: 'fetch-user' });
    const order = await step('createOrder', () => createOrder(user), { key: 'create-order' });
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

```typescript
import { Pool } from 'pg';
import { createPostgresPersistence } from 'awaitly-postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = await createPostgresPersistence({
  existingPool: pool,
});
```

### Pool Configuration

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

- ✅ Automatic table creation
- ✅ TTL support (automatic expiration)
- ✅ Connection pooling
- ✅ Pattern matching for key queries
- ✅ Zero configuration required

## Requirements

- Node.js >= 22
- PostgreSQL >= 12
- `pg` package (peer dependency)

## License

MIT
