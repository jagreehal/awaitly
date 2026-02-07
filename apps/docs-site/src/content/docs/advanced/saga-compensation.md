---
title: Saga / Compensation
description: Define compensating actions for rollback on failures
---

Define compensating actions for steps that need rollback on downstream failures. When a step fails, compensations run in reverse order.

## Basic usage

```typescript
import { createSagaWorkflow, isSagaCompensationError } from 'awaitly/saga';

// Create saga with deps (error types inferred automatically)
const checkoutSaga = createSagaWorkflow('saga', { reserveInventory, chargeCard, sendConfirmation },
  { onEvent: (event) => console.log(event) }
);

const result = await checkoutSaga(async (saga, deps) => {
  // Reserve inventory with compensation
  const reservation = await saga.step(
    'reserve-inventory',
    () => deps.reserveInventory(items),
    { compensate: (res) => releaseInventory(res.reservationId) }
  );

  // Charge card with compensation
  const payment = await saga.step(
    'charge-card',
    () => deps.chargeCard(amount),
    { compensate: (p) => refundPayment(p.transactionId) }
  );

  // If sendConfirmation fails, compensations run in reverse order:
  // 1. refundPayment(payment.transactionId)
  // 2. releaseInventory(reservation.reservationId)
  await saga.step('send-confirmation', () => deps.sendConfirmation(email));

  return { reservation, payment };
});
```

## Compensation order

Compensations run in reverse order of completion (LIFO):

```
Step 1: reserve-inventory ✓
Step 2: charge-card ✓
Step 3: send-confirmation ✗

Compensation order:
1. refund charge-card
2. release reserve-inventory
```

## Handling compensation errors

```typescript
if (!result.ok && isSagaCompensationError(result.error)) {
  console.log('Saga failed, compensations may have partially succeeded');
  console.log('Compensation errors:', result.error.compensationErrors);
  // Manual intervention may be needed
}
```

## Steps without compensation

Not every step needs compensation:

```typescript
const result = await checkoutSaga(async (saga, deps) => {
  // No compensation needed for reads
  const user = await saga.step('fetch-user', () => deps.fetchUser(userId));

  // Needs compensation
  const payment = await saga.step(
    'charge-card',
    () => deps.chargeCard(amount),
    { compensate: (p) => deps.refundPayment(p.transactionId) }
  );

  // Idempotent operation - no compensation
  await saga.step('send-email', () => deps.sendEmail(user.email));

  return { payment };
});
```

## tryStep for throwing code

Use `tryStep` to catch exceptions from external libraries:

```typescript
import { runSaga } from 'awaitly/saga';

const result = await runSaga<OrderResult, OrderError>(async (saga) => {
  const reservation = await saga.step(
    'reserve-inventory',
    () => reserveInventory(items),
    { compensate: (res) => releaseInventory(res.id) }
  );

  // tryStep catches throws and converts to error
  const payment = await saga.tryStep(
    'charge-payment',
    () => externalPaymentApi.charge(amount), // May throw
    {
      error: 'PAYMENT_FAILED' as const,
      compensate: (p) => externalPaymentApi.refund(p.txId),
    }
  );

  return { reservation, payment };
});
```

## Low-level runSaga

For explicit error typing without deps-based inference:

```typescript
import { runSaga } from 'awaitly/saga';

type CheckoutResult = { orderId: string; chargeId: string };
type CheckoutError = 'INVENTORY_UNAVAILABLE' | 'PAYMENT_FAILED' | 'SEND_FAILED';

const result = await runSaga<CheckoutResult, CheckoutError>(async (saga) => {
  const reservation = await saga.step(
    'reserve-inventory',
    () => reserveInventory(items),
    { compensate: (res) => releaseInventory(res.id) }
  );

  const charge = await saga.step(
    'charge-card',
    () => chargeCard(amount),
    { compensate: (c) => refundCharge(c.id) }
  );

  await saga.step('send-confirmation', () => sendConfirmation(email));

  return { orderId: reservation.id, chargeId: charge.id };
});
```

## Real-world example: Order fulfillment

```typescript
const fulfillOrder = createSagaWorkflow('saga', { reserveStock,
  createShipment,
  chargePayment,
  updateOrder,
  notifyCustomer,
});

const result = await fulfillOrder(async (saga, deps) => {
  // Reserve inventory
  const stock = await saga.step(
    'reserve-stock',
    () => deps.reserveStock(order.items),
    { compensate: (s) => deps.releaseStock(s.reservationId) }
  );

  // Create shipment record
  const shipment = await saga.step(
    'create-shipment',
    () => deps.createShipment(order.address, stock),
    { compensate: (s) => deps.cancelShipment(s.trackingId) }
  );

  // Charge customer
  const payment = await saga.step(
    'charge-payment',
    () => deps.chargePayment(order.total, order.paymentMethod),
    { compensate: (p) => deps.refundPayment(p.transactionId) }
  );

  // Update order status (idempotent, no compensation)
  await saga.step(
    'update-order',
    () => deps.updateOrder(order.id, { status: 'FULFILLED', shipment, payment })
  );

  // Notify customer (can't really undo this)
  await saga.step(
    'notify-customer',
    () => deps.notifyCustomer(order.customerId, { shipment, payment })
  );

  return { shipment, payment };
});

if (!result.ok) {
  if (isSagaCompensationError(result.error)) {
    // Log for manual review
    await alertOps('Saga compensation had errors', result.error);
  }
}
```

## When compensation fails

Compensations can fail for many reasons: network issues, service unavailable, business rules, etc. Here's how to handle them properly.

### Understanding compensation errors

```typescript
import { createSagaWorkflow, isSagaCompensationError } from 'awaitly/saga';

const result = await orderSaga(async (saga, deps) => {
  const reservation = await saga.step(
    'reserve',
    () => deps.reserveStock(items),
    { compensate: (r) => deps.releaseStock(r.id) }
  );

  const payment = await saga.step(
    'charge',
    () => deps.chargeCard(amount),
    { compensate: (p) => deps.refundPayment(p.id) }
  );

  // This fails
  await saga.step('ship-order', () => deps.shipOrder(reservation));

  return { reservation, payment };
});

if (!result.ok && isSagaCompensationError(result.error)) {
  const { originalError, compensationErrors } = result.error;

  console.log('Original failure:', originalError);
  // The step that triggered compensations

  console.log('Compensation errors:', compensationErrors);
  // Array of { stepName, error } for each failed compensation

  // Check which compensations succeeded vs failed
  const failedCompensations = compensationErrors.map(e => e.stepName);
  console.log('Failed to compensate:', failedCompensations);
  // ['charge'] - refund failed, but releaseStock succeeded
}
```

### Compensation continues on errors

Even when a compensation fails, the saga continues running remaining compensations:

```
Step 1: reserve-stock ✓
Step 2: charge-card ✓
Step 3: ship-order ✗  <- triggers compensation

Compensations:
1. refund charge-card ✗  <- fails, but continues
2. release reserve-stock ✓  <- still runs

Result: SagaCompensationError with compensationErrors: [{stepName: 'charge', error: ...}]
```

### Alerting on compensation failures

```typescript
import { createSagaWorkflow, isSagaCompensationError } from 'awaitly/saga';

const orderSaga = createSagaWorkflow('saga', deps, {
  onEvent: async (event) => {
    if (event.type === 'compensation_error') {
      // Alert immediately when compensation fails
      await alertOps({
        severity: 'high',
        message: `Compensation failed for step: ${event.stepName}`,
        error: event.error,
        workflowId: event.workflowId,
        requiresManualIntervention: true,
      });

      // Log for audit trail
      await db.compensationFailures.create({
        data: {
          workflowId: event.workflowId,
          stepName: event.stepName,
          error: JSON.stringify(event.error),
          timestamp: new Date(),
          resolved: false,
        },
      });
    }
  },
});
```

## Partial compensation recovery

When some compensations fail, you need a recovery strategy.

### Track compensation state

```typescript
interface CompensationState {
  workflowId: string;
  originalError: unknown;
  compensations: Array<{
    stepName: string;
    status: 'succeeded' | 'failed' | 'pending';
    error?: unknown;
    value?: unknown; // The value that needs compensating
  }>;
}

async function handleSagaResult<T>(
  workflowId: string,
  result: Result<T, unknown>
): Promise<void> {
  if (!result.ok && isSagaCompensationError(result.error)) {
    const state: CompensationState = {
      workflowId,
      originalError: result.error.originalError,
      compensations: result.error.compensationErrors.map(e => ({
        stepName: e.stepName,
        status: 'failed',
        error: e.error,
        value: e.value, // What needs to be compensated
      })),
    };

    // Persist for later recovery
    await db.compensationState.create({ data: state });

    // Alert for manual review
    await alertOps('Saga needs manual recovery', state);
  }
}
```

### Retry failed compensations

```typescript
async function retryFailedCompensations(workflowId: string): Promise<void> {
  const state = await db.compensationState.findUnique({
    where: { workflowId },
  });

  if (!state) return;

  for (const comp of state.compensations) {
    if (comp.status === 'failed') {
      try {
        // Map step name to compensation function
        const compensate = getCompensationFn(comp.stepName);
        await compensate(comp.value);

        // Mark as succeeded
        await db.compensationState.updateCompensation(
          workflowId,
          comp.stepName,
          { status: 'succeeded' }
        );

        console.log(`Compensation recovered: ${comp.stepName}`);
      } catch (error) {
        console.error(`Retry failed for ${comp.stepName}:`, error);
        // Will need another retry or manual intervention
      }
    }
  }
}

function getCompensationFn(stepName: string): (value: unknown) => Promise<void> {
  const compensationMap: Record<string, (v: unknown) => Promise<void>> = {
    'charge': (v) => refundPayment((v as Payment).id),
    'reserve': (v) => releaseStock((v as Reservation).id),
    'shipment': (v) => cancelShipment((v as Shipment).trackingId),
  };

  return compensationMap[stepName] ?? (() => Promise.resolve());
}
```

## Idempotent compensation design

Compensations may run multiple times. Design them to be safe.

### Use idempotency keys

```typescript
const orderSaga = createSagaWorkflow('saga', deps);

const result = await orderSaga(async (saga, deps) => {
  const payment = await saga.step(
    'charge',
    () => deps.chargeCard(amount),
    {
      compensate: async (p) => {
        // Use idempotency key - safe to call multiple times
        await deps.refundPayment(p.id, {
          idempotencyKey: `refund:${p.id}`,
        });
      },
    }
  );

  const reservation = await saga.step(
    'reserve',
    () => deps.reserveStock(items),
    {
      compensate: async (r) => {
        // Check if already released
        const status = await deps.getReservationStatus(r.id);
        if (status !== 'released') {
          await deps.releaseStock(r.id);
        }
      },
    }
  );

  return { payment, reservation };
});
```

### Record compensation state

```typescript
async function createIdempotentCompensation<T>(
  compensationId: string,
  compensate: (value: T) => Promise<void>
): (value: T) => Promise<void> {
  return async (value: T) => {
    // Check if already compensated
    const existing = await db.compensations.findUnique({
      where: { id: compensationId },
    });

    if (existing?.completedAt) {
      console.log(`Compensation ${compensationId} already executed, skipping`);
      return;
    }

    // Record attempt
    await db.compensations.upsert({
      where: { id: compensationId },
      create: { id: compensationId, startedAt: new Date() },
      update: { startedAt: new Date() },
    });

    // Execute compensation
    await compensate(value);

    // Mark complete
    await db.compensations.update({
      where: { id: compensationId },
      data: { completedAt: new Date() },
    });
  };
}

// Usage
const payment = await saga.step(
  'charge',
  () => deps.chargeCard(amount),
  {
    compensate: createIdempotentCompensation(
      `refund:${orderId}:charge`,
      (p) => deps.refundPayment(p.id)
    ),
  }
);
```

## Manual intervention workflows

When automatic recovery fails, route to humans.

### Create intervention queue

```typescript
interface ManualIntervention {
  id: string;
  workflowId: string;
  type: 'compensation_failed' | 'business_rule' | 'external_dependency';
  description: string;
  context: {
    stepName: string;
    value: unknown;
    error: unknown;
    compensationFn?: string;
  };
  status: 'pending' | 'in_progress' | 'resolved' | 'escalated';
  assignedTo?: string;
  createdAt: Date;
  resolvedAt?: Date;
  resolution?: string;
}

async function createIntervention(
  error: SagaCompensationError,
  workflowId: string
): Promise<void> {
  for (const compError of error.compensationErrors) {
    const intervention: ManualIntervention = {
      id: `int:${workflowId}:${compError.stepName}`,
      workflowId,
      type: 'compensation_failed',
      description: `Failed to compensate ${compError.stepName}: ${compError.error}`,
      context: {
        stepName: compError.stepName,
        value: compError.value,
        error: compError.error,
      },
      status: 'pending',
      createdAt: new Date(),
    };

    await db.interventions.create({ data: intervention });
    await notifyOpsTeam(intervention);
  }
}
```

### Resolution dashboard

```typescript
// API endpoint for ops team
app.post('/api/interventions/:id/resolve', async (req, res) => {
  const { id } = req.params;
  const { action, notes, operator } = req.body;

  const intervention = await db.interventions.findUnique({ where: { id } });

  if (!intervention) {
    return res.status(404).json({ error: 'Not found' });
  }

  switch (action) {
    case 'retry_compensation':
      // Retry the compensation
      try {
        const compensate = getCompensationFn(intervention.context.stepName);
        await compensate(intervention.context.value);

        await db.interventions.update({
          where: { id },
          data: {
            status: 'resolved',
            resolution: `Compensation retried successfully by ${operator}`,
            resolvedAt: new Date(),
          },
        });
      } catch (error) {
        return res.status(500).json({ error: 'Retry failed', details: error });
      }
      break;

    case 'manual_resolution':
      // Operator manually fixed the issue outside the system
      await db.interventions.update({
        where: { id },
        data: {
          status: 'resolved',
          resolution: `Manually resolved: ${notes}`,
          resolvedAt: new Date(),
        },
      });
      break;

    case 'escalate':
      await db.interventions.update({
        where: { id },
        data: { status: 'escalated', assignedTo: req.body.escalateTo },
      });
      await notifyEscalation(intervention, req.body.escalateTo);
      break;
  }

  res.json({ success: true });
});
```

### Auto-escalation

```typescript
// Run periodically to escalate stale interventions
async function autoEscalate(): Promise<void> {
  const staleThreshold = 2 * 60 * 60 * 1000; // 2 hours

  const stale = await db.interventions.findMany({
    where: {
      status: 'pending',
      createdAt: { lt: new Date(Date.now() - staleThreshold) },
    },
  });

  for (const intervention of stale) {
    await db.interventions.update({
      where: { id: intervention.id },
      data: { status: 'escalated', assignedTo: 'engineering-leads' },
    });

    await sendPagerDutyAlert({
      summary: `Saga compensation stuck for ${intervention.workflowId}`,
      severity: 'high',
      details: intervention,
    });
  }
}
```

## Best practices

1. **Compensations should be idempotent** - They may run multiple times on retries
2. **Not everything needs compensation** - Read operations and truly idempotent writes don't
3. **Plan for compensation failures** - Have alerting and manual recovery procedures
4. **Keep compensations simple** - Complex compensation logic is a code smell
5. **Test the failure paths** - Saga value comes from handling failures correctly
6. **Use timeouts on compensations** - Don't let them hang forever
7. **Log everything** - Audit trail is critical for debugging and compliance
8. **Have runbooks** - Document manual recovery procedures for common scenarios
