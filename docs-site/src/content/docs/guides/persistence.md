---
title: Persistence
description: Save and resume workflows across restarts
---

Save workflow state to a database and resume later. Completed steps return their cached results without re-executing.

## Collect state during execution

Use `createStepCollector` to automatically capture step results:

```typescript
import { createWorkflow, createStepCollector } from 'awaitly';

const collector = createStepCollector();

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
const state = collector.getState();
```

Only steps with `key` are saved.

## Save to database

Serialize the state and store it:

```typescript
import { stringifyState } from 'awaitly';

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
import { parseState } from 'awaitly';

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

For structured storage, use `createStatePersistence`:

```typescript
import { createStatePersistence } from 'awaitly';

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

## Check if step is complete

Use `isStepComplete` to check state before execution:

```typescript
import { isStepComplete } from 'awaitly';

const state = await persistence.load('wf-123');

if (isStepComplete(state, 'user:1')) {
  console.log('User already fetched');
}
```

## Crash recovery pattern

Save state after each batch of work:

```typescript
const collector = createStepCollector();
const workflow = createWorkflow(deps, { onEvent: collector.handleEvent });

const result = await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user:1' });

  // Save after critical step
  await saveCheckpoint(collector.getState());

  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});

// Final save
await saveCheckpoint(collector.getState());
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
import { createFileCache } from 'awaitly';

const cache = createFileCache({
  directory: './workflow-state',
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
});

const workflow = createWorkflow(deps, { cache });
```

## Next

[Learn about Human-in-the-Loop →](/workflow/guides/human-in-loop/)
