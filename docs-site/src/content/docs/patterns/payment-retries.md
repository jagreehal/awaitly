---
title: Safe Payment Retries
description: Avoid double-charging with idempotent payment workflows
---

The scariest failure mode in payments: **charge succeeded, but persistence failed**. If you retry naively, you charge the customer twice.

## The problem

```typescript
// DANGEROUS: No idempotency
async function processPayment(order: Order) {
  const charge = await paymentProvider.charge(order.total); // Succeeds

  await db.orders.update(order.id, { paymentId: charge.id }); // Fails!

  // Retry? You'll charge again
}
```

## The solution

Use step keys and persistence to make the workflow resumable:

```typescript
import {
  createWorkflow,
  createStepCollector,
  stringifyState,
  parseState,
} from 'awaitly';

const processPayment = createWorkflow({
  validateCard,
  chargeProvider,
  persistResult,
});

// Collect state for persistence
const collector = createStepCollector();

const workflow = createWorkflow(deps, {
  onEvent: collector.handleEvent,
});

const result = await workflow(async (step) => {
  // Validate - can retry safely
  const card = await step(
    () => validateCard(input),
    { key: `validate:${orderId}` }
  );

  // CRITICAL: This step must not repeat
  const charge = await step(
    () => chargeProvider(card, amount),
    { key: `charge:${idempotencyKey}` }
  );

  // Persist - if this fails, we can resume
  await step(
    () => persistResult(charge),
    { key: `persist:${charge.id}` }
  );

  return { paymentId: charge.id };
});
```

## Save state after each run

```typescript
// Always save state (success or failure)
const state = collector.getState();
const json = stringifyState(state, { orderId });

await db.workflowStates.upsert({
  where: { idempotencyKey },
  update: { state: json, updatedAt: new Date() },
  create: { idempotencyKey, state: json },
});
```

## Crash recovery

If the workflow crashes after charging but before persisting:

```typescript
// On restart, check for existing state
const saved = await db.workflowStates.findUnique({
  where: { idempotencyKey },
});

if (saved) {
  // Resume from saved state
  const resumeState = parseState(saved.state);

  const workflow = createWorkflow(deps, { resumeState });

  const result = await workflow(async (step) => {
    const card = await step(
      () => validateCard(input),
      { key: `validate:${orderId}` }
    ); // Cache hit

    const charge = await step(
      () => chargeProvider(card, amount),
      { key: `charge:${idempotencyKey}` }
    ); // Cache hit - returns previous charge

    await step(
      () => persistResult(charge),
      { key: `persist:${charge.id}` }
    ); // Runs fresh

    return { paymentId: charge.id };
  });
}
```

The charge step returns its cached result. No double-billing.

## Idempotency key design

Generate a unique key per payment attempt:

```typescript
// Good: Stable across retries
const idempotencyKey = `order:${orderId}:attempt:${attemptNumber}`;

// Good: Based on cart contents
const idempotencyKey = `cart:${hashCart(items)}:user:${userId}`;

// Bad: Changes every call
const idempotencyKey = `payment:${Date.now()}`;
```

## Full example

```typescript
import {
  createWorkflow,
  createStepCollector,
  stringifyState,
  parseState,
  ok,
  err,
  type AsyncResult,
} from 'awaitly';

const validateCard = async (
  cardToken: string
): AsyncResult<Card, 'INVALID_CARD'> => {
  const card = await stripe.tokens.retrieve(cardToken);
  return card ? ok(card) : err('INVALID_CARD');
};

const chargeProvider = async (
  card: Card,
  amount: number
): AsyncResult<Charge, 'DECLINED' | 'PROVIDER_ERROR'> => {
  try {
    const charge = await stripe.charges.create({
      amount,
      source: card.id,
    });
    return ok(charge);
  } catch (e) {
    if (e.code === 'card_declined') return err('DECLINED');
    return err('PROVIDER_ERROR');
  }
};

const persistResult = async (
  charge: Charge
): AsyncResult<void, 'DB_ERROR'> => {
  try {
    await db.payments.create({
      chargeId: charge.id,
      amount: charge.amount,
      status: 'completed',
    });
    return ok(undefined);
  } catch {
    return err('DB_ERROR');
  }
};

// Main function
async function handlePayment(orderId: string, cardToken: string, amount: number) {
  const idempotencyKey = `payment:${orderId}`;

  // Check for existing attempt
  const existing = await db.workflowStates.findUnique({
    where: { id: idempotencyKey },
  });

  const collector = createStepCollector();
  const resumeState = existing ? parseState(existing.state) : undefined;

  const workflow = createWorkflow(
    { validateCard, chargeProvider, persistResult },
    {
      resumeState,
      onEvent: collector.handleEvent,
    }
  );

  const result = await workflow(async (step) => {
    const card = await step(() => validateCard(cardToken), {
      key: `validate:${orderId}`,
    });

    const charge = await step(() => chargeProvider(card, amount), {
      key: `charge:${idempotencyKey}`,
    });

    await step(() => persistResult(charge), {
      key: `persist:${charge.id}`,
    });

    return { chargeId: charge.id };
  });

  // Always save state
  const state = collector.getState();
  await db.workflowStates.upsert({
    where: { id: idempotencyKey },
    update: { state: stringifyState(state), updatedAt: new Date() },
    create: { id: idempotencyKey, state: stringifyState(state) },
  });

  return result;
}
```

## Key takeaways

1. **Use idempotency keys** for payment operations
2. **Save state** after every run (success or failure)
3. **Resume with saved state** on retry
4. **Cached steps return previous results** without re-executing
