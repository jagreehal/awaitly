---
title: Resource Management
description: RAII-style resource cleanup for database connections and files
---

Manage resources (database connections, file handles, API clients) with guaranteed cleanup using `withScope`.

## Basic usage

```typescript
import { withScope, createResource, ok } from 'awaitly/resource';

const result = await withScope(async (scope) => {
  // Resources are tracked for automatic cleanup
  const db = scope.add(await createDatabaseClient());
  const cache = scope.add(await createCacheClient());

  // Do work
  const user = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  await cache.set(`user:${userId}`, user);

  return ok(user);
});
// cache closed first, then db (LIFO order) - even on errors!
```

## Create reusable resources

Use `createResource` to wrap acquire/release logic:

```typescript
import { createResource } from 'awaitly/resource';

const createDbResource = async (connectionString: string) =>
  createResource(
    // Acquire
    async () => {
      const client = new DatabaseClient(connectionString);
      await client.connect();
      return client;
    },
    // Release
    async (client) => {
      await client.disconnect();
    }
  );

const createFileResource = async (path: string, mode: string) =>
  createResource(
    async () => {
      const handle = await fs.open(path, mode);
      return handle;
    },
    async (handle) => {
      await handle.close();
    }
  );
```

## Use in workflows

```typescript
import { withScope, createResource, ok, err } from 'awaitly/resource';

const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource(process.env.DATABASE_URL));

  const user = await db.query('SELECT * FROM users WHERE id = ?', ['123']);
  if (!user) {
    return err('NOT_FOUND' as const);
  }

  return ok(user);
});
// Database disconnected automatically
```

## LIFO cleanup order

Resources are closed in reverse order of acquisition:

```typescript
const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource());        // Acquired 1st
  const cache = scope.add(await createCacheClient());    // Acquired 2nd
  const apiClient = scope.add(await createApiClient());  // Acquired 3rd

  // ... work ...

  return ok(data);
});
// Cleanup order: apiClient → cache → db
```

This matters when resources depend on each other (close connections before connection pools).

## Cleanup on error

Resources are cleaned up even when the workflow fails:

```typescript
const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource());

  // This fails
  const user = await db.query('SELECT * FROM missing_table');
  return ok(user);
});
// db.disconnect() still called
```

## Cleanup on exception

Resources are cleaned up even when code throws:

```typescript
const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource());

  throw new Error('Something broke');

  return ok(data);
});
// db.disconnect() still called
```

## Nested scopes

Scopes can be nested:

```typescript
const result = await withScope(async (outer) => {
  const db = outer.add(await createDbResource());

  // Inner scope for temporary resources
  const tempResult = await withScope(async (inner) => {
    const tempFile = inner.add(await createTempFile());
    await tempFile.write(data);
    return ok(await tempFile.path());
  });
  // tempFile closed here

  if (!tempResult.ok) {
    return tempResult;
  }

  await db.query('INSERT INTO files (path) VALUES (?)', [tempResult.value]);
  return ok({ path: tempResult.value });
});
// db closed here
```

## Manual scope control

For cases where you need explicit control:

```typescript
import { createResourceScope } from 'awaitly/resource';

const scope = createResourceScope();

try {
  const db = scope.add(await createDbResource());
  const cache = scope.add(await createCacheClient());

  // ... work ...
} finally {
  await scope.close();
}
```

## Handling cleanup errors

If cleanup fails, you get a `ResourceCleanupError`:

```typescript
import { isResourceCleanupError } from 'awaitly/resource';

const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource());
  return ok(data);
});

if (!result.ok && isResourceCleanupError(result.error)) {
  console.error('Failed to clean up:', result.error.errors);
  // errors: Array of individual cleanup failures
}
```

## Real-world example: Database transaction

```typescript
const createTransaction = async (db: Database) =>
  createResource(
    async () => {
      await db.query('BEGIN');
      return db;
    },
    async (tx) => {
      // Rollback if not committed
      try {
        await tx.query('ROLLBACK');
      } catch {
        // Already committed or connection lost
      }
    }
  );

const transferFunds = async (from: string, to: string, amount: number) => {
  return await withScope(async (scope) => {
    const db = scope.add(await createDbResource());
    const tx = scope.add(await createTransaction(db));

    // Debit
    const fromAccount = await tx.query(
      'UPDATE accounts SET balance = balance - ? WHERE id = ? RETURNING balance',
      [amount, from]
    );

    if (fromAccount.balance < 0) {
      return err('INSUFFICIENT_FUNDS' as const);
      // Transaction rolled back automatically
    }

    // Credit
    await tx.query(
      'UPDATE accounts SET balance = balance + ? WHERE id = ?',
      [amount, to]
    );

    // Commit
    await tx.query('COMMIT');

    return ok({ from, to, amount });
  });
};
```
