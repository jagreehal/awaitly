# Rate Limiting & Concurrency Control

Control throughput for operations that hit rate-limited APIs or shared resources. This module provides two complementary patterns:

- **Rate Limiting**: Control requests per second (token bucket algorithm)
- **Concurrency Limiting**: Control simultaneous operations

## Table of Contents

- [The Problem](#the-problem)
- [Rate Limiter](#rate-limiter)
- [Concurrency Limiter](#concurrency-limiter)
- [Combined Limiter](#combined-limiter)
- [Strategies](#strategies)
- [Presets](#presets)
- [Integration with Workflows](#integration-with-workflows)
- [API Reference](#api-reference)

## The Problem

External APIs and shared resources have limits:

```typescript
// Without rate limiting - gets 429 errors
const results = await Promise.all(
  userIds.map(id => fetchUserFromApi(id))  // 1000 parallel requests!
);

// Without concurrency control - exhausts connection pool
const data = await Promise.all(
  queries.map(q => database.query(q))  // 500 concurrent DB connections!
);
```

Problems:
- **429 Too Many Requests**: APIs reject requests exceeding their limits
- **Resource exhaustion**: Database connection pools depleted
- **Cascading failures**: Overloaded services fail completely
- **Unfair resource usage**: One workflow hogs all capacity

## Rate Limiter

The rate limiter uses a token bucket algorithm to control requests per second:

```typescript
import { createRateLimiter } from 'awaitly/ratelimit';

// Create a rate limiter (10 requests/second)
const apiLimiter = createRateLimiter('external-api', {
  maxPerSecond: 10,
  burstCapacity: 20,  // Allow brief spikes
  strategy: 'wait',   // Wait for available slot (default)
});

// Operations automatically wait when rate exceeded
const data = await apiLimiter.execute(async () => {
  return await fetch('https://api.example.com/data');
});
```

### Configuration

```typescript
interface RateLimiterConfig {
  // Maximum operations per second
  maxPerSecond: number;

  // Burst capacity - allows brief spikes above the rate
  // Default: maxPerSecond * 2
  burstCapacity?: number;

  // Strategy when rate limit is exceeded
  // - 'wait': Wait until a slot is available (default)
  // - 'reject': Reject immediately with error
  strategy?: 'wait' | 'reject';
}
```

### Reject Strategy

Use `'reject'` when you can't afford to wait:

```typescript
import { createRateLimiter, isRateLimitExceededError } from 'awaitly/ratelimit';

const limiter = createRateLimiter('fast-api', {
  maxPerSecond: 100,
  strategy: 'reject',  // Fail fast instead of waiting
});

try {
  await limiter.execute(() => callApi());
} catch (error) {
  if (isRateLimitExceededError(error)) {
    console.log(`Rate limited. Retry after ${error.retryAfterMs}ms`);
    return getCachedResponse();
  }
  throw error;
}
```

### With Result Types

```typescript
const result = await limiter.executeResult(async () => {
  return fetchUser(id);  // Returns Result<User, 'NOT_FOUND'>
});

if (!result.ok) {
  if (isRateLimitExceededError(result.error)) {
    return err('RATE_LIMITED' as const);
  }
  return result;  // Pass through NOT_FOUND
}
```

### Monitoring

```typescript
const stats = limiter.getStats();
console.log({
  availableTokens: stats.availableTokens,  // Current available tokens
  maxTokens: stats.maxTokens,              // Burst capacity
  tokensPerSecond: stats.tokensPerSecond,  // Refill rate
  waitingCount: stats.waitingCount,        // Requests waiting
});
```

## Concurrency Limiter

The concurrency limiter controls how many operations run simultaneously:

```typescript
import { createConcurrencyLimiter } from 'awaitly/ratelimit';

// Limit to 5 concurrent operations
const dbLimiter = createConcurrencyLimiter('database', {
  maxConcurrent: 5,
  strategy: 'queue',     // Queue excess requests (default)
  maxQueueSize: 100,     // Max queued requests
});

// Execute with concurrency control
const result = await dbLimiter.execute(async () => {
  return await database.query('SELECT * FROM users');
});
```

### Configuration

```typescript
interface ConcurrencyLimiterConfig {
  // Maximum concurrent operations
  maxConcurrent: number;

  // Strategy when limit is reached
  // - 'queue': Queue and wait (default)
  // - 'reject': Reject immediately
  strategy?: 'queue' | 'reject';

  // Maximum queue size (only for 'queue' strategy)
  // Default: Infinity
  maxQueueSize?: number;
}
```

### Batch Operations

Process many items with controlled concurrency:

```typescript
const limiter = createConcurrencyLimiter('api-batch', {
  maxConcurrent: 10,
});

// Process 1000 items with max 10 concurrent requests
const results = await limiter.executeAll(
  userIds.map(id => async () => {
    return await fetchUser(id);
  })
);
// Results are in order, despite concurrent execution
```

### Queue Full Error

When using `maxQueueSize`, requests may be rejected:

```typescript
import { createConcurrencyLimiter, isQueueFullError } from 'awaitly/ratelimit';

const limiter = createConcurrencyLimiter('limited-pool', {
  maxConcurrent: 5,
  maxQueueSize: 10,
});

try {
  await limiter.execute(() => expensiveOperation());
} catch (error) {
  if (isQueueFullError(error)) {
    console.log(`Queue full: ${error.queueSize}/${error.maxQueueSize}`);
    return fallbackResponse();
  }
  throw error;
}
```

### Monitoring

```typescript
const stats = limiter.getStats();
console.log({
  activeCount: stats.activeCount,      // Currently executing
  maxConcurrent: stats.maxConcurrent,  // Max allowed
  queueSize: stats.queueSize,          // Waiting in queue
  maxQueueSize: stats.maxQueueSize,    // Max queue size
});
```

## Combined Limiter

For APIs that have both rate limits AND connection limits:

```typescript
import { createCombinedLimiter } from 'awaitly/ratelimit';

// Stripe API: 100 req/s AND max 25 concurrent
const stripeLimiter = createCombinedLimiter('stripe', {
  rate: { maxPerSecond: 100 },
  concurrency: { maxConcurrent: 25 },
});

// Operations are rate-limited first, then concurrency-limited
const charge = await stripeLimiter.execute(async () => {
  return await stripe.charges.create({ amount: 1000 });
});
```

### Access Individual Limiters

```typescript
const combined = createCombinedLimiter('api', {
  rate: { maxPerSecond: 10 },
  concurrency: { maxConcurrent: 5 },
});

// Get stats from each limiter
const rateStats = combined.rate?.getStats();
const concurrencyStats = combined.concurrency?.getStats();
```

## Strategies

### When to Use 'wait' (Default)

Best for:
- Background processing
- Batch jobs
- When latency is acceptable

```typescript
const limiter = createRateLimiter('batch-api', {
  maxPerSecond: 10,
  strategy: 'wait',  // Requests wait their turn
});

// Process 1000 items - takes ~100 seconds but all succeed
for (const item of items) {
  await limiter.execute(() => processItem(item));
}
```

### When to Use 'reject'

Best for:
- Real-time user requests
- When fast failure is better than waiting
- When you have fallbacks

```typescript
const limiter = createRateLimiter('realtime-api', {
  maxPerSecond: 100,
  strategy: 'reject',  // Fail fast
});

// User request - don't make them wait
try {
  return await limiter.execute(() => fetchFreshData());
} catch (error) {
  if (isRateLimitExceededError(error)) {
    return getCachedData();  // Serve stale data instead
  }
  throw error;
}
```

## Presets

```typescript
import { createRateLimiter, createConcurrencyLimiter, rateLimiterPresets } from 'awaitly/ratelimit';

// Standard API (10 req/s)
const apiLimiter = createRateLimiter('api', rateLimiterPresets.api);
// { maxPerSecond: 10, burstCapacity: 20, strategy: 'wait' }

// External/third-party API (5 req/s)
const externalLimiter = createRateLimiter('external', rateLimiterPresets.external);
// { maxPerSecond: 5, burstCapacity: 10, strategy: 'wait' }

// Database connection pool
const dbLimiter = createConcurrencyLimiter('db', rateLimiterPresets.database);
// { maxConcurrent: 10, strategy: 'queue', maxQueueSize: 100 }
```

## Integration with Workflows

### Basic Integration

```typescript
import { createWorkflow } from 'awaitly';
import { createRateLimiter } from 'awaitly/ratelimit';

const apiLimiter = createRateLimiter('external-api', { maxPerSecond: 10 });

const workflow = createWorkflow({ fetchUser, sendEmail });

const result = await workflow(async (step) => {
  // Rate-limit external API calls
  const user = await apiLimiter.execute(() =>
    step(() => fetchUser(userId), { name: 'fetch-user' })
  );

  await step(() => sendEmail(user.email), { name: 'send-email' });

  return user;
});
```

### Parallel with Concurrency Control

```typescript
import { createConcurrencyLimiter } from 'awaitly/ratelimit';

const dbLimiter = createConcurrencyLimiter('database', { maxConcurrent: 10 });

const result = await workflow(async (step) => {
  // Fetch multiple items with controlled concurrency
  const items = await dbLimiter.executeAll(
    itemIds.map(id => () =>
      step(() => fetchItem(id), { key: `item:${id}` })
    )
  );

  return items;
});
```

### Multiple Rate Limiters

```typescript
const userApiLimiter = createRateLimiter('user-api', { maxPerSecond: 50 });
const paymentApiLimiter = createRateLimiter('payment-api', { maxPerSecond: 10 });
const emailLimiter = createRateLimiter('email', { maxPerSecond: 5 });

const result = await checkout(async (step) => {
  const user = await userApiLimiter.execute(() =>
    step(() => fetchUser(userId))
  );

  const payment = await paymentApiLimiter.execute(() =>
    step(() => chargeCard(user, amount))
  );

  await emailLimiter.execute(() =>
    step(() => sendReceipt(user.email, payment))
  );

  return { user, payment };
});
```

### With Circuit Breaker

Combine rate limiting with circuit breakers for complete resilience:

```typescript
import { createRateLimiter } from 'awaitly/ratelimit';
import { createCircuitBreaker } from 'awaitly/circuit-breaker';

const rateLimiter = createRateLimiter('api', { maxPerSecond: 10 });
const circuitBreaker = createCircuitBreaker('api', { failureThreshold: 5 });

async function callApiSafely<T>(operation: () => Promise<T>): Promise<T> {
  // Rate limit first, then circuit break
  return rateLimiter.execute(() =>
    circuitBreaker.execute(operation)
  );
}

const result = await workflow(async (step) => {
  const data = await callApiSafely(() =>
    step(() => fetchExternalData())
  );
  return data;
});
```

## API Reference

### Types

```typescript
interface RateLimiterConfig {
  maxPerSecond: number;
  burstCapacity?: number;
  strategy?: 'wait' | 'reject';
}

interface ConcurrencyLimiterConfig {
  maxConcurrent: number;
  strategy?: 'queue' | 'reject';
  maxQueueSize?: number;
}

interface RateLimiterStats {
  availableTokens: number;
  maxTokens: number;
  tokensPerSecond: number;
  waitingCount: number;
}

interface ConcurrencyLimiterStats {
  activeCount: number;
  maxConcurrent: number;
  queueSize: number;
  maxQueueSize: number;
}

interface RateLimitExceededError {
  type: 'RATE_LIMIT_EXCEEDED';
  limiterName: string;
  retryAfterMs?: number;
}

interface QueueFullError {
  type: 'QUEUE_FULL';
  limiterName: string;
  queueSize: number;
  maxQueueSize: number;
}
```

### Functions

| Function | Description |
|----------|-------------|
| `createRateLimiter(name, config)` | Create a token bucket rate limiter |
| `createConcurrencyLimiter(name, config)` | Create a concurrency limiter |
| `createCombinedLimiter(name, config)` | Create rate + concurrency limiter |
| `isRateLimitExceededError(error)` | Type guard for rate limit errors |
| `isQueueFullError(error)` | Type guard for queue full errors |

### RateLimiter Methods

| Method | Description |
|--------|-------------|
| `execute(fn)` | Execute with rate limiting |
| `executeResult(fn)` | Execute with rate limiting (Result) |
| `getStats()` | Get current statistics |
| `reset()` | Reset the rate limiter |

### ConcurrencyLimiter Methods

| Method | Description |
|--------|-------------|
| `execute(fn)` | Execute with concurrency control |
| `executeAll(fns)` | Execute batch with concurrency control |
| `executeResult(fn)` | Execute with concurrency control (Result) |
| `getStats()` | Get current statistics |
| `reset()` | Reset the limiter (rejects queued) |

### Presets

| Preset | Type | Config |
|--------|------|--------|
| `rateLimiterPresets.api` | Rate | 10 req/s, burst 20 |
| `rateLimiterPresets.external` | Rate | 5 req/s, burst 10 |
| `rateLimiterPresets.database` | Concurrency | 10 concurrent, queue 100 |
