---
title: Persistence
description: Save and resume workflows across restarts
---

Save workflow state and resume later. Completed steps return their cached results without re-executing.

import { AnimatedWorkflowDiagram } from '~/components';

<AnimatedWorkflowDiagram
  steps={[
    {
      id: 'run',
      label: 'run workflow',
      description: 'Keyed steps complete and are recorded in the snapshot.',
      duration: '2s',
    },
    {
      id: 'save',
      label: 'save snapshot',
      description: 'Persist JSON snapshot to your store.',
      duration: '1.5s',
    },
    {
      id: 'restore',
      label: 'restore and resume',
      description: 'Re-run with snapshot to skip completed keyed steps.',
      duration: '2s',
    },
  ]}
  autoPlay={true}
  loop={true}
/>

## Quick Start

```typescript
import { createWorkflow } from 'awaitly/workflow';

// Execute workflow
const workflow = createWorkflow('workflow', { fetchUser, fetchPosts });

await workflow(async (step, deps) => {
  const user = await step('fetchUser', () => deps.fetchUser('1'), { key: 'user:1' });
  const posts = await step('fetchPosts', () => deps.fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});

// Save snapshot
const snapshot = workflow.getSnapshot();
await db.save('wf-123', JSON.stringify(snapshot));

// Later: restore and resume
const saved = await db.load('wf-123');
const restoredSnapshot = JSON.parse(saved);

const workflow2 = createWorkflow('workflow', { fetchUser, fetchPosts }, {
  snapshot: restoredSnapshot,
});

await workflow2(async (step, deps) => {
  // These steps return cached values - no actual fetch
  const user = await step('fetchUser', () => deps.fetchUser('1'), { key: 'user:1' });
  const posts = await step('fetchPosts', () => deps.fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});
```

## One-liner Store Setup

Use the official persistence adapters for production:

```typescript
// PostgreSQL
import { postgres } from 'awaitly-postgres';
const store = postgres('postgresql://localhost/mydb');

// MongoDB
import { mongo } from 'awaitly-mongo';
const store = mongo('mongodb://localhost:27017/mydb');

// libSQL / SQLite
import { libsql } from 'awaitly-libsql';
const store = libsql('file:./workflow.db');
```

Then use the store:

```typescript
// Execute + persist
const workflow = createWorkflow('workflow', { fetchUser });
await workflow(myWorkflowFn);
await store.save('wf-123', workflow.getSnapshot());

// Restore + resume
const snapshot = await store.load('wf-123');
const workflow2 = createWorkflow('workflow', { fetchUser }, { snapshot });
await workflow2(myWorkflowFn);
```

## WorkflowSnapshot

The snapshot is a JSON-serializable object:

```typescript
interface WorkflowSnapshot {
  formatVersion: 1;
  steps: Record<string, StepResult>;
  execution: {
    status: 'running' | 'completed' | 'failed';
    lastUpdated: string;
    completedAt?: string;
    currentStepId?: string;
  };
  metadata?: {
    workflowId?: string;
    definitionHash?: string;
    input?: JSONValue;
    [key: string]: JSONValue | undefined;
  };
  warnings?: Array<{
    type: 'lossy_value';
    stepId: string;
    path: string;
    reason: 'non-json' | 'circular' | 'encode-failed';
  }>;
}

// StepResult is a discriminated union
type StepResult =
  | { ok: true; value: JSONValue }
  | { ok: false; error: JSONValue; cause: SerializedCause; meta?: { origin: 'result' | 'throw' } };
```

You can use `JSON.stringify()` and `JSON.parse()` directly - no special serialization needed.

## Auto-save with Subscribe

Use `subscribe()` to automatically save after each step:

```typescript
const workflow = createWorkflow('workflow', { fetchUser });

// Auto-save on every step completion
const unsubscribe = workflow.subscribe(async (event) => {
  if (event.type === 'step_complete') {
    await store.save('wf-123', event.snapshot);
  }
});

await workflow(myWorkflowFn);
unsubscribe();  // Cleanup
```

Subscribe options:

```typescript
workflow.subscribe(listener, {
  mode: 'sync' | 'async',      // Default: 'sync'
  coalesce: 'none' | 'latest', // Default: 'none' (async only)
});
```

- `mode: 'sync'`: Callback runs inline (keep fast!)
- `mode: 'async'`: Callback runs in microtask queue
- `coalesce: 'latest'`: During bursts, only deliver latest event (prevents DB spam)

## Snapshot Options

Configure snapshot behavior:

```typescript
const workflow = createWorkflow('workflow', deps, {
  snapshot: loadedSnapshot,      // null = fresh start
  onUnknownSteps: 'warn',        // 'warn' | 'error' | 'ignore'
  onDefinitionChange: 'warn',    // 'warn' | 'error' | 'ignore'
});
```

Get snapshot with options:

```typescript
const snapshot = workflow.getSnapshot({
  include: 'all',              // 'all' | 'completed' | 'failed'
  metadata: { userId: '123' }, // Custom metadata (JSONValue)
  limit: 1000,                 // Max steps to include (optional)
  sinceStepId: 'user:1',       // Incremental: only steps after this (optional)
});
```

## Validation

Check if an object is a valid snapshot:

```typescript
import {
  looksLikeWorkflowSnapshot,
  validateSnapshot,
  assertValidSnapshot,
} from 'awaitly/persistence';

// Quick check
if (looksLikeWorkflowSnapshot(obj)) {
  // Probably a snapshot
}

// Full validation with errors
const result = validateSnapshot(obj);
if (result.valid) {
  const snapshot = result.snapshot;
} else {
  console.error(result.errors);
}

// Throwing helper
const snapshot = assertValidSnapshot(obj); // throws SnapshotFormatError
```

## Merge Snapshots

For incremental persistence:

```typescript
import { mergeSnapshots } from 'awaitly/persistence';

const merged = mergeSnapshots(baseSnapshot, deltaSnapshot);
// delta.steps overwrites base.steps
// execution from delta
// metadata shallow merged
```

## Check Step Completion

From a loaded snapshot, check step completion via the `ok` field:

```typescript
const snapshot = await store.load('wf-123');
if (snapshot && snapshot.steps['user:1']?.ok) {
  console.log('User already fetched');
}
```

For subscribe events, use the `isStepComplete` type guard from `awaitly/workflow` to narrow event types.

## Store Interface

All store adapters implement this interface:

```typescript
interface SnapshotStore {
  save(id: string, snapshot: WorkflowSnapshot): Promise<void>;
  load(id: string): Promise<WorkflowSnapshot | null>;
  delete(id: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>>;
  close(): Promise<void>;
}
```

## Official Persistence Adapters

### PostgreSQL

```typescript
import { postgres } from 'awaitly-postgres';

// One-liner
const store = postgres('postgresql://localhost/mydb');

// With options
const store = postgres({
  url: 'postgresql://localhost/mydb',
  table: 'my_workflow_snapshots',
  prefix: 'orders:',
});
```

[Learn more about PostgreSQL persistence →](./postgres-persistence/)

### MongoDB

```typescript
import { mongo } from 'awaitly-mongo';

// One-liner
const store = mongo('mongodb://localhost:27017/mydb');

// With options
const store = mongo({
  url: 'mongodb://localhost:27017',
  database: 'myapp',
  collection: 'my_workflow_snapshots',
  prefix: 'orders:',
});
```

[Learn more about MongoDB persistence →](./mongo-persistence/)

### libSQL / SQLite

```typescript
import { libsql } from 'awaitly-libsql';

// Local SQLite
const store = libsql('file:./workflow.db');

// Remote Turso
const store = libsql({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

## Creating Custom Adapters

Implement the `SnapshotStore` interface:

```typescript
function myStore(): SnapshotStore {
  return {
    async save(id, snapshot) {
      await redis.set(id, JSON.stringify(snapshot));
    },
    async load(id) {
      const data = await redis.get(id);
      return data ? JSON.parse(data) : null;
    },
    async delete(id) {
      await redis.del(id);
    },
    async list(options) {
      // Implementation
    },
    async close() {
      // Cleanup
    },
  };
}
```

## Next

[Learn about Human-in-the-Loop →](/guides/human-in-loop/)
