---
title: Persistence
description: Save and resume workflows across restarts
---

:::caution[Options go to createWorkflow]
Options like `resumeState` must be passed to `createWorkflow(deps, { resumeState })`, not when calling the workflow. Options passed to the executor are silently ignored.
:::

Save workflow state to a database and resume later. Completed steps return their cached results without re-executing.

## Quick Start Imports

**Option 1: Import from main package** (recommended for most use cases)

```typescript
import { createWorkflow, createResumeStateCollector, isStepComplete } from 'awaitly/workflow';
import { stringifyState, parseState } from 'awaitly/persistence';
```

**Option 2: Import from persistence submodule** (for full persistence API)

```typescript
import { createWorkflow, createResumeStateCollector, isStepComplete } from 'awaitly/workflow';
import { stringifyState, parseState, createStatePersistence } from 'awaitly/persistence';
```

:::danger[Always use stringifyState/parseState]
`ResumeState.steps` is a `Map`, which **cannot be serialized with `JSON.stringify()`**. Maps become empty objects `{}` when serialized directly!

```typescript
// WRONG - Map becomes empty object!
const json = JSON.stringify(state);
const restored = JSON.parse(json);  // steps is {} not Map!
```

```typescript
// CORRECT - preserves Map structure
import { stringifyState, parseState } from 'awaitly/persistence';
const json = stringifyState(state);
const restored = parseState(json);  // steps is Map!
```

:::

## Collect state during execution

Use `createResumeStateCollector` to automatically capture step results:

```typescript
import { createWorkflow, createResumeStateCollector } from 'awaitly/workflow';

const collector = createResumeStateCollector();

const workflow = createWorkflow(
  { fetchUser, fetchPosts },
  { onEvent: collector.handleEvent }
);

await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});

// Get collected state
const state = collector.getResumeState();
```

Only steps with `key` are saved.

## Save to database

Serialize the state and store it:

```typescript
import { stringifyState } from 'awaitly/persistence';

const json = stringifyState(state, {
  workflowId: 'wf-123',
  timestamp: Date.now(),
});

await db.workflowStates.create({
  id: 'wf-123',
  state: json,
  createdAt: new Date(),
});
```

## Resume from saved state

Load and parse the state, then pass it to a new workflow:

```typescript
import { parseState } from 'awaitly/persistence';

const saved = await db.workflowStates.findUnique({
  where: { id: 'wf-123' },
});

const resumeState = parseState(saved.state);

const workflow = createWorkflow(
  { fetchUser, fetchPosts },
  { resumeState }
);

await workflow(async (step) => {
  // These steps return cached values - no actual fetch
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});
```

## State persistence adapter

For structured storage, use `createStatePersistence` with a `KeyValueStore` implementation:

```typescript
import { createStatePersistence } from 'awaitly/persistence';

const persistence = createStatePersistence({
  get: (key) => redis.get(key),
  set: (key, value) => redis.set(key, value),
  delete: (key) => redis.del(key).then(n => n > 0),
  exists: (key) => redis.exists(key).then(n => n > 0),
  keys: (pattern) => redis.keys(pattern),
}, 'workflow:state:');

// Save
await persistence.save('wf-123', state, { userId: 'user-1' });

// Load
const savedState = await persistence.load('wf-123');

// Resume
const workflow = createWorkflow(deps, { resumeState: savedState });
```

## Creating Custom Persistence Adapters

You can create your own persistence adapter by implementing the `KeyValueStore` interface. The official `awaitly-postgres` and `awaitly-mongo` packages are great examples of how to build production-ready adapters.

### The KeyValueStore Interface

All persistence adapters must implement this interface:

```typescript
import type { KeyValueStore } from 'awaitly/persistence';

interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
}
```

### Example: PostgreSQL Adapter

Here's how `awaitly-postgres` implements the interface (simplified):

```typescript
import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';
import type { KeyValueStore } from 'awaitly/persistence';

export class PostgresKeyValueStore implements KeyValueStore {
  private pool: Pool;
  private tableName: string;

  constructor(options: { connectionString: string; tableName?: string }) {
    this.pool = new PgPool({ connectionString: options.connectionString });
    this.tableName = options.tableName ?? 'awaitly_workflow_state';
  }

  async get(key: string): Promise<string | null> {
    // Ensure table exists
    await this.ensureInitialized();

    const result = await this.pool.query(
      `SELECT value FROM ${this.tableName} 
       WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [key]
    );

    return result.rows[0]?.value ?? null;
  }

  async set(key: string, value: string, options?: { ttl?: number }): Promise<void> {
    await this.ensureInitialized();

    const expiresAt = options?.ttl
      ? new Date(Date.now() + options.ttl * 1000)
      : null;

    await this.pool.query(
      `INSERT INTO ${this.tableName} (key, value, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
      [key, value, expiresAt]
    );
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE key = $1`,
      [key]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM ${this.tableName} 
       WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
      [key]
    );
    return result.rows.length > 0;
  }

  async keys(pattern: string): Promise<string[]> {
    // Convert glob pattern (*) to SQL LIKE (%)
    const likePattern = pattern.replace(/\*/g, '%');
    const result = await this.pool.query(
      `SELECT key FROM ${this.tableName} 
       WHERE key LIKE $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [likePattern]
    );
    return result.rows.map(row => row.key);
  }

  private async ensureInitialized(): Promise<void> {
    // Create table if it doesn't exist
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_expires_at 
      ON ${this.tableName}(expires_at) WHERE expires_at IS NOT NULL;
    `);
  }
}
```

Then create a factory function that uses `createStatePersistence`:

```typescript
import { createStatePersistence } from 'awaitly/persistence';
import { PostgresKeyValueStore } from './postgres-store';

export async function createPostgresPersistence(options: {
  connectionString: string;
  prefix?: string;
}) {
  const store = new PostgresKeyValueStore(options);
  return createStatePersistence(store, options.prefix);
}
```

### Example: MongoDB Adapter

Here's how `awaitly-mongo` implements it (simplified):

```typescript
import { MongoClient } from 'mongodb';
import type { KeyValueStore } from 'awaitly/persistence';

export class MongoKeyValueStore implements KeyValueStore {
  private collection: Collection<{ _id: string; value: string; expiresAt?: Date }>;

  constructor(options: { connectionString: string; collection?: string }) {
    const client = new MongoClient(options.connectionString);
    const db = client.db();
    this.collection = db.collection(options.collection ?? 'workflow_state');
  }

  async get(key: string): Promise<string | null> {
    await this.ensureInitialized();

    const doc = await this.collection.findOne({
      _id: key,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ],
    });

    return doc?.value ?? null;
  }

  async set(key: string, value: string, options?: { ttl?: number }): Promise<void> {
    await this.ensureInitialized();

    const expiresAt = options?.ttl
      ? new Date(Date.now() + options.ttl * 1000)
      : undefined;

    await this.collection.updateOne(
      { _id: key },
      {
        $set: {
          value,
          ...(expiresAt ? { expiresAt } : { $unset: { expiresAt: '' } }),
        },
      },
      { upsert: true }
    );
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: key });
    return result.deletedCount > 0;
  }

  async exists(key: string): Promise<boolean> {
    const count = await this.collection.countDocuments({
      _id: key,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } }
      ],
    });
    return count > 0;
  }

  async keys(pattern: string): Promise<string[]> {
    // Convert glob pattern to MongoDB regex
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    const docs = await this.collection
      .find({ _id: regex })
      .project({ _id: 1 })
      .toArray();
    return docs.map(doc => doc._id);
  }

  private async ensureInitialized(): Promise<void> {
    // Create TTL index if it doesn't exist
    const indexes = await this.collection.indexes();
    const hasTtlIndex = indexes.some(
      idx => idx.key?.expiresAt && idx.expireAfterSeconds !== undefined
    );

    if (!hasTtlIndex) {
      await this.collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'expiresAt_ttl' }
      );
    }
  }
}
```

### Key Implementation Patterns

1. **Lazy Initialization**: Create tables/collections on first use
2. **TTL Support**: Handle expiration for automatic cleanup
3. **Pattern Matching**: Convert glob patterns (`*`) to database-specific queries
4. **Connection Management**: Support connection pooling and reuse
5. **Error Handling**: Return `null` for missing keys, handle connection errors gracefully

### Using Your Custom Adapter

Once you've implemented `KeyValueStore`, use it with `createStatePersistence`:

```typescript
import { createStatePersistence } from 'awaitly/persistence';
import { MyCustomKeyValueStore } from './my-store';

const store = new MyCustomKeyValueStore({ /* options */ });
const persistence = createStatePersistence(store, 'workflow:state:');

// Use with durable.run()
const result = await durable.run(deps, workflowFn, {
  id: 'workflow-123',
  store: persistence,
});
```

## Official Persistence Adapters

For production use, consider using the official persistence adapters:

### PostgreSQL

The [`awaitly-postgres`](https://www.npmjs.com/package/awaitly-postgres) package ([source](https://github.com/jagreehal/awaitly/tree/main/packages/awaitly-postgres)) provides a ready-to-use PostgreSQL adapter:

```typescript
import { createPostgresPersistence } from 'awaitly-postgres';

const store = await createPostgresPersistence({
  connectionString: process.env.DATABASE_URL,
});
```

[Learn more about PostgreSQL persistence →](./postgres-persistence)

### MongoDB

The [`awaitly-mongo`](https://www.npmjs.com/package/awaitly-mongo) package ([source](https://github.com/jagreehal/awaitly/tree/main/packages/awaitly-mongo)) provides a ready-to-use MongoDB adapter:

```typescript
import { createMongoPersistence } from 'awaitly-mongo';

const store = await createMongoPersistence({
  connectionString: process.env.MONGODB_URI,
});
```

[Learn more about MongoDB persistence →](./mongo-persistence)

## Check if step is complete

Use `isStepComplete` to check state before execution:

```typescript
import { isStepComplete } from 'awaitly/workflow';

const state = await persistence.load('wf-123');

if (isStepComplete(state, 'user:1')) {
  console.log('User already fetched');
}
```

## Crash recovery pattern

Save state after each batch of work:

```typescript
const collector = createResumeStateCollector();
const workflow = createWorkflow(deps, { onEvent: collector.handleEvent });

const result = await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user:1' });

  // Save after critical step
  await saveCheckpoint(collector.getResumeState());

  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});

// Final save
await saveCheckpoint(collector.getResumeState());
```

If the workflow crashes, resume from the last checkpoint:

```typescript
const savedState = await loadCheckpoint('wf-123');

const workflow = createWorkflow(deps, { resumeState: savedState });

// Completed steps use cached values
await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});
```

## Async resume state loading

Load state lazily:

```typescript
import { parseState } from 'awaitly/persistence';

const workflow = createWorkflow(deps, {
  resumeState: async () => {
    const saved = await db.workflowStates.findUnique({ where: { id: 'wf-123' } });
    return saved ? parseState(saved.state) : undefined;
  },
});
```

## File-based persistence

For simple cases, use the file cache adapter:

```typescript
import { createFileCache } from 'awaitly/persistence';

const cache = createFileCache({
  directory: './workflow-state',
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
});

const workflow = createWorkflow(deps, { cache });
```

## Next

[Learn about Human-in-the-Loop →](../human-in-loop/)
