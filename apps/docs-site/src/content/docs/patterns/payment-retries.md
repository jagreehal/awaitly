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

Use step keys and a **resume state** collector to make the workflow resumable:

```typescript
import { createWorkflow, createResumeStateCollector } from 'awaitly/workflow';
import { postgres } from 'awaitly-postgres';

const store = postgres(process.env.DATABASE_URL!);
const collector = createResumeStateCollector();

const workflow = createWorkflow('workflow', { validateCard,
  chargeProvider,
  persistResult,
}, { onEvent: collector.handleEvent });

const result = await workflow.run(async ({ step }) => {
  // Validate - can retry safely
  const card = await step(
    'validateCard',
    () => validateCard(input),
    { key: `validate:${orderId}` }
  );

  // CRITICAL: This step must not repeat
  const charge = await step(
    'chargeProvider',
    () => chargeProvider(card, amount),
    { key: `charge:${idempotencyKey}` }
  );

  // Persist - if this fails, we can resume
  await step(
    'persistResult',
    () => persistResult(charge),
    { key: `persist:${charge.id}` }
  );

  return { paymentId: charge.id };
});
```

## Save state after each run

```typescript
// Always save snapshot (success or failure)
await store.save(idempotencyKey, collector.getResumeState());
```

## Crash recovery

If the workflow crashes after charging but before persisting:

```typescript
// On restart, load existing state
const savedState = await store.load(idempotencyKey);

if (savedState) {
  const collector = createResumeStateCollector();
  const workflow = createWorkflow('workflow', deps, { onEvent: collector.handleEvent });

  const result = await workflow.run(async ({ step }) => {
    const card = await step(
      'validateCard',
      () => validateCard(input),
      { key: `validate:${orderId}` }
    ); // Cache hit

    const charge = await step(
      'chargeProvider',
      () => chargeProvider(card, amount),
      { key: `charge:${idempotencyKey}` }
    ); // Cache hit - returns previous charge

    await step(
      'persistResult',
      () => persistResult(charge),
      { key: `persist:${charge.id}` }
    ); // Runs fresh

    return { paymentId: charge.id };
  }, { resumeState: savedState });
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
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow, createResumeStateCollector } from 'awaitly/workflow';
import { postgres } from 'awaitly-postgres';

const store = postgres(process.env.DATABASE_URL!);

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

async function handlePayment(orderId: string, cardToken: string, amount: number) {
  const idempotencyKey = `payment:${orderId}`;
  const savedState = await store.load(idempotencyKey);
  const collector = createResumeStateCollector();

  const workflow = createWorkflow('workflow', { validateCard, chargeProvider, persistResult },
    { onEvent: collector.handleEvent }
  );

  const result = await workflow.run(async ({ step }) => {
    const card = await step('validateCard', () => validateCard(cardToken), {
      key: `validate:${orderId}`,
    });

    const charge = await step('chargeProvider', () => chargeProvider(card, amount), {
      key: `charge:${idempotencyKey}`,
    });

    await step('persistResult', () => persistResult(charge), {
      key: `persist:${charge.id}`,
    });

    return { chargeId: charge.id };
  }, { resumeState: savedState ?? undefined });

  await store.save(idempotencyKey, collector.getResumeState());
  return result;
}
```

## Key takeaways

1. **Use idempotency keys** for payment operations
2. **Save state** after every run (success or failure)
3. **Resume with saved state** on retry
4. **Cached steps return previous results** without re-executing
