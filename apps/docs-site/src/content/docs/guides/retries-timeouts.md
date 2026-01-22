---
title: Retries & Timeouts
description: Add resilience to workflow steps
---

Add retries and timeouts to individual steps without wrapping your entire workflow in try/catch.

## Timeouts

Limit how long a step can run:

```typescript
const data = await step.withTimeout(
  () => slowOperation(),
  { ms: 5000 }
);
```

### With name for debugging

```typescript
const data = await step.withTimeout(
  () => slowOperation(),
  { ms: 5000, name: 'Slow operation' }
);
```

If it times out, you get a `StepTimeoutError` with the name.

### Checking for timeout errors

```typescript
import { isStepTimeoutError, getStepTimeoutMeta } from 'awaitly/workflow';

if (!result.ok && isStepTimeoutError(result.error)) {
  const meta = getStepTimeoutMeta(result.error);
  console.log(`${meta.name} timed out after ${meta.ms}ms`);
}
```

## Retries

Retry failed steps with configurable backoff:

```typescript
const data = await step.retry(
  () => fetchData(),
  { attempts: 3 }
);
```

### Backoff strategies

```typescript
// Fixed: same delay every time
{ attempts: 3, backoff: 'fixed', delayMs: 100 }
// Delays: 100ms, 100ms, 100ms

// Linear: delay increases linearly
{ attempts: 3, backoff: 'linear', delayMs: 100 }
// Delays: 100ms, 200ms, 300ms

// Exponential: delay doubles each time
{ attempts: 3, backoff: 'exponential', delayMs: 100 }
// Delays: 100ms, 200ms, 400ms
```

### Cap the delay

```typescript
{
  attempts: 10,
  backoff: 'exponential',
  delayMs: 100,
  maxDelayMs: 5000, // Never wait more than 5 seconds
}
```

### Add jitter

Randomize delays to avoid thundering herd:

```typescript
{
  attempts: 3,
  backoff: 'exponential',
  delayMs: 100,
  jitter: true, // Add random variation
}
```

### Conditional retry

Only retry certain errors:

```typescript
const user = await step.retry(
  () => fetchUser('1'),
  {
    attempts: 3,
    backoff: 'exponential',
    retryOn: (error) => {
      // Don't retry NOT_FOUND - the user doesn't exist
      if (error === 'NOT_FOUND') return false;
      // Retry everything else
      return true;
    },
  }
);
```

## Combining retry and timeout

Each attempt has its own timeout:

```typescript
const data = await step.retry(
  () => step.withTimeout(() => fetchData(), { ms: 2000 }),
  { attempts: 3, backoff: 'exponential' }
);
```

This retries up to 3 times, with each attempt limited to 2 seconds.

## Via step options

You can also configure retry and timeout directly in step options:

```typescript
const user = await step(() => fetchUser('1'), {
  retry: {
    attempts: 3,
    backoff: 'exponential',
    delayMs: 100,
  },
  timeout: {
    ms: 5000,
  },
});
```

## Full example

```typescript
const workflow = createWorkflow({ fetchUserFromApi, cacheUser });

const result = await workflow(async (step) => {
  // Retry API calls with exponential backoff
  const user = await step.retry(
    () => step.withTimeout(
      () => fetchUserFromApi('123'),
      { ms: 3000, name: 'Fetch user' }
    ),
    {
      attempts: 3,
      backoff: 'exponential',
      delayMs: 200,
      maxDelayMs: 2000,
      retryOn: (error) => error !== 'NOT_FOUND',
    }
  );

  // Cache doesn't need retry
  await step(() => cacheUser(user));

  return user;
});
```

## Next

[Learn about Caching →](../caching/)
