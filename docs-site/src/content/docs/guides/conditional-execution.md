---
title: Conditional Execution
description: Conditionally execute steps with when/unless helpers
---

Execute steps only when certain conditions are met, with automatic event emission for skipped steps.

## Basic usage

```typescript
import { when, unless, createWorkflow, ok, err, type AsyncResult } from 'awaitly';

const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
  // ...
};

const sendEmail = async (to: string): AsyncResult<void, 'SEND_FAILED'> => {
  // ...
};

const workflow = createWorkflow({ fetchUser, sendEmail });

const result = await workflow(async (step) => {
  const user = await step(fetchUser('123'));

  // Only send email if user is not verified
  await when(
    !user.isVerified,
    () => step(sendEmail(user.email)),
    { name: 'send-verification', reason: 'User is already verified' }
  );

  return user;
});
```

## when - Execute if condition is true

Run a step only when a condition is true. Returns `undefined` if skipped.

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser('123'));

  // Only fetch premium data if user is premium
  const premium = await when(
    user.isPremium,
    () => step(fetchPremiumData(user.id)),
    { name: 'premium-data', reason: 'User is not premium' }
  );

  return { user, premium }; // premium is User | undefined
});
```

## unless - Execute if condition is false

Run a step only when a condition is false. Returns `undefined` if skipped.

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser('123'));

  // Only send verification email if user is NOT verified
  const email = await unless(
    user.isVerified,
    () => step(sendVerificationEmail(user.email)),
    { name: 'send-verification', reason: 'User is already verified' }
  );

  return { user, email }; // email is void | undefined
});
```

## whenOr - Execute if true, else return default

Run a step if condition is true, otherwise return a default value.

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser('123'));

  // Get premium limits or use default for non-premium users
  const limits = await whenOr(
    user.isPremium,
    () => step(fetchPremiumLimits(user.id)),
    { maxRequests: 100, maxStorage: 1000 }, // default
    { name: 'premium-limits', reason: 'Using default limits' }
  );

  return { user, limits }; // limits is PremiumLimits | DefaultLimits
});
```

## unlessOr - Execute if false, else return default

Run a step if condition is false, otherwise return a default value.

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser('123'));

  // Generate new token if NOT authenticated, else use existing
  const token = await unlessOr(
    user.isAuthenticated,
    () => step(generateNewToken(user.id)),
    user.existingToken, // default
    { name: 'token-generation', reason: 'Using existing token' }
  );

  return { user, token };
});
```

## Event emission

Conditional helpers automatically emit `step_skipped` events when steps are skipped:

```typescript
const workflow = createWorkflow({ fetchUser }, {
  onEvent: (event) => {
    if (event.type === 'step_skipped') {
      console.log(`Step ${event.name} skipped: ${event.reason}`);
      // event.decisionId - unique ID for this decision
    }
  }
});
```

## With workflow context

Use `createConditionalHelpers` to bind helpers to workflow context for automatic event emission:

```typescript
import { createConditionalHelpers } from 'awaitly';

const workflow = createWorkflow({ fetchUser }, {
  onEvent: (event, ctx) => {
    // ctx is available here
  }
});

const result = await workflow(async (step, deps, args, ctx) => {
  // Create bound helpers
  const { when, whenOr } = createConditionalHelpers({
    workflowId: ctx.workflowId,
    onEvent: (e) => {
      // Events automatically include context
    },
    context: ctx
  });

  const user = await step(fetchUser('123'));

  // Helpers automatically emit events with context
  const premium = await when(
    user.isPremium,
    () => step(fetchPremiumData(user.id)),
    { name: 'premium-data' }
  );

  return { user, premium };
});
```

## With run()

When using `run()`, pass context manually:

```typescript
import { run } from 'awaitly';
import { createConditionalHelpers } from 'awaitly';

const result = await run(async (step) => {
  const ctx = {
    workflowId: 'workflow-123',
    onEvent: (event) => {
      // Handle events
    },
    context: { requestId: 'req-456' }
  };

  const { when } = createConditionalHelpers(ctx);

  const user = await step(fetchUser('123'));

  const premium = await when(
    user.isPremium,
    () => step(fetchPremiumData(user.id)),
    { name: 'premium-data' }
  );

  return { user, premium };
}, {
  onEvent: ctx.onEvent,
  workflowId: ctx.workflowId,
  context: ctx.context
});
```

## Options

All conditional helpers accept an optional `ConditionalOptions` object:

```typescript
{
  name?: string;      // Human-readable name for the step
  key?: string;       // Stable identity key for caching/tracking
  reason?: string;    // Explanation for why step was skipped
}
```

## Visualization

Skipped steps appear in workflow visualizations:

```typescript
import { createVisualizer } from 'awaitly/visualize';

const viz = createVisualizer();
const workflow = createWorkflow(deps, { onEvent: viz.handleEvent });

await workflow(async (step) => {
  const user = await step(fetchUser('123'));

  await when(
    user.isPremium,
    () => step(fetchPremiumData(user.id)),
    { name: 'premium-data', reason: 'Not premium' }
  );

  return user;
});

console.log(viz.render());
// Shows skipped step with reason
```

## Real-world example

```typescript
const processOrder = createWorkflow({ fetchOrder, chargeCard, sendEmail, applyDiscount });

const result = await processOrder(async (step) => {
  const order = await step(fetchOrder(orderId));

  // Apply discount only if order is large enough
  const discount = await whenOr(
    order.total > 100,
    () => step(applyDiscount(order.id, 'BULK_10')),
    0, // no discount
    { name: 'apply-discount', reason: 'Order too small for discount' }
  );

  // Charge card
  const payment = await step(chargeCard(order.total - discount));

  // Send confirmation email only if payment succeeded
  await when(
    payment.status === 'succeeded',
    () => step(sendEmail(order.email, 'Order confirmed')),
    { name: 'send-confirmation', reason: 'Payment failed' }
  );

  return { order, payment, discount };
});
```

## Next

[Learn about Testing →](/workflow/guides/testing/)
