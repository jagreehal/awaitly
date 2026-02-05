---
title: Error Recovery Trade-offs
description: When to use retry vs circuit breaker vs saga compensation
---

Different error recovery patterns solve different problems. Choosing the wrong one can make things worse.

## The Decision Matrix

| Failure Type | Pattern | Why |
|--------------|---------|-----|
| Transient (network blip, timeout) | **Retry** | Likely to succeed on next attempt |
| Downstream overload | **Circuit Breaker** | Stop hammering failing services |
| Partial completion (multi-step) | **Saga** | Undo completed steps |
| Rate limit exceeded | **Rate Limiter** | Prevent hitting limits |
| Permanent (validation, not found) | **Return error** | Retrying won't help |

## Retry

**Use when:** Failures are transient and likely to self-resolve.

```typescript
import { createWorkflow } from 'awaitly/workflow';

const workflow = createWorkflow(deps);
const result = await workflow(async (step) => {
  const data = await step.retry(
    'fetchFromAPI',
    () => fetchFromAPI(),
    {
      attempts: 3,
      backoff: 'exponential',
      delayMs: 100,
      retryOn: (error) => error === 'TIMEOUT' || error === 'CONNECTION_ERROR',
    }
  );
  return data;
});
```

**Good for:**
- Network timeouts
- Connection resets
- Brief service unavailability
- Rate limit with `Retry-After` header

**Bad for:**
- Validation errors (won't change on retry)
- Authentication failures
- Resource not found
- Downstream service overload (makes it worse)

**Failure mode:** If retries exhaust, you get the last error. No cleanup of partial state.

## Circuit Breaker

**Use when:** A downstream service is failing repeatedly and retrying makes things worse.

```typescript
import { createCircuitBreaker, isCircuitOpenError } from 'awaitly/circuit-breaker';

const paymentBreaker = createCircuitBreaker('payment-api', {
  failureThreshold: 5,     // Open after 5 failures
  resetTimeMs: 30000,      // Try again after 30s
  halfOpenAttempts: 2,     // Test with 2 requests before closing
});

const result = await paymentBreaker.call(() => paymentAPI.charge(amount));

if (!result.ok && isCircuitOpenError(result.error)) {
  // Fail fast - don't even try to call the API
  return err('SERVICE_UNAVAILABLE');
}
```

**Good for:**
- Protecting degraded services from more load
- Failing fast when a dependency is down
- Giving downstream services time to recover

**Bad for:**
- Transient failures (use retry instead)
- Single critical operations (use retry with backoff)
- Operations that must succeed eventually

**Failure mode:** When circuit is open, ALL requests fail immediately. Plan for degraded functionality.

## Saga (Compensation)

**Use when:** A multi-step operation fails partway through and you need to undo completed steps.

```typescript
import { createSagaWorkflow } from 'awaitly/workflow';

const checkout = createSagaWorkflow(deps);
const result = await checkout(async (saga) => {
  const payment = await saga.step(
    'charge',
    () => chargeCard(amount),
    { compensate: (p) => refundCard(p.id) }
  );

  const reservation = await saga.step(
    'reserve',
    () => reserveInventory(items),
    { compensate: (r) => releaseInventory(r.id) }
  );

  const order = await saga.step(
    'order',
    () => createOrder({ payment, reservation }),
    { compensate: (o) => cancelOrder(o.id) }
  );

  return order;
});
// If createOrder fails, reservation is released, then payment is refunded (LIFO)
```

**Good for:**
- Financial transactions (charge → reserve → fulfill)
- Multi-service orchestration
- Operations with external side effects

**Bad for:**
- Single-step operations (no need for compensation)
- Operations that can't be undone (sent emails, published events)
- Pure data transformations

**Failure mode:** Compensation itself can fail. Design compensations to be idempotent and handle the case where compensation errors require manual intervention.

## Combining Patterns

Patterns compose. The key is ordering them correctly:

### Retry inside Saga step

```typescript
// Good: Retry is scoped to one step
const payment = await saga.step(
  'charge',
  () => retry(() => chargeCard(amount), { maxAttempts: 3 }),
  { compensate: (p) => refundCard(p.id) }
);
```

### Circuit Breaker wrapping Retry

```typescript
// Good: Circuit breaker prevents retry storms
const breaker = createCircuitBreaker('payment-api', config);

const result = await breaker.call(
  () => retry(() => paymentAPI.charge(), { maxAttempts: 3 })
);
```

### Rate Limiter at the outer layer

```typescript
// Good: Rate limiter prevents exceeding quotas
const limiter = createRateLimiter('payment-api', { maxRequests: 100, windowMs: 60000 });

const result = await limiter.call(
  () => breaker.call(
    () => retry(() => paymentAPI.charge(), { maxAttempts: 3 })
  )
);
```

## Anti-patterns

### Retrying non-transient errors

```typescript
// Bad: Validation errors won't change on retry
await retry(
  () => createUser({ email: 'invalid' }),
  { maxAttempts: 3 }  // Wastes 3 attempts
);

// Good: Only retry transient errors
await retry(
  () => createUser({ email }),
  {
    maxAttempts: 3,
    shouldRetry: (error) => error === 'TIMEOUT' || error === 'CONNECTION_ERROR',
  }
);
```

### Retrying when downstream is overloaded

```typescript
// Bad: Makes overload worse
for (const user of users) {
  await retry(() => notifyUser(user), { maxAttempts: 10 });
}

// Good: Circuit breaker protects the service
const breaker = createCircuitBreaker('notification-service', config);
for (const user of users) {
  const result = await breaker.call(() => notifyUser(user));
  if (isCircuitOpenError(result.error)) break; // Stop when circuit opens
}
```

### Saga without idempotent compensations

```typescript
// Bad: Compensation can double-refund
compensate: (payment) => refundCard(payment.id)

// Good: Idempotent compensation
compensate: async (payment) => {
  const existing = await getRefund(payment.id);
  if (existing) return ok(existing); // Already refunded
  return refundCard(payment.id, { idempotencyKey: `refund-${payment.id}` });
}
```

## When Each Pattern Fails

| Pattern | Failure Mode | Mitigation |
|---------|--------------|------------|
| Retry | Exhausts attempts, returns last error | Add circuit breaker, adjust attempt count |
| Circuit Breaker | All requests fail when open | Provide fallback, monitor for flapping |
| Saga | Compensation can fail | Make compensations idempotent, alert on failure |
| Rate Limiter | Requests queued or rejected | Increase limits, add backpressure |

## The Right Questions

Before choosing a pattern, ask:

1. **Is this error transient?** → Retry
2. **Is the downstream service healthy?** → If no, Circuit Breaker
3. **Did I create side effects I need to undo?** → Saga
4. **Am I at risk of hitting rate limits?** → Rate Limiter
5. **Is this a permanent error?** → Just return it

## Example: Full Stack

```typescript
import { createCircuitBreaker } from 'awaitly/circuit-breaker';
import { createRateLimiter } from 'awaitly/ratelimit';
import { createSagaWorkflow } from 'awaitly/workflow';

const paymentBreaker = createCircuitBreaker('payment-api', { failureThreshold: 5 });
const paymentLimiter = createRateLimiter('payment-api', { maxRequests: 100, windowMs: 60000 });

const checkout = createSagaWorkflow(deps);

const result = await checkout(async (saga) => {
  // Step 1: Charge with retry + circuit breaker + rate limiting
  const payment = await saga.step(
    'charge',
    async () => {
      return paymentLimiter.call(() =>
        paymentBreaker.call(() =>
          retry(() => chargeCard(amount), {
            maxAttempts: 3,
            shouldRetry: (e) => e === 'TIMEOUT',
          })
        )
      );
    },
    { compensate: (p) => refundCard(p.id) }
  );

  // Step 2: Reserve (simpler, internal service)
  const reservation = await saga.step(
    'reserve',
    () => reserveInventory(items),
    { compensate: (r) => releaseInventory(r.id) }
  );

  return { payment, reservation };
});
```

This stack provides:
- **Rate limiting** prevents quota exhaustion
- **Circuit breaker** protects failing services
- **Retry** handles transient errors
- **Saga** rolls back on partial failure
