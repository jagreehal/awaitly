# Schedule

Composable scheduling primitives for retry and polling strategies. Build complex schedules by combining simple building blocks.

## The Problem: Hard-Coded Retry Logic

Retry strategies end up scattered and inflexible:

```typescript
// ❌ Hard-coded, not reusable
async function fetchWithRetry(url: string) {
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(url);
    } catch {
      await sleep(100 * Math.pow(2, i)); // Exponential backoff
    }
  }
  throw new Error('Failed after 3 attempts');
}
```

When you need different strategies for different operations, you copy-paste and tweak.

## The Solution: Composable Schedules

Define scheduling strategies as composable values:

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// ✓ Composable, reusable
const retryStrategy = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.jittered(0.2))
  .pipe(Schedule.upTo(5))
  .pipe(Schedule.andThen(Schedule.spaced(Duration.minutes(1))));

// Use with step.retry or other retry utilities
```

## Base Schedules

### Forever & Recurs

```typescript
import { Schedule } from 'awaitly/retry';

Schedule.forever()    // Repeats indefinitely with no delay
Schedule.recurs(5)    // Repeats exactly 5 times
Schedule.once()       // Repeats exactly once
Schedule.stop()       // Never runs (immediately done)
```

### Delay-Based Schedules

```typescript
import { Schedule, Duration } from 'awaitly/retry';

Schedule.spaced(Duration.seconds(1))           // Fixed 1s interval
Schedule.exponential(Duration.millis(100))     // 100ms, 200ms, 400ms, 800ms...
Schedule.exponential(Duration.millis(100), 3)  // Custom factor: 100ms, 300ms, 900ms...
Schedule.linear(Duration.millis(100))          // 100ms, 200ms, 300ms, 400ms...
Schedule.fibonacci(Duration.millis(100))       // 100ms, 100ms, 200ms, 300ms, 500ms...
```

## Combinators

### Limits

```typescript
// Limit by count
const limited = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.upTo(5));  // Max 5 iterations

// Limit by elapsed time
const timeLimited = Schedule.spaced(Duration.seconds(1))
  .pipe(Schedule.upToElapsed(Duration.minutes(5)));  // Stop after 5 minutes

// Cap delays
const capped = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.maxDelay(Duration.seconds(30)))  // Never exceed 30s
  .pipe(Schedule.minDelay(Duration.millis(50)));  // Never below 50ms
```

### Jitter

```typescript
// Add randomness to prevent thundering herd
const jittered = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.jittered(0.2));  // ±20% random variation
```

## Composition Combinators

### `andThen` - Sequential Composition

Chain two schedules: run the first until done, then run the second.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// 5 fast retries, then switch to slow polling
const strategy = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.upTo(5))
  .pipe(Schedule.andThen(Schedule.spaced(Duration.minutes(1))));

// Run the schedule
const runner = Schedule.run(strategy);
runner.next(undefined);  // 100ms (exponential phase)
runner.next(undefined);  // 200ms
runner.next(undefined);  // 400ms
runner.next(undefined);  // 800ms
runner.next(undefined);  // 1600ms (last of 5)
runner.next(undefined);  // 60000ms (switched to spaced)
runner.next(undefined);  // 60000ms (continues forever)
```

**Key Feature: Reusability**

Schedules are reusable - each `run()` call starts fresh:

```typescript
const schedule = Schedule.recurs(2)
  .pipe(Schedule.andThen(Schedule.recurs(2)));

// First run
const delays1 = Schedule.delays(schedule, 10);  // [0ms, 0ms, 0ms, 0ms]

// Second run on SAME instance - works correctly
const delays2 = Schedule.delays(schedule, 10);  // [0ms, 0ms, 0ms, 0ms]
```

**Composability**

`andThen` works with any schedule, including nested compositions:

```typescript
// union → andThen
const strategy1 = Schedule.union(
  Schedule.recurs(2),
  Schedule.recurs(3)
).pipe(Schedule.andThen(Schedule.recurs(1)));

// andThen → andThen (triple chain)
const strategy2 = Schedule.recurs(1)
  .pipe(Schedule.andThen(Schedule.recurs(1)))
  .pipe(Schedule.andThen(Schedule.recurs(1)));
```

### `union` - Parallel with Shorter Delay

Run two schedules in parallel, taking the shorter delay at each step. Continues while either schedule continues.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// Use whichever delay is shorter
const aggressive = Schedule.union(
  Schedule.exponential(Duration.millis(100)),  // Fast start
  Schedule.spaced(Duration.seconds(1))         // Steady fallback
);

const runner = Schedule.run(aggressive);
runner.next(undefined);  // { delay: 100ms, output: [0, 0] }
runner.next(undefined);  // { delay: 200ms, output: [1, 1] }
runner.next(undefined);  // { delay: 400ms, output: [2, 2] }
runner.next(undefined);  // { delay: 800ms, output: [3, 3] }
runner.next(undefined);  // { delay: 1000ms, output: [4, 4] } // spaced wins
```

**Use Case: Adaptive Backoff**

```typescript
// Start aggressive, fall back to steady polling
const adaptiveRetry = Schedule.union(
  Schedule.exponential(Duration.millis(50)).pipe(Schedule.upTo(3)),  // Fast initial
  Schedule.spaced(Duration.seconds(5))  // Steady fallback
);
```

### `intersect` - Parallel with Longer Delay

Run two schedules in parallel, taking the longer delay at each step. Stops when either schedule stops.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// Use whichever delay is longer (more conservative)
const conservative = Schedule.intersect(
  Schedule.exponential(Duration.millis(100)),
  Schedule.spaced(Duration.seconds(1))
);

const runner = Schedule.run(conservative);
runner.next(undefined);  // { delay: 1000ms, output: [0, 0] }  // spaced wins
runner.next(undefined);  // { delay: 1000ms, output: [1, 1] }
```

**Use Case: Rate Limiting**

```typescript
// Never faster than 1 request per second, but back off on failures
const rateLimited = Schedule.intersect(
  Schedule.spaced(Duration.seconds(1)),           // Minimum 1s between requests
  Schedule.exponential(Duration.millis(100))      // Back off on repeated failures
);
```

### Nested Composition

All combinators compose freely:

```typescript
// union(andThen(...), andThen(...))
const complex = Schedule.union(
  Schedule.recurs(1).pipe(Schedule.andThen(Schedule.recurs(1))),
  Schedule.recurs(2).pipe(Schedule.andThen(Schedule.recurs(1)))
);

// intersect(andThen(...), recurs)
const nested = Schedule.intersect(
  Schedule.recurs(2).pipe(Schedule.andThen(Schedule.recurs(2))),
  Schedule.recurs(5)
);

// andThen(union(...), union(...))
const chained = Schedule.union(Schedule.recurs(1), Schedule.recurs(1))
  .pipe(Schedule.andThen(Schedule.union(Schedule.recurs(1), Schedule.recurs(1))));
```

## Running Schedules

### `Schedule.run` - Step-by-Step Iterator

```typescript
const schedule = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.upTo(3));

const runner = Schedule.run(schedule);

const step1 = runner.next(undefined);
// { done: false, value: { delay: Duration(100ms), output: 0 } }

const step2 = runner.next(undefined);
// { done: false, value: { delay: Duration(200ms), output: 1 } }

const step3 = runner.next(undefined);
// { done: false, value: { delay: Duration(400ms), output: 2 } }

const step4 = runner.next(undefined);
// { done: true }
```

### `Schedule.delays` - Get All Delays (Testing)

```typescript
const schedule = Schedule.fibonacci(Duration.millis(100))
  .pipe(Schedule.upTo(5));

const delays = Schedule.delays(schedule);
// [100ms, 100ms, 200ms, 300ms, 500ms]
```

## Transformations

### `map` - Transform Output

```typescript
const withAttemptNumber = Schedule.recurs(3)
  .pipe(Schedule.map((n) => ({ attempt: n + 1 })));

const runner = Schedule.run(withAttemptNumber);
runner.next(undefined);  // { output: { attempt: 1 } }
runner.next(undefined);  // { output: { attempt: 2 } }
```

### `tap` - Side Effects

```typescript
const withLogging = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.tap((iteration) => console.log(`Attempt ${iteration + 1}`)));
```

### `modifyDelay` - Transform Delays

```typescript
const doubled = Schedule.spaced(Duration.seconds(1))
  .pipe(Schedule.modifyDelay((d) => Duration.multiply(d, 2)));
```

## Real-World Scenarios

### Database Connection Pool: Health Check and Reconnect

Your app loses database connectivity occasionally. You want aggressive reconnection attempts initially, then back off to avoid hammering a potentially overloaded server.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// Quick retries for blips, then slower checks to let the DB recover
const dbReconnect = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.upTo(5))                     // 5 quick attempts: 100, 200, 400, 800, 1600ms
  .pipe(Schedule.andThen(
    Schedule.spaced(Duration.seconds(10))     // Then check every 10s
      .pipe(Schedule.upTo(30))                // Give up after 5 minutes
  ));
```

Why this works: Most connection drops are brief (network hiccup, connection pool exhaustion). Fast retries catch these. If the problem persists, slower retries prevent your app from contributing to the overload.

### Email Service: Handle Transient Failures

Your email provider has rate limits and occasional 429s. You need to respect limits while still retrying transient failures.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// Never faster than rate limit, but back off on repeated failures
const emailRetry = Schedule.intersect(
  Schedule.spaced(Duration.millis(200)),           // Rate limit: 5 emails/second
  Schedule.exponential(Duration.millis(100))       // Back off: 100, 200, 400...
    .pipe(Schedule.maxDelay(Duration.seconds(60))) // Cap at 1 minute
).pipe(Schedule.upTo(10));                         // Max 10 attempts
```

Why `intersect`: Takes the *longer* delay, so you never exceed rate limits even when backing off rapidly. The exponential only kicks in once it exceeds the rate limit baseline.

### Webhook Delivery: Escalating Retry with Deadline

You're sending webhooks to customer endpoints. Some endpoints are slow or unreliable. You want quick retries for transient issues, slower retries for persistent issues, but a hard deadline.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// Three phases: immediate, patient, very patient
const webhookDelivery = Schedule.exponential(Duration.seconds(1))
  .pipe(Schedule.upTo(3))                          // Phase 1: 1s, 2s, 4s
  .pipe(Schedule.andThen(
    Schedule.spaced(Duration.minutes(5))
      .pipe(Schedule.upTo(6))                      // Phase 2: every 5min for 30min
  ))
  .pipe(Schedule.andThen(
    Schedule.spaced(Duration.hours(1))
      .pipe(Schedule.upTo(24))                     // Phase 3: hourly for 24h
  ));
```

Why three phases: Fast retries catch brief outages. Medium retries handle maintenance windows. Slow retries give endpoints 24 hours to come back online before you mark the delivery as failed.

### Background Job Processing: Throttled with Backpressure

You're processing jobs from a queue. You want steady throughput, but if jobs start failing, slow down to avoid overwhelming downstream services.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// Steady pace normally, but back off when things go wrong
const jobProcessing = Schedule.union(
  Schedule.spaced(Duration.millis(100)),           // Normal: 10 jobs/second
  Schedule.exponential(Duration.millis(50))        // Failure: back off quickly
    .pipe(Schedule.maxDelay(Duration.seconds(5))) // But never more than 5s
).pipe(Schedule.jittered(0.1));                    // Add jitter to prevent thundering herd
```

Why `union`: Takes the *shorter* delay. When healthy, processes at steady 100ms. When failing, exponential grows but union caps effective delay at 100ms until failures compound enough to exceed that baseline.

## Real-World Patterns

### Checkout Retries You Can Explain to a PM

Your payment provider flakes 1-2% of the time. You want a few fast retries to catch brief blips, then slow down so you don't hammer the gateway.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

// Fast retries for transient blips, then slower follow-ups
const paymentRetry = Schedule.exponential(Duration.millis(200))
  .pipe(Schedule.upTo(4))                    // 4 quick attempts
  .pipe(Schedule.andThen(
    Schedule.spaced(Duration.seconds(30))   // Then check every 30s
      .pipe(Schedule.upTo(6))               // Give up after 3 minutes
  ));
```

### Shipment Tracking: "Check Every 5 Minutes, Stop After a Day"

Your operations team wants predictable polling that doesn't run forever.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

const trackShipment = Schedule.spaced(Duration.minutes(5))
  .pipe(Schedule.upToElapsed(Duration.hours(24)));
```

### Public API Safety: Respect Rate Limits While Backing Off

If you get throttled, back off, but never exceed the platform's baseline rate limit.

```typescript
import { Schedule, Duration } from 'awaitly/retry';

const safeApiCalls = Schedule.intersect(
  Schedule.spaced(Duration.seconds(1)),        // Never faster than 1 req/s
  Schedule.exponential(Duration.millis(200))   // Back off on failures
    .pipe(Schedule.maxDelay(Duration.seconds(30)))
);
```

### Exponential Backoff with Jitter and Cap

```typescript
const httpRetry = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.jittered(0.2))           // Add randomness
  .pipe(Schedule.maxDelay(Duration.seconds(30)))  // Cap at 30s
  .pipe(Schedule.upTo(5));                // Max 5 attempts
```

### Two-Phase Retry Strategy

```typescript
// Aggressive retries first, then patient polling
const twoPhase = Schedule.exponential(Duration.millis(50))
  .pipe(Schedule.upTo(3))
  .pipe(Schedule.andThen(
    Schedule.spaced(Duration.minutes(1)).pipe(Schedule.upTo(10))
  ));
```

### Adaptive Rate Limiting

```typescript
// Take the more conservative delay between rate limit and backoff
const adaptive = Schedule.intersect(
  Schedule.spaced(Duration.millis(100)),      // Rate limit: 10 req/s
  Schedule.exponential(Duration.millis(50))   // Back off on failures
).pipe(Schedule.upTo(10));
```

### Aggressive Retry with Fallback

```typescript
// Take the shorter delay between exponential and fixed ceiling
const aggressive = Schedule.union(
  Schedule.exponential(Duration.millis(100)),
  Schedule.spaced(Duration.seconds(5))       // Never wait more than 5s
).pipe(Schedule.upTo(10));
```

## Summary

| Function | Purpose |
| -------- | ------- |
| `Schedule.forever()` | Repeat indefinitely |
| `Schedule.recurs(n)` | Repeat exactly n times |
| `Schedule.spaced(d)` | Fixed delay interval |
| `Schedule.exponential(d)` | Exponential backoff |
| `Schedule.andThen(s)` | Sequential: first → second |
| `Schedule.union(a, b)` | Parallel: shorter delay, either continues |
| `Schedule.intersect(a, b)` | Parallel: longer delay, both must continue |
| `Schedule.upTo(n)` | Limit iterations |
| `Schedule.maxDelay(d)` | Cap maximum delay |
| `Schedule.jittered(f)` | Add random variation |
| `Schedule.run(s)` | Create iterator |
| `Schedule.delays(s)` | Get all delays (testing) |

**The key insight:** Build complex retry strategies by composing simple primitives. Schedules are reusable and safe to run multiple times.
