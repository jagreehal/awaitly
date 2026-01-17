# Resource Management

RAII-style (Resource Acquisition Is Initialization) resource cleanup for async operations. Connections, file handles, and locks get cleaned up automatically--even when errors occur.

## Table of Contents

- [The Problem: Resource Leaks](#the-problem-resource-leaks)
- [The Solution: `withScope`](#the-solution-withscope)
- [Basic Usage](#basic-usage)
- [LIFO Cleanup Order](#lifo-cleanup-order)
- [The `createResource` Helper](#the-createresource-helper)
- [Cleanup Errors](#cleanup-errors)
- [Manual Scope Management](#manual-scope-management)
- [Integration with Workflows](#integration-with-workflows)
- [Best Practices](#best-practices)
- [When NOT to Use This](#when-not-to-use-this)
- [Summary](#summary)

## The Problem: Resource Leaks

Async code makes cleanup hard. Early returns, exceptions, and complex control flow all create opportunities for leaks:

```typescript
// ❌ Leak on early return
async function processData(userId: string) {
  const db = await createConnection();
  const cache = await createCache();

  const user = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    return err('USER_NOT_FOUND');  // Leaked: db and cache never closed!
  }

  const result = await processUser(user);
  await db.close();
  await cache.disconnect();
  return ok(result);
}
```

The `try/finally` pattern helps but gets nested and error-prone:

```typescript
// ❌ Verbose and error-prone
async function processData(userId: string) {
  const db = await createConnection();
  try {
    const cache = await createCache();
    try {
      // ... actual work
    } finally {
      await cache.disconnect();
    }
  } finally {
    await db.close();
  }
}
```

## The Solution: `withScope`

Register resources with a scope. They're cleaned up automatically when the scope exits--success, error, or exception:

```typescript
import { withScope } from 'awaitly/resource'; import { ok, err } from 'awaitly';

const result = await withScope(async (scope) => {
  // scope.add returns the value directly for convenience
  const db = scope.add({
    value: await createConnection(),
    close: async () => db.close(),  // db IS the connection
  });

  const cache = scope.add({
    value: await createCache(),
    close: async () => cache.disconnect(),  // cache IS the client
  });

  const user = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    return err('USER_NOT_FOUND');  // ✓ db and cache still get closed
  }

  return ok(await processUser(user));
  // ✓ Resources closed automatically in LIFO order
});
```

## Basic Usage

```typescript
import { withScope } from 'awaitly/resource'; import { ok, type AsyncResult } from 'awaitly';

interface DbClient {
  query: (sql: string) => Promise<unknown[]>;
  close: () => Promise<void>;
}

async function getUsers(): AsyncResult<User[], 'DB_ERROR'> {
  return withScope(async (scope) => {
    // scope.add returns the value directly
    const db = scope.add({
      value: await createDbConnection(),
      close: async () => db.close(),
    });

    const users = await db.query('SELECT * FROM users');
    return ok(users as User[]);
  });
}
```

## LIFO Cleanup Order

Resources are cleaned up in **reverse order** (LIFO: Last-In-First-Out). This handles dependencies correctly--later resources often depend on earlier ones:

```typescript
const result = await withScope(async (scope) => {
  // 1. Connection first
  const db = scope.add({
    value: await createConnection(),
    close: async () => {
      console.log('Closing db');
      await db.close();  // db IS the connection
    },
  });

  // 2. Cache depends on connection
  const cache = scope.add({
    value: await createCache(db),  // pass db directly
    close: async () => {
      console.log('Closing cache');
      await cache.disconnect();
    },
  });

  // 3. Session depends on both
  const session = scope.add({
    value: await createSession(db, cache),
    close: async () => {
      console.log('Closing session');
      await session.end();
    },
  });

  return ok('done');
});

// Output:
// Closing session  (added last, closed first)
// Closing cache
// Closing db       (added first, closed last)
```

## The `createResource` Helper

For cleaner syntax when the acquire/release pattern is straightforward:

```typescript
import { withScope, createResource } from 'awaitly/resource'; import { ok } from 'awaitly';

const result = await withScope(async (scope) => {
  // createResource wraps acquire + release into a Resource
  const dbResource = await createResource(
    () => createConnection({ host: 'localhost' }),
    (conn) => conn.close()
  );
  const db = scope.add(dbResource);

  const cacheResource = await createResource(
    () => createCache(),
    (cache) => cache.disconnect()
  );
  const cache = scope.add(cacheResource);

  // Use resources
  return ok(await db.query('SELECT 1'));
});
```

## Cleanup Errors

If cleanup fails, `withScope` returns a `ResourceCleanupError`:

```typescript
import { withScope, isResourceCleanupError } from 'awaitly/resource'; import { ok } from 'awaitly';

const result = await withScope(async (scope) => {
  scope.add({
    value: 'resource1',
    close: async () => {
      throw new Error('Cleanup failed!');
    },
  });

  return ok('done');
});

if (!result.ok && isResourceCleanupError(result.error)) {
  console.log('Cleanup errors:', result.error.errors);
  console.log('Original result:', result.error.originalResult);
}
```

Key behaviors:

- **All resources are attempted** - Even if one cleanup fails, others still run
- **Errors are collected** - Multiple cleanup failures are grouped
- **Original result preserved** - You can see what the scope returned before cleanup failed

## Manual Scope Management

For advanced cases, use `createResourceScope` directly:

```typescript
import { createResourceScope } from 'awaitly/resource';

const scope = createResourceScope();

try {
  // scope.add returns the value directly, not a Resource wrapper
  const db = scope.add({
    value: await createConnection(),
    close: async () => db.close(),  // db IS the connection
  });

  const cache = scope.add({
    value: await createCache(),
    close: async () => cache.disconnect(),  // cache IS the client
  });

  // Check scope state
  console.log('Resources:', scope.size());  // 2

  // Use resources...
  await db.query('SELECT 1');
} finally {
  await scope.close();  // Manual cleanup
}
```

**Note:** `scope.has()` expects a `Resource<T>` object, not the value. To check if a resource is in the scope, store the Resource object before calling `add()`:

```typescript
const dbResource = { value: await createConnection(), close: async () => dbResource.value.close() };
const db = scope.add(dbResource);
console.log('Has db:', scope.has(dbResource));  // true
```

## Integration with Workflows

Use `withScope` inside workflow steps:

```typescript
import { createWorkflow, ok } from 'awaitly'; import { withScope } from 'awaitly/resource';

const deps = {
  processWithResources: async (id: string) => {
    return withScope(async (scope) => {
      const db = scope.add({
        value: await createConnection(),
        close: async () => db.close(),
      });

      const data = await db.query('SELECT * FROM items WHERE id = ?', [id]);
      return ok(data);
    });
  },
};

const workflow = createWorkflow(deps);

const result = await workflow(async (step, { processWithResources }) => {
  const data = await step(processWithResources('123'));
  return ok(data);
});
```

## Best Practices

### DO: Register cleanup immediately after acquisition

```typescript
// ✓ Register right after acquiring
const db = scope.add({
  value: await createConnection(),
  close: async () => db.close(),  // db IS the connection
});
```

### DON'T: Defer registration

```typescript
// ✗ Gap where leak can occur
const conn = await createConnection();
// If something throws here, conn leaks
const db = scope.add({ value: conn, close: () => conn.close() });
```

### DO: Keep cleanup functions simple

```typescript
// ✓ Simple, focused cleanup
const db = scope.add({
  value: await createConnection(),
  close: async () => {
    await db.close();  // db IS the connection
  },
});
```

### DON'T: Add complex logic in cleanup

```typescript
// ✗ Cleanup shouldn't have business logic
const db = scope.add({
  value: await createConnection(),
  close: async () => {
    await saveState(db);      // Could fail, complicates cleanup
    await notifyOthers();     // Side effects in cleanup
    await db.close();
  },
});
```

### DO: Handle cleanup errors appropriately

```typescript
const result = await withScope(async (scope) => { /* ... */ });

if (!result.ok) {
  if (isResourceCleanupError(result.error)) {
    // Log cleanup issues but don't expose to users
    logger.error('Resource cleanup failed', result.error.errors);
    // Return the original error if there was one
    if (result.error.originalResult && !result.error.originalResult.ok) {
      return result.error.originalResult;
    }
  }
}
```

## Real-World Scenarios

### Database Transaction with File Upload

You're processing an order that requires both a database transaction and uploading a receipt to S3. If either fails, both must be rolled back.

```typescript
import { withScope } from 'awaitly/resource'; import { ok, err } from 'awaitly';

async function processOrder(orderId: string, receiptData: Buffer) {
  return withScope(async (scope) => {
    // Track if transaction is committed to avoid rollback on success
    let committed = false;
    
    // Start transaction - rolled back on failure
    const tx = scope.add({
      value: await db.beginTransaction(),
      close: async () => {
        // Only rollback if not committed
        if (!committed) {
          await tx.rollback();
        }
      },
    });

    // Upload receipt - deleted on failure
    const receiptKey = `receipts/${orderId}.pdf`;
    scope.add({
      value: await s3.upload(receiptKey, receiptData),
      close: async () => {
        await s3.delete(receiptKey);
      },
    });

    // Do the work
    await tx.execute('UPDATE orders SET status = ? WHERE id = ?', ['completed', orderId]);
    await tx.execute('INSERT INTO receipts (order_id, s3_key) VALUES (?, ?)', [orderId, receiptKey]);

    // Commit transaction - mark as committed so rollback doesn't run
    await tx.commit();
    committed = true;

    return ok({ orderId, receiptKey });
  });
}
```

Why this works: If the database commit fails, the S3 file is automatically deleted. If S3 upload fails, the transaction is automatically rolled back. No orphaned files, no partial commits.

### Multi-Tenant Data Export

You're exporting data for multiple tenants, each requiring a temporary directory and database connection. If any tenant fails, clean up their resources but continue with others.

```typescript
import { withScope } from 'awaitly/resource'; import { ok } from 'awaitly';

// Helper functions for temp directory management
async function createTempDir(tenantId: string): Promise<string> {
  const dir = `/tmp/export-${tenantId}-${Date.now()}`;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function releaseTempDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

async function exportTenantData(tenantId: string) {
  return withScope(async (scope) => {
    // Temp directory - cleaned up on success or failure
    const exportDir = scope.add({
      value: await createTempDir(tenantId),
      close: async () => {
        await releaseTempDir(exportDir);
      },
    });

    // Tenant database connection - closed when done
    const conn = scope.add({
      value: await getTenantConnection(tenantId),
      close: async () => {
        await conn.close();
      },
    });

    // Export data to temp directory
    const data = await conn.query('SELECT * FROM user_data');
    await fs.writeFile(`${exportDir}/data.json`, JSON.stringify(data));

    // Upload to permanent storage
    const zipPath = `${exportDir}/export.zip`;
    await zipDirectory(exportDir, zipPath);
    await s3.upload(`exports/${tenantId}/${Date.now()}.zip`, zipPath);

    return ok({ tenantId, recordCount: data.length });
  });
}
```

Why this works: Each tenant's temp directory and connection are cleaned up regardless of success or failure. One tenant's error doesn't leave resources hanging for others.

### Webhook Processing with Temporary Credentials

You're processing webhooks that require temporary AWS credentials and a distributed lock. Both must be released properly.

```typescript
import { withScope } from 'awaitly/resource'; import { ok, err } from 'awaitly';

async function processWebhook(webhookId: string, payload: unknown) {
  return withScope(async (scope) => {
    // Acquire distributed lock - released on exit
    const lock = scope.add({
      value: await redis.lock(`webhook:${webhookId}`, { ttl: 30000 }),
      close: async () => {
        await lock.release();
      },
    });

    // Get temporary credentials - no cleanup needed (they expire)
    const creds = await sts.assumeRole({
      RoleArn: 'arn:aws:iam::xxx:role/webhook-processor',
      DurationSeconds: 900
    });

    // Create S3 client with temp creds
    const s3 = new S3Client({ credentials: creds });

    // Process the webhook
    const result = await processPayload(payload, s3);

    // Store result - lock prevents duplicate processing
    await db.execute(
      'INSERT INTO webhook_results (id, result) VALUES (?, ?)',
      [webhookId, JSON.stringify(result)]
    );

    return ok(result);
  });
}
```

Why this works: The distributed lock is always released, even if processing fails. No deadlocks from crashed handlers. Temporary credentials expire naturally, so no cleanup needed.

## When to Use This

- **Multiple resources** - Managing 2+ resources that need cleanup
- **Complex control flow** - Early returns, multiple error paths, nested conditions
- **Async cleanup** - Resources that require async operations to release
- **Dependency chains** - Resources that depend on each other (LIFO order handles this)

## When NOT to Use This

- **Single resource** - A simple `try/finally` is clearer for one resource
- **Non-async cleanup** - If cleanup is synchronous, RAII patterns are simpler
- **Global resources** - Connection pools, singletons--these have their own lifecycle
- **Framework-managed** - If your framework handles cleanup (e.g., request-scoped DI), use that

## Summary

| Function | Purpose |
| -------- | ------- |
| `withScope(fn)` | Auto-cleanup on scope exit |
| `createResourceScope()` | Manual scope management |
| `createResource(acquire, release)` | Helper for acquire/release pattern |
| `isResourceCleanupError(err)` | Type guard for cleanup errors |

**The key insight:** Register resources immediately. Cleanup happens automatically in reverse order. No more leaks from early returns or exceptions.
