# Saga / Compensation Pattern

Execute multi-step workflows with automatic rollback on failure. When a downstream step fails, all previously completed steps are compensated in reverse order.

## Table of Contents

- [The Problem](#the-problem)
- [How It Works](#how-it-works)
- [Basic Usage](#basic-usage)
- [Compensation Actions](#compensation-actions)
- [Error Handling](#error-handling)
- [Events & Observability](#events--observability)
- [Low-Level API: runSaga](#low-level-api-runsaga)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)

## The Problem

Multi-step operations can fail partway through, leaving the system in an inconsistent state:

```typescript
// Without saga - what if sendEmail fails?
async function checkout(items: Item[], userId: string) {
  const reservation = await reserveInventory(items);    // ✓ Completed
  const payment = await chargeCard(userId, total);       // ✓ Completed
  await sendEmail(userId, 'Order confirmed');            // ✗ Failed!
  // Now we have reserved inventory and charged the card,
  // but the user never got confirmation. Manual cleanup required!
}
```

Problems:
- **Inconsistent state**: Some steps completed, others didn't
- **Manual cleanup**: Requires manual intervention to roll back
- **No visibility**: Hard to know what was completed vs. failed
- **Error-prone**: Easy to forget compensation logic

## How It Works

```
Step 1 → Step 2 → Step 3 → ... → Step N
  ↓        ↓        ↓              ↓
Record   Record   Record        Record
Comp 1   Comp 2   Comp 3        Comp N

On failure at Step N:
  Execute Comp N-1 → Comp N-2 → ... → Comp 1 (reverse order)
```

1. Each step can define a **compensation action** (rollback function)
2. If any step fails, compensations run in **reverse order**
3. The original value from each step is passed to its compensation
4. Even if compensations fail, you get a detailed error report

## Basic Usage

```typescript
import { createSagaWorkflow, isSagaCompensationError } from 'awaitly/saga';

// Define your operations
const deps = {
  reserveInventory: async (items) => { /* ... */ },
  chargeCard: async (amount) => { /* ... */ },
  sendEmail: async (userId, message) => { /* ... */ },
};

// Create saga workflow
const checkoutSaga = createSagaWorkflow(deps);

const result = await checkoutSaga(async (saga, deps) => {
  // Step 1: Reserve inventory with compensation
  const reservation = await saga.step(
    () => deps.reserveInventory(items),
    {
      name: 'reserve-inventory',
      compensate: (res) => releaseInventory(res.reservationId),
    }
  );

  // Step 2: Charge card with compensation
  const payment = await saga.step(
    () => deps.chargeCard(amount),
    {
      name: 'charge-card',
      compensate: (p) => refundPayment(p.transactionId),
    }
  );

  // Step 3: Send email (no compensation needed)
  await saga.step(
    () => deps.sendEmail(userId, 'Order confirmed'),
    { name: 'send-email' }
  );

  return { reservation, payment };
});

// Handle result
if (!result.ok) {
  if (isSagaCompensationError(result.error)) {
    console.log('Saga failed, some compensations may have failed:');
    console.log(result.error.compensationErrors);
  } else {
    console.log('Saga failed:', result.error);
  }
}
```

## Compensation Actions

### Defining Compensations

Compensation functions receive the **value returned by the step**:

```typescript
const reservation = await saga.step(
  () => reserveInventory(items),  // Returns { reservationId: 'res_123' }
  {
    compensate: (res) => {
      // `res` is the value returned above
      return releaseInventory(res.reservationId);
    },
  }
);
```

### Async Compensations

Compensations can be async:

```typescript
const payment = await saga.step(
  () => chargeCard(amount),
  {
    compensate: async (payment) => {
      // Async compensation
      await refundPayment(payment.transactionId);
      await logRefund(payment.transactionId, 'Saga rollback');
    },
  }
);
```

### Steps Without Compensation

Not every step needs compensation (e.g., notifications, logging):

```typescript
// No compensate function - nothing to undo
await saga.step(
  () => sendNotification(userId, message),
  { name: 'send-notification' }
);
```

### Compensation Order

Compensations run in **reverse order** (LIFO):

```typescript
// Steps execute: A → B → C
// If C fails, compensations run: B → A

await saga.step(() => stepA(), { compensate: compA });  // First
await saga.step(() => stepB(), { compensate: compB });  // Second
await saga.step(() => stepC(), { compensate: compC });  // Third - FAILS

// Compensation order: compB, then compA
// (compC never runs because stepC failed)
```

## Error Handling

### Catching Step Errors with tryStep

For operations that throw instead of returning Results:

```typescript
const payment = await saga.tryStep(
  () => externalPaymentApi.charge(amount),  // May throw
  {
    error: 'PAYMENT_FAILED' as const,       // Static error type
    name: 'charge-card',
    compensate: (p) => externalPaymentApi.refund(p.txId),
  }
);

// Or with dynamic error mapping
const result = await saga.tryStep(
  () => riskyOperation(),
  {
    onError: (thrown) => ({
      type: 'OPERATION_ERROR' as const,
      message: String(thrown),
    }),
    compensate: (value) => undoOperation(value),
  }
);
```

### Compensation Failures

If compensation actions fail, you get a `SagaCompensationError`:

```typescript
import { isSagaCompensationError } from 'awaitly/saga';

const result = await checkoutSaga(/* ... */);

if (!result.ok && isSagaCompensationError(result.error)) {
  const { originalError, compensationErrors } = result.error;

  console.log('Original failure:', originalError);
  console.log('Compensation failures:');
  for (const { stepName, error } of compensationErrors) {
    console.log(`  ${stepName}: ${error}`);
  }

  // Alert operations team - manual intervention needed
  await alertOps({
    type: 'SAGA_COMPENSATION_FAILURE',
    originalError,
    compensationErrors,
  });
}
```

### Throwing on Compensation Failure

By default, compensation errors are returned. You can throw instead:

```typescript
const saga = createSagaWorkflow(deps, {
  throwOnCompensationFailure: true,
});

try {
  const result = await saga(/* ... */);
} catch (error) {
  if (isSagaCompensationError(error)) {
    // Compensation failed
  }
}
```

## Events & Observability

### Event Stream

Track saga lifecycle with events:

```typescript
const saga = createSagaWorkflow(deps, {
  onEvent: (event) => {
    switch (event.type) {
      case 'saga_start':
        console.log(`Saga ${event.sagaId} started`);
        break;
      case 'saga_success':
        console.log(`Saga completed in ${event.durationMs}ms`);
        break;
      case 'saga_error':
        console.log(`Saga failed:`, event.error);
        break;
      case 'saga_compensation_start':
        console.log(`Running ${event.stepCount} compensations`);
        break;
      case 'saga_compensation_step':
        console.log(`Compensation ${event.stepName}: ${event.success ? 'OK' : 'FAILED'}`);
        break;
      case 'saga_compensation_end':
        console.log(`Compensations done in ${event.durationMs}ms`);
        break;
    }
  },
});
```

### Event Types

| Event | When | Data |
|-------|------|------|
| `saga_start` | Saga begins | `sagaId`, `ts` |
| `saga_success` | Saga completes successfully | `sagaId`, `durationMs` |
| `saga_error` | Saga step fails | `sagaId`, `durationMs`, `error` |
| `saga_compensation_start` | Compensations begin | `sagaId`, `stepCount` |
| `saga_compensation_step` | Each compensation completes | `stepName`, `success`, `error?` |
| `saga_compensation_end` | All compensations done | `durationMs`, `success`, `failedCount` |

### Error Callback

Handle errors outside the event stream:

```typescript
const saga = createSagaWorkflow(deps, {
  onError: (error, stepName) => {
    if (isSagaCompensationError(error)) {
      metrics.increment('saga.compensation_failures');
    } else {
      metrics.increment(`saga.step_failures.${stepName}`);
    }
  },
});
```

## Low-Level API: runSaga

For explicit error typing without deps-based inference:

```typescript
import { runSaga } from 'awaitly/saga';

type CheckoutResult = { orderId: string; chargeId: string };
type CheckoutError = 'INVENTORY_UNAVAILABLE' | 'PAYMENT_FAILED' | 'EMAIL_FAILED';

const result = await runSaga<CheckoutResult, CheckoutError>(
  async (saga) => {
    const reservation = await saga.step(
      () => reserveInventory(items),
      { compensate: (res) => releaseInventory(res.id) }
    );

    const payment = await saga.tryStep(
      () => paymentApi.charge(amount),
      {
        error: 'PAYMENT_FAILED' as const,
        compensate: (p) => paymentApi.refund(p.txId),
      }
    );

    return { orderId: reservation.orderId, chargeId: payment.chargeId };
  },
  {
    onError: (error) => console.error('Saga error:', error),
  }
);
```

## Best Practices

### 1. Design Idempotent Compensations

Compensations might run multiple times (retries, crashes):

```typescript
// Good: Idempotent compensation
compensate: async (payment) => {
  // Check if already refunded before attempting
  const existing = await getRefund(payment.transactionId);
  if (!existing) {
    await createRefund(payment.transactionId);
  }
}

// Bad: Non-idempotent
compensate: async (payment) => {
  await createRefund(payment.transactionId);  // Fails if already refunded
}
```

### 2. Log Everything

```typescript
compensate: async (payment) => {
  console.log(`Compensating payment ${payment.transactionId}`);
  try {
    await refundPayment(payment.transactionId);
    console.log(`Refunded ${payment.transactionId}`);
  } catch (error) {
    console.error(`Failed to refund ${payment.transactionId}:`, error);
    throw error;  // Re-throw to report in SagaCompensationError
  }
}
```

### 3. Handle Partial Failures Gracefully

```typescript
const result = await checkoutSaga(/* ... */);

if (!result.ok) {
  if (isSagaCompensationError(result.error)) {
    // Some compensations failed - needs manual intervention
    await createIncident({
      type: 'SAGA_PARTIAL_ROLLBACK',
      sagaId: result.error.sagaId,
      originalError: result.error.originalError,
      failedCompensations: result.error.compensationErrors,
    });
  } else {
    // Clean failure - all compensations succeeded
    // Just report the original error
    return { error: result.error };
  }
}
```

### 4. Keep Compensations Fast

```typescript
// Good: Quick compensation
compensate: (reservation) => releaseInventory(reservation.id)

// Avoid: Slow compensation that blocks rollback
compensate: async (reservation) => {
  await sendEmail(user, 'Your reservation was cancelled');  // Slow!
  await releaseInventory(reservation.id);
}
```

## API Reference

### Functions

| Function | Description |
|----------|-------------|
| `createSagaWorkflow(deps, options?)` | Create a saga with auto-inferred errors |
| `runSaga(fn, options?)` | Low-level saga execution with explicit types |
| `isSagaCompensationError(error)` | Type guard for compensation errors |

### SagaContext Methods

| Method | Description |
|--------|-------------|
| `step(operation, options?)` | Execute a Result-returning step |
| `tryStep(operation, options)` | Execute a throwing operation |
| `getCompensations()` | Get recorded compensations (for debugging) |

### SagaStepOptions

```typescript
interface SagaStepOptions<T> {
  name?: string;                          // Step name for events
  compensate?: (value: T) => void | Promise<void>;  // Rollback function
}
```

### SagaWorkflowOptions

```typescript
interface SagaWorkflowOptions<E> {
  onError?: (error, stepName?) => void;   // Error callback
  onEvent?: (event) => void;              // Event stream
  throwOnCompensationFailure?: boolean;   // Throw instead of return
}
```

### SagaCompensationError

```typescript
interface SagaCompensationError {
  type: 'SAGA_COMPENSATION_ERROR';
  originalError: unknown;                 // The error that triggered rollback
  compensationErrors: Array<{             // Failed compensations
    stepName?: string;
    error: unknown;
  }>;
}
```

### SagaEvent Types

```typescript
type SagaEvent =
  | { type: 'saga_start'; sagaId: string; ts: number }
  | { type: 'saga_success'; sagaId: string; ts: number; durationMs: number }
  | { type: 'saga_error'; sagaId: string; ts: number; durationMs: number; error: unknown }
  | { type: 'saga_compensation_start'; sagaId: string; ts: number; stepCount: number }
  | { type: 'saga_compensation_step'; sagaId: string; stepName?: string; ts: number; success: boolean; error?: unknown }
  | { type: 'saga_compensation_end'; sagaId: string; ts: number; durationMs: number; success: boolean; failedCount: number };
```
