---
title: Rate Limiting
description: Control throughput with token bucket and concurrency limiters
---

Control throughput for steps that hit rate-limited APIs or limited resources.

## Rate limiter

Token bucket algorithm for requests-per-second limits:

```typescript
import { createRateLimiter, rateLimiterPresets } from 'awaitly/ratelimit';

// Custom config
const rateLimiter = createRateLimiter('api-calls', {
  maxPerSecond: 10,        // Maximum operations per second
  burstCapacity: 20,       // Allow brief spikes (default: maxPerSecond * 2)
  strategy: 'wait',        // 'wait' (default) or 'reject'
});

// Wrap operations
const data = await rateLimiter.execute(async () => {
  return await callExternalApi();
});

// Or use presets
const apiLimiter = createRateLimiter('external-api', rateLimiterPresets.api);
// { maxPerSecond: 10, burstCapacity: 20, strategy: 'wait' }

const externalLimiter = createRateLimiter('partner-api', rateLimiterPresets.external);
// { maxPerSecond: 5, burstCapacity: 10, strategy: 'wait' }
```

## Concurrency limiter

Limit parallel operations (for database connections, file handles, etc.):

```typescript
import { createConcurrencyLimiter, rateLimiterPresets } from 'awaitly/ratelimit';

const concurrencyLimiter = createConcurrencyLimiter('db-pool', {
  maxConcurrent: 5,        // Max 5 concurrent operations
  maxQueueSize: 100,       // Queue up to 100 waiting requests
  strategy: 'queue',       // 'queue' (default) or 'reject'
});

const data = await concurrencyLimiter.execute(async () => {
  return await db.query('SELECT * FROM users');
});

// Or use preset
const dbLimiter = createConcurrencyLimiter('database', rateLimiterPresets.database);
// { maxConcurrent: 10, strategy: 'queue', maxQueueSize: 100 }
```

## Combined limiter

Apply both rate and concurrency limits:

```typescript
import { createCombinedLimiter } from 'awaitly/ratelimit';

const limiter = createCombinedLimiter('api', {
  rate: { maxPerSecond: 10 },
  concurrency: { maxConcurrent: 3 },
});

const data = await limiter.execute(async () => callApi());
```

## Result-returning operations

```typescript
const result = await rateLimiter.executeResult(async () => {
  return ok(await callExternalApi());
});

if (!result.ok) {
  // Handle error (could be rate limit rejection or operation error)
}
```

## Batch operations

Process many items with bounded concurrency:

```typescript
const results = await concurrencyLimiter.executeAll(
  ids.map(id => async () => fetchItem(id))
);

// results: Array of outcomes
```

## Monitoring

```typescript
const stats = rateLimiter.getStats();
console.log(stats.availableTokens);  // Current available tokens
console.log(stats.waitingCount);     // Requests waiting for tokens
```

## Strategies

### Wait strategy (default)

Requests wait until capacity is available:

```typescript
const limiter = createRateLimiter('api', {
  maxPerSecond: 10,
  strategy: 'wait', // Queues requests
});
```

### Reject strategy

Requests fail immediately when at capacity:

```typescript
const limiter = createRateLimiter('api', {
  maxPerSecond: 10,
  strategy: 'reject', // Throws RateLimitExceededError
});

try {
  await limiter.execute(() => callApi());
} catch (error) {
  if (isRateLimitExceededError(error)) {
    console.log('Rate limit exceeded, try later');
  }
}
```

## In workflows

```typescript
const apiLimiter = createRateLimiter('partner-api', rateLimiterPresets.external);

const result = await workflow(async (step) => {
  // Rate-limited API calls
  const users = await step(async () => {
    const ids = ['1', '2', '3', '4', '5'];
    return await apiLimiter.executeAll(
      ids.map(id => async () => fetchUser(id))
    );
  });

  return users;
});
```

## Configuration reference

### Rate limiter

```typescript
{
  maxPerSecond: number;      // Operations per second (required)
  burstCapacity?: number;    // Max burst (default: maxPerSecond * 2)
  strategy?: 'wait' | 'reject';
}
```

### Concurrency limiter

```typescript
{
  maxConcurrent: number;     // Max parallel operations (required)
  maxQueueSize?: number;     // Max waiting requests (default: Infinity)
  strategy?: 'queue' | 'reject';
}
```

### Presets

| Preset | Type | Config |
|--------|------|--------|
| `rateLimiterPresets.api` | Rate | 10/s, burst 20 |
| `rateLimiterPresets.external` | Rate | 5/s, burst 10 |
| `rateLimiterPresets.database` | Concurrency | 10 concurrent, queue 100 |
