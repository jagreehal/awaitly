---
title: Circuit Breaker
description: Prevent cascading failures with failure tracking
---

Prevent cascading failures by tracking step failure rates and short-circuiting calls when a threshold is exceeded.

## Basic usage

```typescript
import { ok } from 'awaitly';
import {
  createCircuitBreaker,
  isCircuitOpenError,
  circuitBreakerPresets,
} from 'awaitly/circuit-breaker';

// Create a circuit breaker (name is required)
const breaker = createCircuitBreaker('external-api', {
  failureThreshold: 5,      // Open after 5 failures
  resetTimeout: 30000,      // Try again after 30 seconds
  halfOpenMax: 3,           // Allow 3 test requests in half-open state
  windowSize: 60000,        // Count failures within this window (1 minute)
});

// Execute with the breaker
try {
  const data = await breaker.execute(async () => {
    return await fetchFromExternalApi();
  });
  console.log('Got data:', data);
} catch (error) {
  if (isCircuitOpenError(error)) {
    console.log(`Circuit is open, retry after ${error.retryAfterMs}ms`);
  } else {
    console.log('Operation failed:', error);
  }
}
```

## Using presets

```typescript
import { createCircuitBreaker, circuitBreakerPresets } from 'awaitly/circuit-breaker';

// For critical services - opens quickly, recovers slowly
const criticalBreaker = createCircuitBreaker(
  'payment-api',
  circuitBreakerPresets.critical
);

// For lenient services - tolerates more failures
const lenientBreaker = createCircuitBreaker(
  'recommendation-api',
  circuitBreakerPresets.lenient
);
```

## Result-returning operations

Use `executeResult` instead of `execute` if your operation returns a `Result`:

```typescript
const result = await breaker.executeResult(async () => {
  return ok(await fetchFromExternalApi());
});

if (!result.ok) {
  if (isCircuitOpenError(result.error)) {
    console.log('Circuit is open, try again later');
  }
}
```

## Circuit states

The circuit breaker has three states:

| State | Description |
|-------|-------------|
| `CLOSED` | Normal operation. Failures are tracked. |
| `OPEN` | Circuit tripped. All calls fail immediately. |
| `HALF_OPEN` | Testing recovery. Limited calls allowed. |

```typescript
const stats = breaker.getStats();
console.log(stats.state);          // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
console.log(stats.failureCount);   // Failures in current window
console.log(stats.successCount);   // Successes in current window
console.log(stats.halfOpenSuccesses); // Successful test calls
```

## State transitions

```
CLOSED → OPEN: When failureThreshold is reached
OPEN → HALF_OPEN: After resetTimeout elapses
HALF_OPEN → CLOSED: After halfOpenMax successes
HALF_OPEN → OPEN: On any failure
```

## In workflows

```typescript
const breaker = createCircuitBreaker('api', circuitBreakerPresets.standard);

const result = await workflow(async (step) => {
  const data = await step(async () => {
    const apiResult = await breaker.executeResult(() =>
      ok(await externalApi.fetch())
    );
    return apiResult;
  });

  return data;
});
```

## Multiple services

Create separate breakers for independent failure domains:

```typescript
const paymentBreaker = createCircuitBreaker('payment', {
  failureThreshold: 3,
  resetTimeout: 60000, // Conservative for payments
});

const inventoryBreaker = createCircuitBreaker('inventory', {
  failureThreshold: 10,
  resetTimeout: 10000, // Can recover faster
});

const emailBreaker = createCircuitBreaker('email', {
  failureThreshold: 20,
  resetTimeout: 5000, // Non-critical, aggressive recovery
});
```

## Configuration reference

```typescript
{
  failureThreshold: number;  // Failures before opening (required)
  resetTimeout: number;      // Ms before half-open (required)
  halfOpenMax?: number;      // Test calls allowed (default: 1)
  windowSize?: number;       // Failure counting window (default: 60000)
}
```
