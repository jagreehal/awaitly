---
title: Checkout Flow
description: A complete e-commerce checkout workflow
---

A checkout workflow demonstrating validation, payment, and order creation with typed errors.

## Define the operations

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

type CartItem = { productId: string; quantity: number; price: number };
type Order = { id: string; items: CartItem[]; total: number };
type Payment = { transactionId: string; amount: number };

const validateCart = async (
  items: CartItem[]
): AsyncResult<CartItem[], 'EMPTY_CART' | 'INVALID_QUANTITY'> => {
  if (items.length === 0) return err('EMPTY_CART');
  if (items.some((i) => i.quantity <= 0)) return err('INVALID_QUANTITY');
  return ok(items);
};

const checkInventory = async (
  items: CartItem[]
): AsyncResult<CartItem[], 'OUT_OF_STOCK'> => {
  // Check each item against inventory
  const available = await Promise.all(
    items.map((item) => inventory.check(item.productId, item.quantity))
  );
  if (available.some((a) => !a)) return err('OUT_OF_STOCK');
  return ok(items);
};

const calculateTotal = async (
  items: CartItem[]
): AsyncResult<number, 'PRICING_ERROR'> => {
  try {
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    return ok(total);
  } catch {
    return err('PRICING_ERROR');
  }
};

const processPayment = async (
  amount: number,
  paymentMethod: string
): AsyncResult<Payment, 'PAYMENT_DECLINED' | 'PAYMENT_ERROR'> => {
  const result = await paymentProvider.charge(amount, paymentMethod);
  if (result.declined) return err('PAYMENT_DECLINED');
  if (result.error) return err('PAYMENT_ERROR');
  return ok({ transactionId: result.id, amount });
};

const createOrder = async (
  items: CartItem[],
  payment: Payment
): AsyncResult<Order, 'ORDER_CREATION_FAILED'> => {
  try {
    const order = await db.orders.create({
      items,
      total: payment.amount,
      paymentId: payment.transactionId,
    });
    return ok(order);
  } catch {
    return err('ORDER_CREATION_FAILED');
  }
};
```

## Create the workflow

```typescript
import { createWorkflow } from 'awaitly';

const checkout = createWorkflow({
  validateCart,
  checkInventory,
  calculateTotal,
  processPayment,
  createOrder,
});
```

## Execute

```typescript
const result = await checkout(async (step) => {
  // Validate and check inventory
  const validItems = await step(validateCart(cartItems));
  const availableItems = await step(checkInventory(validItems));

  // Calculate and charge
  const total = await step(calculateTotal(availableItems));
  const payment = await step(processPayment(total, paymentMethodId));

  // Create order
  const order = await step(createOrder(availableItems, payment));

  return order;
});
```

## Handle errors

```typescript
if (result.ok) {
  return res.json({ orderId: result.value.id });
}

switch (result.error) {
  case 'EMPTY_CART':
    return res.status(400).json({ error: 'Cart is empty' });
  case 'INVALID_QUANTITY':
    return res.status(400).json({ error: 'Invalid quantity' });
  case 'OUT_OF_STOCK':
    return res.status(409).json({ error: 'Some items are out of stock' });
  case 'PRICING_ERROR':
    return res.status(500).json({ error: 'Failed to calculate price' });
  case 'PAYMENT_DECLINED':
    return res.status(402).json({ error: 'Payment was declined' });
  case 'PAYMENT_ERROR':
    return res.status(502).json({ error: 'Payment provider error' });
  case 'ORDER_CREATION_FAILED':
    return res.status(500).json({ error: 'Failed to create order' });
  default:
    // UnexpectedError
    console.error(result.error);
    return res.status(500).json({ error: 'Internal error' });
}
```

## With retries and visualization

```typescript
import { createVisualizer } from 'awaitly/visualize';

const viz = createVisualizer({ workflowName: 'checkout' });

const checkout = createWorkflow(deps, {
  onEvent: viz.handleEvent,
});

const result = await checkout(async (step) => {
  const validItems = await step(
    () => validateCart(cartItems),
    { name: 'Validate cart' }
  );

  const availableItems = await step(
    () => checkInventory(validItems),
    { name: 'Check inventory' }
  );

  const total = await step(
    () => calculateTotal(availableItems),
    { name: 'Calculate total' }
  );

  // Retry payment with exponential backoff
  const payment = await step.retry(
    () => processPayment(total, paymentMethodId),
    {
      attempts: 3,
      backoff: 'exponential',
      delayMs: 500,
      retryOn: (error) => error === 'PAYMENT_ERROR', // Don't retry declined
    }
  );

  const order = await step(
    () => createOrder(availableItems, payment),
    { name: 'Create order' }
  );

  return order;
});

// Log visualization
console.log(viz.render());
```

## With idempotency

Use keys to make the workflow resumable:

```typescript
const result = await checkout(async (step) => {
  const validItems = await step(
    () => validateCart(cartItems),
    { key: `validate:${sessionId}` }
  );

  const availableItems = await step(
    () => checkInventory(validItems),
    { key: `inventory:${sessionId}` }
  );

  const total = await step(
    () => calculateTotal(availableItems),
    { key: `total:${sessionId}` }
  );

  // Critical: payment with idempotency key
  const payment = await step(
    () => processPayment(total, paymentMethodId),
    { key: `payment:${idempotencyKey}` }
  );

  const order = await step(
    () => createOrder(availableItems, payment),
    { key: `order:${idempotencyKey}` }
  );

  return order;
});
```

If the workflow crashes after payment but before order creation, rerunning with the same `idempotencyKey` returns the cached payment instead of charging again.
