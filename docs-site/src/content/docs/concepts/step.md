---
title: Steps
description: The step() function and its variants
---

`step()` executes an operation within a workflow. If the operation fails, the workflow exits early.

## Basic usage

```typescript
const workflow = createWorkflow({ fetchUser, fetchPosts });

const result = await workflow(async (step) => {
  const user = await step(fetchUser('1'));
  // If fetchUser returns err(), execution stops here
  const posts = await step(fetchPosts(user.id));
  return { user, posts };
});
```

## Using thunks for caching

Pass a function (thunk) instead of calling directly to enable caching:

```typescript
// Without thunk - always executes
const user = await step(fetchUser('1'));

// With thunk - can be cached
const user = await step(() => fetchUser('1'), { key: 'user:1' });
```

## Step options

```typescript
const user = await step(() => fetchUser('1'), {
  name: 'Fetch user',       // For visualization/logging
  key: 'user:1',            // For caching/deduplication
  retry: { attempts: 3 },   // Retry on failure
  timeout: { ms: 5000 },    // Timeout after 5 seconds
});
```

## step.try - wrap throwing code

Convert exceptions into typed errors:

```typescript
const data = await step.try(
  async () => {
    const res = await fetch('/api/data');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  { error: 'FETCH_FAILED' as const }
);
```

The error type is added to the workflow's error union.

## step.fromResult - preserve error details

When your operation returns a Result with rich error objects:

```typescript
type ApiError = { code: number; message: string };

const callApi = async (): AsyncResult<Data, ApiError> => {
  // Returns err({ code: 429, message: 'Rate limited' })
};

const data = await step.fromResult(
  () => callApi(),
  {
    onError: (apiError) => ({
      type: 'API_ERROR' as const,
      ...apiError,
    }),
  }
);
```

## step.retry - retry with backoff

```typescript
const user = await step.retry(
  () => fetchUser('1'),
  {
    attempts: 3,
    backoff: 'exponential',  // 'fixed' | 'linear' | 'exponential'
    delayMs: 100,            // Base delay
    maxDelayMs: 5000,        // Cap for exponential
    jitter: true,            // Add randomness
    retryOn: (error) => error !== 'NOT_FOUND', // Don't retry NOT_FOUND
  }
);
```

Backoff strategies:
- **fixed**: Same delay every time
- **linear**: delay, delay*2, delay*3, ...
- **exponential**: delay, delay*2, delay*4, delay*8, ...

## step.withTimeout - add timeout

```typescript
const data = await step.withTimeout(
  () => slowOperation(),
  {
    ms: 5000,
    name: 'Slow operation', // For error messages
  }
);
```

If the timeout is reached, the workflow gets a `StepTimeoutError`.

## Combining retry and timeout

```typescript
const data = await step.retry(
  () => step.withTimeout(() => fetchData(), { ms: 2000 }),
  { attempts: 3, backoff: 'exponential' }
);
```

Each attempt has a 2-second timeout. The whole operation retries up to 3 times.

## Parallel steps

Run multiple steps concurrently:

```typescript
import { allAsync } from 'awaitly';

const result = await workflow(async (step) => {
  const [user, posts, comments] = await step(() =>
    allAsync([
      fetchUser('1'),
      fetchPosts('1'),
      fetchComments('1'),
    ])
  );
  return { user, posts, comments };
});
```

## Named steps for visualization

Give steps names to see them in workflow diagrams:

```typescript
const user = await step(() => fetchUser('1'), { name: 'Fetch user' });
const posts = await step(() => fetchPosts(user.id), { name: 'Fetch posts' });
```

See [Visualization](/workflow/guides/visualization/) for details.

## Next

[Learn about Workflows →](/workflow/concepts/workflows/)
