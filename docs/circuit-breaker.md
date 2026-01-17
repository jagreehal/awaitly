# Circuit Breaker

Prevent cascading failures by automatically detecting when an external service is failing and short-circuiting calls to it. The circuit breaker pattern protects your system from repeatedly calling a failing service, giving it time to recover.

## Table of Contents

- [The Problem](#the-problem)
- [How It Works](#how-it-works)
- [Basic Usage](#basic-usage)
- [Configuration](#configuration)
- [Presets](#presets)
- [Methods](#methods)
- [Handling Circuit Open](#handling-circuit-open)
- [State Change Callbacks](#state-change-callbacks)
- [Integration with Workflows](#integration-with-workflows)
- [Monitoring & Observability](#monitoring--observability)
- [API Reference](#api-reference)

## The Problem

When an external service fails, naive retry logic makes things worse:

```typescript
// Without circuit breaker - keeps hammering a failing service
async function callApi(id: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fetch(`https://api.example.com/users/${id}`);
    } catch (e) {
      // Keeps trying even if the service is completely down
      // Wastes resources, adds latency, may overload the recovering service
      await sleep(1000);
    }
  }
  throw new Error('Service unavailable');
}
```

Problems:
- **Wasted resources**: Keeps making requests that will fail
- **Cascading failures**: Slow responses back up your entire system
- **Delayed recovery**: Flood of retries when service comes back up
- **Poor user experience**: Users wait for timeouts instead of getting fast failures

## How It Works

The circuit breaker has three states:

```
       Success
    ┌───────────┐
    │           ▼
┌───────┐   ┌───────────┐   Failures exceed    ┌────────┐
│CLOSED │───│ HALF_OPEN │◄──────threshold──────│  OPEN  │
└───────┘   └───────────┘                      └────────┘
    ▲           │                                  │
    │           │ Test request fails               │
    │           └──────────────────────────────────┘
    │                                              │
    └──────────Reset timeout expires───────────────┘
```

1. **CLOSED** (normal): Requests flow through. Failures are counted.
2. **OPEN** (blocking): Requests fail immediately. No calls to the service.
3. **HALF_OPEN** (testing): Limited test requests allowed to check if service recovered.

## Basic Usage

```typescript
import { createCircuitBreaker, isCircuitOpenError } from 'awaitly/circuit-breaker';

// Create a circuit breaker for an external API
const apiBreaker = createCircuitBreaker('external-api', {
  failureThreshold: 5,    // Open after 5 failures
  resetTimeout: 30000,    // Try again after 30 seconds
  halfOpenMax: 3,         // Allow 3 test requests in half-open
});

// Execute operations through the circuit breaker
try {
  const data = await apiBreaker.execute(async () => {
    return await fetch('https://api.example.com/data');
  });
  console.log('Success:', data);
} catch (error) {
  if (isCircuitOpenError(error)) {
    // Circuit is open - fail fast
    console.log(`Service unavailable. Retry after ${error.retryAfterMs}ms`);
  } else {
    // Actual operation error
    console.log('Operation failed:', error);
  }
}
```

### With Result Types

Use `executeResult` for Result-based workflows:

```typescript
import { createCircuitBreaker, isCircuitOpenError } from 'awaitly/circuit-breaker';
import { ok, err } from 'awaitly';

const breaker = createCircuitBreaker('user-service', {
  failureThreshold: 5,
  resetTimeout: 30000,
});

const result = await breaker.executeResult(async () => {
  const user = await fetchUser(id);
  return user ? ok(user) : err('NOT_FOUND' as const);
});

if (!result.ok) {
  if (isCircuitOpenError(result.error)) {
    // Circuit is open
    return err('SERVICE_UNAVAILABLE' as const);
  }
  // Handle NOT_FOUND error
  return result;
}
```

## Configuration

```typescript
interface CircuitBreakerConfig {
  // Number of failures within the window before opening the circuit
  // Default: 5
  failureThreshold: number;

  // Time in ms to wait before transitioning from OPEN to HALF_OPEN
  // Default: 30000 (30 seconds)
  resetTimeout: number;

  // Time window in ms for counting failures (older failures are discarded)
  // Default: 60000 (1 minute)
  windowSize: number;

  // Max test requests allowed in HALF_OPEN state
  // If all succeed, circuit closes. If any fail, circuit reopens.
  // Default: 3
  halfOpenMax: number;

  // Optional callback when circuit state changes
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}
```

### Configuration Examples

**Aggressive (critical paths)**:
```typescript
const criticalBreaker = createCircuitBreaker('payment-gateway', {
  failureThreshold: 3,     // Open quickly
  resetTimeout: 60000,     // Recover slowly (1 minute)
  windowSize: 30000,       // Short window (30 seconds)
  halfOpenMax: 1,          // Single test request
});
```

**Lenient (non-critical)**:
```typescript
const analyticsBreaker = createCircuitBreaker('analytics-service', {
  failureThreshold: 10,    // Tolerate more failures
  resetTimeout: 15000,     // Recover quickly (15 seconds)
  windowSize: 120000,      // Longer window (2 minutes)
  halfOpenMax: 5,          // More test requests
});
```

## Presets

Use built-in presets for common scenarios:

```typescript
import { createCircuitBreaker, circuitBreakerPresets } from 'awaitly/circuit-breaker';

// Critical services (payments, auth)
const paymentBreaker = createCircuitBreaker('payments', circuitBreakerPresets.critical);
// { failureThreshold: 3, resetTimeout: 60000, windowSize: 30000, halfOpenMax: 1 }

// Standard APIs
const apiBreaker = createCircuitBreaker('api', circuitBreakerPresets.standard);
// { failureThreshold: 5, resetTimeout: 30000, windowSize: 60000, halfOpenMax: 3 }

// Non-critical services
const loggingBreaker = createCircuitBreaker('logging', circuitBreakerPresets.lenient);
// { failureThreshold: 10, resetTimeout: 15000, windowSize: 120000, halfOpenMax: 5 }
```

## Methods

### execute(operation)

Execute a throwing operation with circuit breaker protection:

```typescript
try {
  const result = await breaker.execute(async () => {
    return await callExternalService();
  });
} catch (error) {
  // Either CircuitOpenError or the operation's error
}
```

### executeResult(operation)

Execute a Result-returning operation:

```typescript
const result = await breaker.executeResult(async () => {
  return fetchUser(id);  // Returns Result<User, 'NOT_FOUND'>
});
// result: Result<User, 'NOT_FOUND' | CircuitOpenError>
```

### getState()

Get the current circuit state:

```typescript
const state = breaker.getState();  // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
```

### getStats()

Get circuit breaker statistics:

```typescript
const stats = breaker.getStats();
// {
//   state: 'CLOSED',
//   failureCount: 2,
//   successCount: 150,
//   lastFailureTime: 1699123456789,
//   lastSuccessTime: 1699123456999,
//   halfOpenSuccesses: 0,
// }
```

### reset()

Manually reset the circuit to CLOSED state:

```typescript
breaker.reset();  // Clear failures and close circuit
```

### forceOpen()

Manually open the circuit (for maintenance or testing):

```typescript
breaker.forceOpen();  // Immediately block all requests
```

### recordSuccess() / recordFailure()

Manually record outcomes (useful for health checks):

```typescript
// External health check passed
breaker.recordSuccess();

// External health check failed
breaker.recordFailure(new Error('Health check timeout'));
```

## Handling Circuit Open

When the circuit is open, operations fail immediately with `CircuitOpenError`:

```typescript
import { isCircuitOpenError } from 'awaitly/circuit-breaker';

try {
  await breaker.execute(() => callService());
} catch (error) {
  if (isCircuitOpenError(error)) {
    console.log(error.circuitName);   // 'external-api'
    console.log(error.state);         // 'OPEN'
    console.log(error.retryAfterMs);  // Time until HALF_OPEN

    // Respond with cached data or graceful degradation
    return getCachedResponse();
  }
  throw error;
}
```

### Graceful Degradation Pattern

```typescript
async function getUserWithFallback(id: string): Promise<User> {
  const result = await userServiceBreaker.executeResult(() =>
    fetchUserFromService(id)
  );

  if (!result.ok) {
    if (isCircuitOpenError(result.error)) {
      // Service unavailable - use cache
      const cached = await cache.get(`user:${id}`);
      if (cached) return cached;

      // No cache - return degraded response
      return { id, name: 'Unknown', status: 'unavailable' };
    }
    throw result.error;
  }

  // Cache successful responses
  await cache.set(`user:${id}`, result.value);
  return result.value;
}
```

## State Change Callbacks

Monitor circuit state transitions:

```typescript
const breaker = createCircuitBreaker('api', {
  failureThreshold: 5,
  resetTimeout: 30000,
  onStateChange: (from, to, name) => {
    console.log(`Circuit ${name}: ${from} → ${to}`);

    // Alert on circuit open
    if (to === 'OPEN') {
      alertOps(`Circuit breaker ${name} opened!`);
    }

    // Log recovery
    if (from === 'HALF_OPEN' && to === 'CLOSED') {
      console.log(`Circuit ${name} recovered`);
    }
  },
});
```

## Integration with Workflows

Use circuit breakers with awaitly workflows:

```typescript
import { createWorkflow } from 'awaitly';
import { createCircuitBreaker, isCircuitOpenError } from 'awaitly/circuit-breaker';

const paymentBreaker = createCircuitBreaker('payment-gateway', {
  failureThreshold: 3,
  resetTimeout: 60000,
});

const checkout = createWorkflow({ chargeCard, sendReceipt });

const result = await checkout(async (step) => {
  // Wrap external calls with circuit breaker
  const charge = await paymentBreaker.executeResult(() =>
    step(() => chargeCard(amount), { name: 'charge-card' })
  );

  if (!charge.ok) {
    if (isCircuitOpenError(charge.error)) {
      // Payment service is down - offer alternative
      return { status: 'pending', message: 'Payment processing delayed' };
    }
    return charge;  // Return the actual error
  }

  await step(() => sendReceipt(charge.value.id), { name: 'send-receipt' });
  return { status: 'success', chargeId: charge.value.id };
});
```

### Multiple Circuit Breakers

```typescript
const userBreaker = createCircuitBreaker('user-service', circuitBreakerPresets.standard);
const inventoryBreaker = createCircuitBreaker('inventory', circuitBreakerPresets.standard);
const paymentBreaker = createCircuitBreaker('payments', circuitBreakerPresets.critical);

const result = await orderWorkflow(async (step) => {
  // Each external service has its own circuit breaker
  const user = await userBreaker.execute(() =>
    step(() => fetchUser(userId))
  );

  const inventory = await inventoryBreaker.execute(() =>
    step(() => checkInventory(items))
  );

  const payment = await paymentBreaker.execute(() =>
    step(() => processPayment(user, total))
  );

  return { user, inventory, payment };
});
```

## Monitoring & Observability

### Expose Metrics

```typescript
// Express endpoint for monitoring
app.get('/health/circuits', (req, res) => {
  res.json({
    'user-service': userBreaker.getStats(),
    'payment-gateway': paymentBreaker.getStats(),
    'inventory': inventoryBreaker.getStats(),
  });
});
```

### Prometheus Integration

```typescript
import { createCircuitBreaker } from 'awaitly/circuit-breaker';

const breaker = createCircuitBreaker('api', {
  failureThreshold: 5,
  resetTimeout: 30000,
  onStateChange: (from, to, name) => {
    // Increment Prometheus counter
    circuitStateChanges.labels(name, from, to).inc();
  },
});

// Periodically export stats
setInterval(() => {
  const stats = breaker.getStats();
  circuitFailures.labels('api').set(stats.failureCount);
  circuitSuccesses.labels('api').set(stats.successCount);
}, 10000);
```

## API Reference

### Types

```typescript
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  windowSize: number;
  halfOpenMax: number;
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void;
}

interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  halfOpenSuccesses: number;
}

class CircuitOpenError extends Error {
  type: 'CIRCUIT_OPEN';
  circuitName: string;
  state: CircuitState;
  retryAfterMs: number;
}
```

### Functions

| Function | Description |
|----------|-------------|
| `createCircuitBreaker(name, config)` | Create a new circuit breaker |
| `isCircuitOpenError(error)` | Type guard for CircuitOpenError |

### CircuitBreaker Methods

| Method | Description |
|--------|-------------|
| `execute(fn)` | Execute with circuit protection (throws) |
| `executeResult(fn)` | Execute with circuit protection (Result) |
| `getState()` | Get current circuit state |
| `getStats()` | Get statistics |
| `reset()` | Reset to CLOSED state |
| `forceOpen()` | Force circuit to OPEN state |
| `recordSuccess()` | Manually record a success |
| `recordFailure(error?)` | Manually record a failure |

### Presets

| Preset | Use Case | Config |
|--------|----------|--------|
| `critical` | Payment, auth | 3 failures, 60s reset, 1 test |
| `standard` | Typical APIs | 5 failures, 30s reset, 3 tests |
| `lenient` | Non-critical | 10 failures, 15s reset, 5 tests |
