---
title: Troubleshooting
description: Common issues and how to fix them
---

Quick solutions to common problems when working with awaitly.

## TypeScript Issues

### "Property 'value' does not exist on type 'Result'"

**Problem:** You're checking `result.ok` but TypeScript doesn't narrow the type.

```typescript
// ❌ TypeScript error
const result = await fetchUser('123');
if (result.ok) {
  console.log(result.value.name); // Error: Property 'value' does not exist
}
```

**Solution:** Use the correct narrowing pattern or testing utilities.

```typescript
// ✅ Option 1: Check .ok directly
const result = await fetchUser('123');
if (result.ok) {
  console.log(result.value.name); // Works
}

// ✅ Option 2: In tests, use unwrapOk
import { unwrapOk } from 'awaitly/testing';
const user = unwrapOk(await fetchUser('123'));
expect(user.name).toBe('Alice');
```

### "Cannot find module 'awaitly/workflow'"

**Problem:** Import paths not resolving.

**Solution:** Ensure your `tsconfig.json` has these settings:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true
  }
}
```

For Node.js without a bundler, use `"moduleResolution": "node16"` or `"nodenext"`.

### Error types not inferring correctly

**Problem:** TypeScript shows `unknown` instead of your error union.

```typescript
// result.error is unknown instead of 'NOT_FOUND' | 'DB_ERROR'
```

**Solution:** Use `createWorkflow` instead of `run()`. The workflow factory infers error types from dependencies.

```typescript
// ❌ Manual error typing needed with run()
const result = await run<User, 'NOT_FOUND' | 'DB_ERROR'>(...);

// ✅ Automatic inference with createWorkflow
const workflow = createWorkflow({ fetchUser, saveUser }); // Infers errors
const result = await workflow(async (step) => { ... });
```

## UnexpectedError

### What is UnexpectedError?

`UnexpectedError` appears when something throws that wasn't declared in your error types. It's a safety net.

```typescript
const result = await workflow(async (step) => {
  const user = await step(() => fetchUser('1'));
  return user;
});

if (!result.ok) {
  // result.error is: 'NOT_FOUND' | UnexpectedError
  if (result.error.type === 'UNEXPECTED_ERROR') {
    console.log('Something unexpected happened:', result.error.cause);
  }
}
```

### How to prevent UnexpectedError

**Option 1:** Wrap throwing code with `step.try`:

```typescript
// ❌ fetch can throw, becomes UnexpectedError
const data = await step(() => fetch('/api'));

// ✅ Wrap throws with step.try
const data = await step.try(
  () => fetch('/api').then(r => r.json()),
  { error: 'FETCH_FAILED' as const }
);
```

**Option 2:** Use strict mode to force explicit handling:

```typescript
const workflow = createWorkflow(deps, {
  strict: true,
  catchUnexpected: (cause) => ({
    type: 'UNEXPECTED' as const,
    message: cause instanceof Error ? cause.message : 'Unknown error',
  }),
});
```

## Caching Issues

### Cache not working between workflow runs

**Problem:** Steps re-execute even with the same key.

**Solution 1:** Use thunks, not direct calls:

```typescript
// ❌ Executes immediately, cache never used
const user = await step(fetchUser('1'), { key: 'user:1' });

// ✅ Thunk allows cache to skip execution
const user = await step(() => fetchUser('1'), { key: 'user:1' });
```

**Solution 2:** Provide a cache to the workflow:

```typescript
// In-memory cache (good for single run)
const cache = new Map();
const workflow = createWorkflow(deps, { cache });

// For persistence across runs, use resumeState
const workflow = createWorkflow(deps, { resumeState: savedState });
```

### Keys must be stable

**Problem:** Cache misses because keys change.

```typescript
// ❌ Bad: Key changes every time
const user = await step(() => fetchUser('1'), { key: `user:${Date.now()}` });

// ✅ Good: Stable key based on input
const user = await step(() => fetchUser('1'), { key: `user:1` });
```

## Resume/Persistence Issues

### Steps re-execute after resume

**Problem:** Workflow resumes but steps run again.

**Solution:** Ensure steps have keys and you're providing `resumeState`:

```typescript
// 1. Collect state during execution
const collector = createResumeStateCollector();
const workflow = createWorkflow(deps, { onEvent: collector.handleEvent });

await workflow(async (step) => {
  // Steps MUST have keys to be saved
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});

// 2. Save the state
const state = collector.getResumeState();
await db.saveState(workflowId, stringifyState(state));

// 3. Later, load and resume
const savedState = parseState(await db.loadState(workflowId));
const resumed = createWorkflow(deps, { resumeState: savedState });

// Keyed steps will use cached values
await resumed(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user:1' }); // Cache hit
  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` }); // Cache hit
  return { user, posts };
});
```

### State not persisting errors correctly

**Problem:** Error results not preserved after resume.

**Solution:** This works automatically - error results are preserved with metadata. Make sure you're using the latest version of awaitly.

```typescript
// Error results are saved
const state = collector.getResumeState();
// state.stepResults includes both ok and err results
```

## Workflow Cancellation

### AbortSignal not stopping workflow

**Problem:** Cancelling doesn't stop in-flight steps.

**Solution:** Pass the signal to your async operations:

```typescript
const controller = new AbortController();

const workflow = createWorkflow(deps, { signal: controller.signal });

const result = await workflow(async (step) => {
  // Pass signal to fetch
  const user = await step.try(
    () => fetch('/api/user', { signal: controller.signal }).then(r => r.json()),
    { error: 'FETCH_FAILED' as const }
  );
  return user;
});

// Cancel from elsewhere
controller.abort();
```

### Detecting cancellation

```typescript
import { isWorkflowCancelled, WorkflowCancelledError } from 'awaitly/workflow';

if (!result.ok && isWorkflowCancelled(result.error)) {
  console.log('Workflow was cancelled');
}
```

## Timeout Issues

### Timeout not triggering

**Problem:** `step.withTimeout` doesn't timeout.

**Solution:** Ensure the underlying operation respects cancellation:

```typescript
// ❌ sleep doesn't check for cancellation
const data = await step.withTimeout(
  () => sleep(10000).then(() => 'done'),
  { ms: 1000 }
);

// ✅ Use AbortSignal-aware operations
const data = await step.withTimeout(
  (signal) => fetch('/api', { signal }).then(r => r.json()),
  { ms: 5000 }
);
```

### Checking if error was timeout

```typescript
import { isStepTimeoutError, getStepTimeoutMeta } from 'awaitly/workflow';

if (!result.ok && isStepTimeoutError(result.error)) {
  const meta = getStepTimeoutMeta(result.error);
  console.log(`Timed out after ${meta?.ms}ms`);
}
```

## Retry Issues

### Retries not working

**Problem:** Step doesn't retry on failure.

**Solution:** Use `step.retry` with a thunk:

```typescript
// ❌ Not using retry
const data = await step(() => fetchData());

// ✅ With retries
const data = await step.retry(
  () => fetchData(),
  { attempts: 3, backoff: 'exponential' }
);
```

### Retrying only specific errors

```typescript
const data = await step.retry(
  () => fetchData(),
  {
    attempts: 3,
    backoff: 'exponential',
    retryOn: (error) => error === 'NETWORK_ERROR', // Only retry network errors
  }
);
```

## Testing Issues

### Mocks not being used

**Problem:** Real functions called instead of mocks.

**Solution:** Use the harness correctly:

```typescript
import { createWorkflowHarness, okOutcome, errOutcome } from 'awaitly/testing';

const harness = createWorkflowHarness({
  fetchUser: () => okOutcome({ id: '1', name: 'Alice' }),
  chargeCard: () => okOutcome({ txId: 'tx-123' }),
});

// Run through the harness, not directly
const result = await harness.run(async (step, deps) => {
  const user = await step(() => deps.fetchUser('1'), { name: 'fetch-user' });
  return user;
});
```

### Testing retry behavior

```typescript
import { createMockFn, okOutcome, errOutcome } from 'awaitly/testing';

const mockFetch = createMockFn();

// Fail twice, then succeed
mockFetch
  .returnsOnce(errOutcome('NETWORK_ERROR'))
  .returnsOnce(errOutcome('NETWORK_ERROR'))
  .returns(okOutcome({ data: 'success' }));

const harness = createWorkflowHarness({ fetchData: mockFetch });

const result = await harness.run(async (step) => {
  return await step.retry(() => fetchData(), { attempts: 3 });
});

expect(mockFetch.getCallCount()).toBe(3);
```

## Memory Issues

### Memory leak with long-running workflows

**Problem:** Memory grows over time.

**Solutions:**

1. **Clear cache periodically** if using in-memory cache
2. **Use TTL on singleflight** for request deduplication
3. **Limit event collector** if collecting for visualization

```typescript
// Singleflight with TTL prevents unbounded growth
const flight = createSingleflight({ ttl: 60000 }); // 1 minute TTL

// Clear cache after workflow completes
workflow.cache?.clear?.();
```

### Too many events collected

```typescript
// Limit events for visualization
const viz = createVisualizer({ maxSteps: 100 });
```

## Common Patterns

### Converting try/catch to Result

```typescript
// Before: try/catch with unknown errors
async function getUserData(id: string) {
  try {
    const user = await db.findUser(id);
    if (!user) throw new Error('Not found');
    return user;
  } catch (e) {
    throw e; // Error type is unknown
  }
}

// After: Result with typed errors
import { ok, err, type AsyncResult } from 'awaitly';

async function getUserData(id: string): AsyncResult<User, 'NOT_FOUND' | 'DB_ERROR'> {
  try {
    const user = await db.findUser(id);
    if (!user) return err('NOT_FOUND');
    return ok(user);
  } catch (e) {
    return err('DB_ERROR');
  }
}
```

### Handling errors at boundaries

```typescript
// HTTP handler pattern
async function handleRequest(req, res) {
  const result = await checkoutWorkflow(async (step) => {
    const order = await step(() => fetchOrder(req.body.orderId));
    const payment = await step(() => chargeCard(order.total));
    return { order, payment };
  });

  if (result.ok) {
    return res.json({ success: true, data: result.value });
  }

  // Map errors to HTTP responses
  switch (result.error.type ?? result.error) {
    case 'ORDER_NOT_FOUND':
      return res.status(404).json({ error: 'Order not found' });
    case 'CARD_DECLINED':
      return res.status(402).json({ error: 'Payment declined' });
    case 'UNEXPECTED_ERROR':
      console.error('Unexpected:', result.error.cause);
      return res.status(500).json({ error: 'Internal error' });
    default:
      return res.status(500).json({ error: 'Unknown error' });
  }
}
```

## Still stuck?

1. Check the [API Reference](/reference/api) for function signatures
2. Look at [Patterns](/patterns/checkout-flow) for complete examples
3. Open an issue on [GitHub](https://github.com/jagreehal/awaitly/issues)

## Next

[Learn about Framework Integrations →](../framework-integrations/)
