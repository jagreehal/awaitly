---
title: Saga / Compensation
description: Define compensating actions for rollback on failures
---

Define compensating actions for steps that need rollback on downstream failures. When a step fails, compensations run in reverse order.

## Basic usage

```typescript
import { createSagaWorkflow, isSagaCompensationError } from 'awaitly';

// Create saga with deps (error types inferred automatically)
const checkoutSaga = createSagaWorkflow(
  { reserveInventory, chargeCard, sendConfirmation },
  { onEvent: (event) => console.log(event) }
);

const result = await checkoutSaga(async (saga, deps) => {
  // Reserve inventory with compensation
  const reservation = await saga.step(
    () => deps.reserveInventory(items),
    {
      name: 'reserve-inventory',
      compensate: (res) => releaseInventory(res.reservationId),
    }
  );

  // Charge card with compensation
  const payment = await saga.step(
    () => deps.chargeCard(amount),
    {
      name: 'charge-card',
      compensate: (p) => refundPayment(p.transactionId),
    }
  );

  // If sendConfirmation fails, compensations run in reverse order:
  // 1. refundPayment(payment.transactionId)
  // 2. releaseInventory(reservation.reservationId)
  await saga.step(
    () => deps.sendConfirmation(email),
    { name: 'send-confirmation' }
  );

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
  const user = await saga.step(
    () => deps.fetchUser(userId),
    { name: 'fetch-user' }
  );

  // Needs compensation
  const payment = await saga.step(
    () => deps.chargeCard(amount),
    {
      name: 'charge-card',
      compensate: (p) => deps.refundPayment(p.transactionId),
    }
  );

  // Idempotent operation - no compensation
  await saga.step(
    () => deps.sendEmail(user.email),
    { name: 'send-email' }
  );

  return { payment };
});
```

## tryStep for throwing code

Use `tryStep` to catch exceptions from external libraries:

```typescript
import { runSaga } from 'awaitly';

const result = await runSaga<OrderResult, OrderError>(async (saga) => {
  const reservation = await saga.step(
    () => reserveInventory(items),
    { compensate: (res) => releaseInventory(res.id) }
  );

  // tryStep catches throws and converts to error
  const payment = await saga.tryStep(
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
import { runSaga } from 'awaitly';

type CheckoutResult = { orderId: string; chargeId: string };
type CheckoutError = 'INVENTORY_UNAVAILABLE' | 'PAYMENT_FAILED' | 'SEND_FAILED';

const result = await runSaga<CheckoutResult, CheckoutError>(async (saga) => {
  const reservation = await saga.step(
    () => reserveInventory(items),
    { compensate: (res) => releaseInventory(res.id) }
  );

  const charge = await saga.step(
    () => chargeCard(amount),
    { compensate: (c) => refundCharge(c.id) }
  );

  await saga.step(() => sendConfirmation(email));

  return { orderId: reservation.id, chargeId: charge.id };
});
```

## Real-world example: Order fulfillment

```typescript
const fulfillOrder = createSagaWorkflow({
  reserveStock,
  createShipment,
  chargePayment,
  updateOrder,
  notifyCustomer,
});

const result = await fulfillOrder(async (saga, deps) => {
  // Reserve inventory
  const stock = await saga.step(
    () => deps.reserveStock(order.items),
    {
      name: 'reserve-stock',
      compensate: (s) => deps.releaseStock(s.reservationId),
    }
  );

  // Create shipment record
  const shipment = await saga.step(
    () => deps.createShipment(order.address, stock),
    {
      name: 'create-shipment',
      compensate: (s) => deps.cancelShipment(s.trackingId),
    }
  );

  // Charge customer
  const payment = await saga.step(
    () => deps.chargePayment(order.total, order.paymentMethod),
    {
      name: 'charge-payment',
      compensate: (p) => deps.refundPayment(p.transactionId),
    }
  );

  // Update order status (idempotent, no compensation)
  await saga.step(
    () => deps.updateOrder(order.id, { status: 'FULFILLED', shipment, payment }),
    { name: 'update-order' }
  );

  // Notify customer (can't really undo this)
  await saga.step(
    () => deps.notifyCustomer(order.customerId, { shipment, payment }),
    { name: 'notify-customer' }
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

## Best practices

1. **Compensations should be idempotent** - They may run multiple times on retries
2. **Not everything needs compensation** - Read operations and truly idempotent writes don't
3. **Plan for compensation failures** - Have alerting and manual recovery procedures
4. **Keep compensations simple** - Complex compensation logic is a code smell
5. **Test the failure paths** - Saga value comes from handling failures correctly
