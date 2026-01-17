# Persistence

Save and restore workflow state for crash recovery, long-running workflows, and human-in-the-loop scenarios. The persistence module provides adapters for various storage backends and serialization helpers for Result types.

## Table of Contents

- [Overview](#overview)
- [Serialization](#serialization)
- [Cache Adapters](#cache-adapters)
- [State Persistence](#state-persistence)
- [Hydrating Cache](#hydrating-cache)
- [Database Examples](#database-examples)
- [API Reference](#api-reference)

## Overview

Persistence enables:

- **Crash Recovery**: Resume workflows after server restarts
- **Long-Running Workflows**: Handle operations that span hours or days
- **Human-in-the-Loop**: Pause for approvals and resume later
- **Caching**: Avoid re-executing expensive operations

```typescript
import { createMemoryCache, serializeState, deserializeState } from 'awaitly/persistence';
import { createWorkflow } from 'awaitly';

// Create a cache
const cache = createMemoryCache({ maxSize: 1000, ttl: 60000 });

// Use with workflow
const workflow = createWorkflow(deps, { cache });
```

## Serialization

### Serializing Results

Results may contain Error objects and other non-JSON-safe values. Use serialization helpers:

```typescript
import { serializeResult, deserializeResult, ok, err } from 'awaitly/persistence';

// Serialize
const result = ok({ userId: '123' });
const serialized = serializeResult(result);
// { ok: true, value: { userId: '123' } }

// With error containing cause
const error = err('FETCH_FAILED', { cause: new Error('Network timeout') });
const serialized = serializeResult(error);
// {
//   ok: false,
//   error: 'FETCH_FAILED',
//   cause: { type: 'error', errorName: 'Error', errorMessage: 'Network timeout', errorStack: '...' }
// }

// Deserialize
const restored = deserializeResult(serialized);
```

### Serializing Workflow State

```typescript
import {
  serializeState,
  deserializeState,
  stringifyState,
  parseState,
} from 'awaitly/persistence';
import { createHITLCollector } from 'awaitly';

// Collect state during workflow
const collector = createHITLCollector();
const workflow = createWorkflow(deps, { onEvent: collector.handleEvent });

await workflow(/* ... */);

// Get and serialize state
const state = collector.getState();
const serialized = serializeState(state, { runId: 'run_123' });

// Convert to JSON string for storage
const json = stringifyState(state, { runId: 'run_123' });
await database.save('workflow:run_123', json);

// Later: restore from JSON
const loadedJson = await database.load('workflow:run_123');
const restoredState = parseState(loadedJson);

// Resume workflow
const workflow = createWorkflow(deps, { resumeState: restoredState });
```

### Serialization Types

```typescript
// Cause can be Error, value, or undefined
interface SerializedCause {
  type: 'error' | 'value' | 'undefined';
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  value?: unknown;
}

// Result with optional cause
interface SerializedResult {
  ok: boolean;
  value?: unknown;
  error?: unknown;
  cause?: SerializedCause;
}

// Full state for resumption
interface SerializedState {
  version: number;
  entries: Record<string, SerializedEntry>;
  metadata?: Record<string, unknown>;
}
```

## Cache Adapters

### In-Memory Cache

Fast cache with optional LRU eviction and TTL:

```typescript
import { createMemoryCache } from 'awaitly/persistence';

const cache = createMemoryCache({
  maxSize: 1000,    // Max entries (LRU eviction)
  ttl: 60000,       // 1 minute TTL
});

const workflow = createWorkflow(deps, { cache });
```

### File System Cache

Persist cache to disk:

```typescript
import { createFileCache } from 'awaitly/persistence';
import * as fs from 'fs/promises';

const cache = createFileCache({
  directory: './workflow-cache',
  extension: '.json',
  fs: {
    readFile: (path) => fs.readFile(path, 'utf-8'),
    writeFile: (path, data) => fs.writeFile(path, data, 'utf-8'),
    unlink: fs.unlink,
    exists: async (path) => fs.access(path).then(() => true).catch(() => false),
    readdir: (path) => fs.readdir(path),
    mkdir: (path, opts) => fs.mkdir(path, opts),
  },
});

// Initialize directory
await cache.init();

// Use async methods for persistence
await cache.setAsync('key', result);
const restored = await cache.getAsync('key');
```

### Key-Value Store Cache

Use Redis, DynamoDB, or any key-value store:

```typescript
import { createKVCache } from 'awaitly/persistence';
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const cache = createKVCache({
  store: {
    get: (key) => redis.get(key),
    set: (key, value, opts) => redis.set(key, value, opts?.ttl ? { EX: opts.ttl } : undefined),
    delete: (key) => redis.del(key).then(n => n > 0),
    exists: (key) => redis.exists(key).then(n => n > 0),
    keys: (pattern) => redis.keys(pattern),
  },
  prefix: 'workflow:cache:',
  ttl: 3600,  // 1 hour
});

// Async operations
await cache.setAsync('user:123', result);
const restored = await cache.getAsync('user:123');
```

## State Persistence

### StatePersistence Interface

For saving complete workflow state:

```typescript
import { createStatePersistence } from 'awaitly/persistence';

const persistence = createStatePersistence(kvStore, 'workflow:state:');

// Save state
await persistence.save('run_123', resumeState, { userId: 'user_456' });

// Load state
const state = await persistence.load('run_123');
if (state) {
  const workflow = createWorkflow(deps, { resumeState: state });
}

// List all saved workflows
const runIds = await persistence.list();

// Delete completed workflow
await persistence.delete('run_123');
```

### Complete Example

```typescript
import { createKVCache, createStatePersistence } from 'awaitly/persistence';
import { createWorkflow, createHITLCollector } from 'awaitly';

// Setup stores
const kvStore = /* your key-value store */;
const cache = createKVCache({ store: kvStore, prefix: 'cache:' });
const statePersistence = createStatePersistence(kvStore, 'state:');

async function runWorkflowWithPersistence(input: Input) {
  // Check for existing state
  const existingState = await statePersistence.load(input.runId);

  const collector = createHITLCollector();
  const workflow = createWorkflow(deps, {
    cache,
    resumeState: existingState,
    onEvent: collector.handleEvent,
  });

  const result = await workflow(async (step) => {
    const user = await step(() => fetchUser(input.userId), { key: 'fetch-user' });
    const approval = await step(() => requireApproval(user), { key: 'approval' });
    const order = await step(() => createOrder(user, input), { key: 'create-order' });
    return order;
  });

  if (result.ok) {
    // Cleanup on success
    await statePersistence.delete(input.runId);
  } else {
    // Save state for resumption
    await statePersistence.save(input.runId, collector.getState(), {
      input,
      lastAttempt: Date.now(),
    });
  }

  return result;
}
```

## Hydrating Cache

Load persisted state into memory on startup:

```typescript
import { createMemoryCache, createHydratingCache, createStatePersistence } from 'awaitly/persistence';

const memoryCache = createMemoryCache();
const persistence = createStatePersistence(kvStore);

const cache = createHydratingCache(memoryCache, persistence, 'run_123');

// Hydrate from persistence before running
await cache.hydrate();

// Now cache has all previously persisted step results
const workflow = createWorkflow(deps, { cache });
```

## Database Examples

### PostgreSQL

```typescript
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const kvStore = {
  async get(key: string): Promise<string | null> {
    const { rows } = await pool.query(
      'SELECT value FROM workflow_cache WHERE key = $1',
      [key]
    );
    return rows[0]?.value ?? null;
  },

  async set(key: string, value: string, opts?: { ttl?: number }): Promise<void> {
    const expiresAt = opts?.ttl ? new Date(Date.now() + opts.ttl * 1000) : null;
    await pool.query(
      `INSERT INTO workflow_cache (key, value, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = $3`,
      [key, value, expiresAt]
    );
  },

  async delete(key: string): Promise<boolean> {
    const { rowCount } = await pool.query(
      'DELETE FROM workflow_cache WHERE key = $1',
      [key]
    );
    return (rowCount ?? 0) > 0;
  },

  async exists(key: string): Promise<boolean> {
    const { rows } = await pool.query(
      'SELECT 1 FROM workflow_cache WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())',
      [key]
    );
    return rows.length > 0;
  },

  async keys(pattern: string): Promise<string[]> {
    const { rows } = await pool.query(
      'SELECT key FROM workflow_cache WHERE key LIKE $1',
      [pattern.replace('*', '%')]
    );
    return rows.map(r => r.key);
  },
};

const cache = createKVCache({ store: kvStore, prefix: 'wf:' });
```

### Redis

```typescript
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const kvStore = {
  get: (key: string) => redis.get(key),
  set: (key: string, value: string, opts?: { ttl?: number }) =>
    opts?.ttl
      ? redis.set(key, value, { EX: opts.ttl })
      : redis.set(key, value),
  delete: (key: string) => redis.del(key).then(n => n > 0),
  exists: (key: string) => redis.exists(key).then(n => n > 0),
  keys: (pattern: string) => redis.keys(pattern),
};

const cache = createKVCache({ store: kvStore, prefix: 'workflow:', ttl: 3600 });
```

### DynamoDB

```typescript
import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});
const tableName = 'workflow-cache';

const kvStore = {
  async get(key: string): Promise<string | null> {
    const { Item } = await client.send(new GetItemCommand({
      TableName: tableName,
      Key: { pk: { S: key } },
    }));
    return Item?.value?.S ?? null;
  },

  async set(key: string, value: string, opts?: { ttl?: number }): Promise<void> {
    const item: Record<string, any> = {
      pk: { S: key },
      value: { S: value },
    };
    if (opts?.ttl) {
      item.ttl = { N: String(Math.floor(Date.now() / 1000) + opts.ttl) };
    }
    await client.send(new PutItemCommand({
      TableName: tableName,
      Item: item,
    }));
  },

  async delete(key: string): Promise<boolean> {
    await client.send(new DeleteItemCommand({
      TableName: tableName,
      Key: { pk: { S: key } },
    }));
    return true;
  },

  // ... exists and keys implementations
};

const cache = createKVCache({ store: kvStore, prefix: 'wf:' });
```

## API Reference

### Serialization Functions

| Function | Description |
|----------|-------------|
| `serializeCause(cause)` | Serialize Error/value to JSON-safe |
| `deserializeCause(serialized)` | Restore cause from JSON-safe |
| `serializeResult(result)` | Serialize Result to JSON-safe |
| `deserializeResult(serialized)` | Restore Result from JSON-safe |
| `serializeState(state, metadata?)` | Serialize ResumeState |
| `deserializeState(serialized)` | Restore ResumeState |
| `stringifyState(state, metadata?)` | Convert state to JSON string |
| `parseState(json)` | Parse state from JSON string |

### Cache Adapters

| Function | Description |
|----------|-------------|
| `createMemoryCache(options?)` | In-memory LRU cache with TTL |
| `createFileCache(options)` | File system-backed cache |
| `createKVCache(options)` | Key-value store cache |
| `createHydratingCache(memory, persistence, runId)` | Cache with async hydration |
| `createStatePersistence(store, prefix?)` | State persistence adapter |

### StepCache Interface

```typescript
interface StepCache {
  get(key: string): Result | undefined;
  set(key: string, result: Result): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  clear(): void;
}
```

### KeyValueStore Interface

```typescript
interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ttl?: number }): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  keys(pattern: string): Promise<string[]>;
}
```

### StatePersistence Interface

```typescript
interface StatePersistence {
  save(runId: string, state: ResumeState, metadata?: Record<string, unknown>): Promise<void>;
  load(runId: string): Promise<ResumeState | undefined>;
  delete(runId: string): Promise<boolean>;
  list(): Promise<string[]>;
}
```
