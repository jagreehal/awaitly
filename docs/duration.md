# Duration

Type-safe duration handling that prevents unit confusion. Instead of passing raw milliseconds everywhere (is `5000` milliseconds or seconds?), use explicit constructors like `Duration.seconds(5)`.

## Table of Contents

- [The Problem](#the-problem)
- [Basic Usage](#basic-usage)
- [Constructors](#constructors)
- [Conversions](#conversions)
- [Operations](#operations)
- [Comparisons](#comparisons)
- [Predicates](#predicates)
- [Formatting & Parsing](#formatting--parsing)
- [Integration with Workflows](#integration-with-workflows)
- [API Reference](#api-reference)

## The Problem

Raw milliseconds are error-prone:

```typescript
// Is this 5 seconds or 5000 seconds?
const timeout = 5000;

// Easy to make mistakes
setTimeout(callback, 60);  // Oops, 60ms not 60 seconds!

// Unit confusion in APIs
await retryWithBackoff(operation, { delay: 1000, maxDelay: 30 });  // Mixed units!
```

## Basic Usage

```typescript
import { Duration } from 'awaitly';

// Create durations with explicit units
const timeout = Duration.seconds(30);
const retryDelay = Duration.millis(500);
const sessionExpiry = Duration.hours(2);

// Convert when needed
const ms = Duration.toMillis(timeout);  // 30000

// Format for logging
console.log(Duration.format(sessionExpiry));  // "2h"

// Parse from strings
const parsed = Duration.parse("5s");  // Duration.seconds(5)
```

## Constructors

Create durations with explicit time units:

```typescript
import { Duration } from 'awaitly';

// Milliseconds (base unit)
const fast = Duration.millis(100);

// Seconds
const timeout = Duration.seconds(30);

// Minutes
const sessionTimeout = Duration.minutes(15);

// Hours
const cacheExpiry = Duration.hours(24);

// Days
const trialPeriod = Duration.days(14);

// Special values
const none = Duration.zero;       // 0ms
const forever = Duration.infinity; // Infinite duration
```

You can also import individual constructors for tree-shaking:

```typescript
import { seconds, minutes, hours } from 'awaitly/duration';

const timeout = seconds(30);
const session = minutes(15);
```

## Conversions

Convert durations to numeric values:

```typescript
import { Duration } from 'awaitly';

const d = Duration.minutes(2);

Duration.toMillis(d);   // 120000
Duration.toSeconds(d);  // 120
Duration.toMinutes(d);  // 2
Duration.toHours(d);    // 0.0333...
Duration.toDays(d);     // 0.00138...
```

## Operations

Perform arithmetic on durations:

```typescript
import { Duration } from 'awaitly';

const a = Duration.seconds(30);
const b = Duration.seconds(15);

// Addition
const total = Duration.add(a, b);  // 45 seconds

// Subtraction (clamped to zero)
const diff = Duration.subtract(a, b);  // 15 seconds
const noNegative = Duration.subtract(b, a);  // 0 (not -15)

// Multiplication
const doubled = Duration.multiply(a, 2);  // 60 seconds

// Division
const half = Duration.divide(a, 2);  // 15 seconds
```

### Backoff Example

```typescript
import { Duration } from 'awaitly';

function exponentialBackoff(attempt: number, baseDelay: Duration): Duration {
  const factor = Math.pow(2, attempt);
  return Duration.multiply(baseDelay, factor);
}

const base = Duration.millis(100);
console.log(Duration.format(exponentialBackoff(0, base)));  // "100ms"
console.log(Duration.format(exponentialBackoff(1, base)));  // "200ms"
console.log(Duration.format(exponentialBackoff(2, base)));  // "400ms"
console.log(Duration.format(exponentialBackoff(3, base)));  // "800ms"
```

## Comparisons

Compare durations safely:

```typescript
import { Duration } from 'awaitly';

const short = Duration.seconds(5);
const long = Duration.minutes(1);

Duration.lessThan(short, long);         // true
Duration.lessThanOrEqual(short, long);  // true
Duration.greaterThan(short, long);      // false
Duration.greaterThanOrEqual(short, long); // false
Duration.equals(short, long);           // false

// Min/Max
Duration.min(short, long);  // short (5 seconds)
Duration.max(short, long);  // long (1 minute)

// Clamp between bounds
const value = Duration.seconds(45);
const minimum = Duration.seconds(10);
const maximum = Duration.seconds(30);
Duration.clamp(value, minimum, maximum);  // 30 seconds (clamped to max)
```

## Predicates

Check duration properties:

```typescript
import { Duration, isDuration } from 'awaitly';

const d = Duration.seconds(5);

Duration.isZero(Duration.zero);      // true
Duration.isZero(d);                  // false

Duration.isInfinite(Duration.infinity);  // true
Duration.isInfinite(d);                  // false

Duration.isFinite(d);                // true (finite and positive)
Duration.isFinite(Duration.zero);    // false (zero is not positive)

// Type guard
isDuration(d);                       // true
isDuration({ millis: 1000 });        // false (missing _tag)
isDuration("5s");                    // false
```

## Formatting & Parsing

### Formatting

Convert durations to human-readable strings:

```typescript
import { Duration } from 'awaitly';

Duration.format(Duration.millis(500));     // "500ms"
Duration.format(Duration.seconds(90));     // "1m 30s"
Duration.format(Duration.minutes(150));    // "2h 30m"
Duration.format(Duration.hours(36));       // "1d 12h"
Duration.format(Duration.zero);            // "0ms"
Duration.format(Duration.infinity);        // "∞"
```

### Parsing

Parse durations from strings:

```typescript
import { Duration } from 'awaitly';

Duration.parse("100ms");  // Duration.millis(100)
Duration.parse("5s");     // Duration.seconds(5)
Duration.parse("2m");     // Duration.minutes(2)
Duration.parse("1h");     // Duration.hours(1)
Duration.parse("7d");     // Duration.days(7)

// Invalid strings return undefined
Duration.parse("invalid");  // undefined
Duration.parse("5");        // undefined (no unit)
```

## Integration with Workflows

Use Duration with workflow timeouts and retries:

```typescript
import { createWorkflow, Duration } from 'awaitly';

const workflow = createWorkflow({ fetchUser, saveUser });

const result = await workflow(async (step) => {
  // Use Duration for timeouts
  const user = await step.withTimeout(
    () => fetchUser(id),
    { ms: Duration.toMillis(Duration.seconds(5)) }
  );

  // Use Duration for retry backoff
  const saved = await step.retry(
    () => saveUser(user),
    {
      attempts: 3,
      backoff: 'exponential',
      initialDelay: Duration.toMillis(Duration.millis(100)),
      maxDelay: Duration.toMillis(Duration.seconds(5)),
    }
  );

  return saved;
});
```

### With Rate Limiting

```typescript
import { createRateLimiter, Duration } from 'awaitly';

const limiter = createRateLimiter('api', {
  maxPerSecond: 10,
  burstCapacity: 20,
});

// Calculate time until next slot
const stats = limiter.getStats();
if (stats.waitingCount > 0) {
  const estimatedWait = Duration.millis(stats.waitingCount * 100);
  console.log(`Estimated wait: ${Duration.format(estimatedWait)}`);
}
```

### With Circuit Breaker

```typescript
import { createCircuitBreaker, Duration } from 'awaitly';

const breaker = createCircuitBreaker('external-api', {
  failureThreshold: 5,
  resetTimeout: Duration.toMillis(Duration.seconds(30)),
  windowSize: Duration.toMillis(Duration.minutes(1)),
});
```

## API Reference

### Type

```typescript
interface Duration {
  readonly _tag: "Duration";
  readonly millis: number;
}
```

### Constructors

| Function | Description | Example |
|----------|-------------|---------|
| `millis(ms)` | Create from milliseconds | `Duration.millis(500)` |
| `seconds(s)` | Create from seconds | `Duration.seconds(30)` |
| `minutes(m)` | Create from minutes | `Duration.minutes(5)` |
| `hours(h)` | Create from hours | `Duration.hours(2)` |
| `days(d)` | Create from days | `Duration.days(7)` |
| `zero` | Zero duration constant | `Duration.zero` |
| `infinity` | Infinite duration constant | `Duration.infinity` |

### Conversions

| Function | Description |
|----------|-------------|
| `toMillis(d)` | Convert to milliseconds |
| `toSeconds(d)` | Convert to seconds |
| `toMinutes(d)` | Convert to minutes |
| `toHours(d)` | Convert to hours |
| `toDays(d)` | Convert to days |

### Operations

| Function | Description |
|----------|-------------|
| `add(a, b)` | Add two durations |
| `subtract(a, b)` | Subtract b from a (clamped to 0) |
| `multiply(d, factor)` | Multiply by a factor |
| `divide(d, divisor)` | Divide by a divisor |

### Comparisons

| Function | Description |
|----------|-------------|
| `lessThan(a, b)` | a < b |
| `lessThanOrEqual(a, b)` | a <= b |
| `greaterThan(a, b)` | a > b |
| `greaterThanOrEqual(a, b)` | a >= b |
| `equals(a, b)` | a === b |
| `min(a, b)` | Smaller duration |
| `max(a, b)` | Larger duration |
| `clamp(d, min, max)` | Clamp between bounds |

### Predicates

| Function | Description |
|----------|-------------|
| `isZero(d)` | Check if zero |
| `isInfinite(d)` | Check if infinite |
| `isFinite(d)` | Check if finite and positive |
| `isDuration(value)` | Type guard |

### Formatting

| Function | Description |
|----------|-------------|
| `format(d)` | Human-readable string ("1m 30s") |
| `parse(str)` | Parse from string ("5s" → Duration) |
