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

## Resource Acquisition Failures

Handle failures during resource acquisition gracefully.

### Partial acquisition handling

```typescript
const result = await withScope(async (scope) => {
  // If db acquisition fails, nothing to clean up
  const db = scope.add(await createDbResource());

  // If cache acquisition fails, db will still be cleaned up
  const cache = scope.add(await createCacheClient());

  // If api client fails, both db and cache cleaned up
  const api = scope.add(await createApiClient());

  return ok({ db, cache, api });
});
// All successfully acquired resources are cleaned up on failure
```

### Conditional resource acquisition

```typescript
const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource());

  // Only acquire cache if feature is enabled
  const cache = featureFlags.cacheEnabled
    ? scope.add(await createCacheClient())
    : null;

  // Use fallback for optional resources
  const analytics = await createAnalyticsClient().catch(() => null);
  if (analytics) scope.add(analytics);

  return ok({ db, cache, analytics });
});
```

### Retry acquisition with backoff

```typescript
import { retry } from 'awaitly';

const acquireWithRetry = async <T>(
  acquire: () => Promise<T>,
  release: (resource: T) => Promise<void>,
  retries = 3
) => {
  const result = await retry(
    async () => {
      const resource = await acquire();
      return ok(resource);
    },
    { attempts: retries, backoff: 'exponential', delayMs: 100 }
  );

  if (!result.ok) {
    return result;
  }

  return createResource(() => Promise.resolve(result.value), release);
};

const result = await withScope(async (scope) => {
  // Retry database connection up to 3 times
  const dbResource = await acquireWithRetry(
    () => new DatabaseClient().connect(),
    (client) => client.disconnect()
  );

  if (!dbResource.ok) {
    return err('DB_CONNECTION_FAILED' as const);
  }

  const db = scope.add(dbResource.value);
  return ok(await db.query('SELECT * FROM users'));
});
```

## Advanced Cleanup Error Handling

### Collecting cleanup errors

```typescript
import { withScope, isResourceCleanupError } from 'awaitly/resource';

const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource());
  const cache = scope.add(await createCacheClient());
  const file = scope.add(await createFileHandle());

  return ok(await processData(db, cache, file));
});

if (!result.ok && isResourceCleanupError(result.error)) {
  // Multiple resources may have failed to clean up
  console.error(`${result.error.errors.length} cleanup failures:`);

  result.error.errors.forEach((cleanupError, index) => {
    console.error(`  ${index + 1}. ${cleanupError.resourceName}: ${cleanupError.message}`);
  });

  // The original result (if any) is preserved
  if (result.error.originalResult) {
    console.log('Original result before cleanup:', result.error.originalResult);
  }
}
```

### Custom cleanup error handling

```typescript
const createRobustResource = <T>(
  name: string,
  acquire: () => Promise<T>,
  release: (resource: T) => Promise<void>,
  onCleanupError?: (error: Error) => void
) => {
  return createResource(
    acquire,
    async (resource) => {
      try {
        await release(resource);
      } catch (error) {
        // Log but don't throw - allow other resources to clean up
        console.error(`Failed to clean up ${name}:`, error);
        onCleanupError?.(error as Error);

        // Optionally rethrow to propagate cleanup failure
        // throw error;
      }
    }
  );
};

const result = await withScope(async (scope) => {
  const db = scope.add(
    await createRobustResource(
      'database',
      () => new DatabaseClient().connect(),
      (client) => client.disconnect(),
      (error) => alertOps('Database cleanup failed', error)
    )
  );

  return ok(data);
});
```

### Cleanup timeouts

```typescript
const withCleanupTimeout = <T>(
  resource: Resource<T>,
  timeoutMs: number
): Resource<T> => {
  return createResource(
    () => Promise.resolve(resource.value),
    async (value) => {
      const cleanup = resource.release(value);

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Cleanup timeout')), timeoutMs)
      );

      await Promise.race([cleanup, timeout]);
    }
  );
};

const result = await withScope(async (scope) => {
  const slowResource = await createSlowCleanupResource();

  // Force cleanup to complete within 5 seconds
  scope.add(withCleanupTimeout(slowResource, 5000));

  return ok(data);
});
```

## Deeply Nested Scopes

### Multi-level resource hierarchies

```typescript
const processOrder = async (orderId: string) => {
  return await withScope(async (appScope) => {
    // Application-level resources (longest lived)
    const db = appScope.add(await createDbResource());
    const messageQueue = appScope.add(await createQueueClient());

    // Transaction scope
    const txResult = await withScope(async (txScope) => {
      const tx = txScope.add(await createTransaction(db));

      const order = await tx.query('SELECT * FROM orders WHERE id = ?', [orderId]);
      if (!order) return err('ORDER_NOT_FOUND' as const);

      // Processing scope for each line item
      for (const item of order.items) {
        const itemResult = await withScope(async (itemScope) => {
          // Item-level temp resources
          const tempFile = itemScope.add(await createTempFile());

          await generateInvoicePdf(item, tempFile);
          const pdfPath = await uploadToStorage(tempFile.path());

          return ok({ itemId: item.id, pdfPath });
        });
        // tempFile cleaned up after each item

        if (!itemResult.ok) return itemResult;

        await tx.query(
          'UPDATE order_items SET invoice_path = ? WHERE id = ?',
          [itemResult.value.pdfPath, item.id]
        );
      }

      await tx.query('COMMIT');
      return ok(order);
    });
    // Transaction rolled back if not committed

    if (!txResult.ok) return txResult;

    // Queue notification (after successful transaction)
    await messageQueue.publish('order.processed', { orderId });

    return txResult;
  });
  // db and messageQueue cleaned up
};
```

### Scope inheritance patterns

```typescript
// Parent scope provides shared resources
const withDatabaseScope = async <T>(
  fn: (db: Database) => Promise<Result<T, unknown>>
) => {
  return await withScope(async (scope) => {
    const db = scope.add(await createDbResource());
    return await fn(db);
  });
};

// Child operations use inherited database
const createUserWithProfile = async (userData: UserData) => {
  return await withDatabaseScope(async (db) => {
    // Nested scope for transaction
    return await withScope(async (txScope) => {
      const tx = txScope.add(await createTransaction(db));

      const user = await tx.query(
        'INSERT INTO users (name, email) VALUES (?, ?) RETURNING *',
        [userData.name, userData.email]
      );

      await tx.query(
        'INSERT INTO profiles (user_id, bio) VALUES (?, ?)',
        [user.id, userData.bio]
      );

      await tx.query('COMMIT');
      return ok(user);
    });
  });
};
```

### Parallel nested scopes

```typescript
const processMultipleOrders = async (orderIds: string[]) => {
  return await withScope(async (appScope) => {
    const db = appScope.add(await createDbResource());

    // Process orders in parallel, each with its own scope
    const results = await Promise.all(
      orderIds.map(async (orderId) => {
        return await withScope(async (orderScope) => {
          const tx = orderScope.add(await createTransaction(db));
          const tempDir = orderScope.add(await createTempDir());

          // Process this order
          const result = await processOrderInTransaction(tx, tempDir, orderId);

          if (result.ok) {
            await tx.query('COMMIT');
          }

          return result;
        });
        // Each order's tempDir and transaction cleaned up independently
      })
    );

    // Aggregate results
    const failures = results.filter(r => !r.ok);
    if (failures.length > 0) {
      return err({ failedOrders: failures } as const);
    }

    return ok(results.map(r => r.value));
  });
  // Database connection cleaned up after all orders processed
};
```

## Best Practices

### 1. Keep scopes focused

```typescript
// ❌ Too broad - resources held longer than needed
const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource());
  const file = scope.add(await createFileHandle());

  const users = await db.query('SELECT * FROM users');
  // ... lots of processing that doesn't need file ...
  await writeReport(file, users);

  return ok(users);
});

// ✅ Focused scopes - file only held when needed
const result = await withScope(async (scope) => {
  const db = scope.add(await createDbResource());
  const users = await db.query('SELECT * FROM users');

  // Separate scope for file operations
  await withScope(async (fileScope) => {
    const file = fileScope.add(await createFileHandle());
    await writeReport(file, users);
    return ok(undefined);
  });

  return ok(users);
});
```

### 2. Name resources for debugging

```typescript
const createNamedResource = <T>(
  name: string,
  acquire: () => Promise<T>,
  release: (resource: T) => Promise<void>
) => {
  return createResource(
    async () => {
      console.log(`Acquiring: ${name}`);
      return await acquire();
    },
    async (resource) => {
      console.log(`Releasing: ${name}`);
      await release(resource);
    }
  );
};

const result = await withScope(async (scope) => {
  const db = scope.add(await createNamedResource('primary-db', ...));
  const cache = scope.add(await createNamedResource('redis-cache', ...));
  // Logs:
  // Acquiring: primary-db
  // Acquiring: redis-cache
  // ... work ...
  // Releasing: redis-cache
  // Releasing: primary-db
});
```

### 3. Handle partial failures gracefully

```typescript
const result = await withScope(async (scope) => {
  const resources: { db?: Database; cache?: Cache; api?: ApiClient } = {};

  try {
    resources.db = scope.add(await createDbResource());
  } catch (error) {
    return err({ type: 'DB_FAILED', error } as const);
  }

  try {
    resources.cache = scope.add(await createCacheClient());
  } catch (error) {
    // Continue without cache - it's optional
    console.warn('Cache unavailable, continuing without it');
  }

  try {
    resources.api = scope.add(await createApiClient());
  } catch (error) {
    return err({ type: 'API_FAILED', error } as const);
  }

  return ok(resources);
});
```

## Next

[See Patterns: Error Recovery →](../error-recovery/)
