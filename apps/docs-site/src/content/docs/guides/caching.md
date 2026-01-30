---
title: Caching
description: Cache step results to avoid duplicate work
---

:::caution[Options go to createWorkflow]
Cache options must be passed to `createWorkflow(deps, { cache })`, not when calling the workflow. Options passed to the executor are silently ignored.
:::

Cache step results so they don't re-execute if the workflow runs again.

## Enable caching

Pass a cache to the workflow:

```typescript
const workflow = createWorkflow(deps, {
  cache: new Map(),
});
```

## Use keys to cache steps

Give steps a `key` to enable caching:

```typescript
const result = await workflow(async (step) => {
  // This step is cached with key 'user:1'
  const user = await step(() => fetchUser('1'), { key: 'user:1' });

  // Subsequent calls with same key return cached value
  const sameUser = await step(() => fetchUser('1'), { key: 'user:1' });

  return user;
});
```

## Key requirements

Keys must be:
- **Unique per step**: Different steps need different keys
- **Stable**: Same input should produce same key
- **Deterministic**: Don't use timestamps or random values

```typescript
// Good keys
{ key: 'user:123' }
{ key: `posts:${userId}` }
{ key: `order:${orderId}:validate` }

// Bad keys
{ key: `user:${Date.now()}` }  // Changes every call
{ key: `user:${Math.random()}` } // Random
```

## Thunks required for caching

Pass a function, not the result of calling the function:

```typescript
// Without thunk - executes immediately, caching ignored
const user = await step(fetchUser('1'), { key: 'user:1' });

// With thunk - can be cached
const user = await step(() => fetchUser('1'), { key: 'user:1' });
```

## Cache scope

The cache persists across workflow runs:

```typescript
const cache = new Map();
const workflow = createWorkflow(deps, { cache });

// First run - fetches user
await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  return user;
});

// Second run - uses cached value
await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  return user; // No fetch - returns cached value
});
```

## Clearing the cache

Clear specific keys or the entire cache:

```typescript
const cache = new Map();

// Clear one key
cache.delete('user:1');

// Clear all
cache.clear();
```

## Custom cache implementations

Any object with Map-like `get`, `set`, `has`, `delete` methods works:

```typescript
// Redis-backed cache
const redisCache = {
  async get(key: string) {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : undefined;
  },
  async set(key: string, value: unknown) {
    await redis.set(key, JSON.stringify(value));
  },
  async has(key: string) {
    return await redis.exists(key) > 0;
  },
  async delete(key: string) {
    return await redis.del(key) > 0;
  },
};

const workflow = createWorkflow(deps, { cache: redisCache });
```

## Caching and errors

Errors are cached by default. If a step fails, subsequent runs return the same error:

```typescript
// First run - fetchUser returns err('NOT_FOUND')
await workflow(async (step) => {
  const user = await step(() => fetchUser('999'), { key: 'user:999' });
  return user;
});
// result.error === 'NOT_FOUND'

// Second run - returns cached error, no fetch
await workflow(async (step) => {
  const user = await step(() => fetchUser('999'), { key: 'user:999' });
  return user;
});
// result.error === 'NOT_FOUND' (from cache)
```

To retry on error, clear the cache key first.

## When to use caching

| Use case | Caching helps |
|----------|--------------|
| Idempotent operations | Yes - payments, API calls |
| Resume after crash | Yes - completed steps skipped |
| Expensive computations | Yes - don't recompute |
| Time-sensitive data | No - data may be stale |
| Non-idempotent operations | Careful - may cause issues |

## Next

[Learn about Persistence →/persistence/)
