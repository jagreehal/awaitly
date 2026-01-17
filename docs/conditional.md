# Conditional Execution

Execute workflow steps conditionally based on runtime conditions. When steps are skipped, proper events are emitted for visualization and debugging.

## Table of Contents

- [Overview](#overview)
- [Basic Conditionals](#basic-conditionals)
- [Conditionals with Defaults](#conditionals-with-defaults)
- [Event Emission](#event-emission)
- [Workflow Integration](#workflow-integration)
- [API Reference](#api-reference)

## Overview

The conditional helpers let you skip steps based on runtime conditions while maintaining proper event tracking:

```typescript
import { when, unless, whenOr, unlessOr } from 'awaitly/conditional';

const result = await workflow(async (step) => {
  const user = await step(fetchUser(id));

  // Only runs if user is premium
  const premium = await when(
    user.isPremium,
    () => step(fetchPremiumData(user.id)),
    { name: 'premium-data' }
  );

  return { user, premium };  // premium is undefined if not premium
});
```

## Basic Conditionals

### when - Execute if True

```typescript
import { when } from 'awaitly/conditional';

// Returns value if condition is true, undefined if false
const result = await when(
  condition,
  () => someOperation(),
  { name: 'optional-step', reason: 'User is not premium' }
);

if (result !== undefined) {
  // Operation ran
} else {
  // Operation was skipped
}
```

**Example:**

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser(id));

  // Only fetch premium features for premium users
  const premiumFeatures = await when(
    user.isPremium,
    () => step(fetchPremiumFeatures(user.id), { name: 'premium-features' }),
    { name: 'check-premium', reason: 'User is not premium' }
  );

  return {
    user,
    features: premiumFeatures ?? [],  // Default to empty array
  };
});
```

### unless - Execute if False

```typescript
import { unless } from 'awaitly/conditional';

// Returns value if condition is false, undefined if true
const result = await unless(
  condition,
  () => someOperation(),
  { name: 'optional-step', reason: 'User is already verified' }
);
```

**Example:**

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser(id));

  // Only send verification email if NOT already verified
  const verification = await unless(
    user.isVerified,
    () => step(sendVerificationEmail(user.email), { name: 'send-verification' }),
    { name: 'check-verification', reason: 'User is already verified' }
  );

  return { user, verification };
});
```

## Conditionals with Defaults

### whenOr - Execute if True, Default Otherwise

```typescript
import { whenOr } from 'awaitly/conditional';

// Returns value if true, defaultValue if false
const result = await whenOr(
  condition,
  () => someOperation(),
  defaultValue,
  { name: 'optional-step' }
);
```

**Example:**

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser(id));

  // Get premium limits or use default limits
  const limits = await whenOr(
    user.isPremium,
    () => step(fetchPremiumLimits(user.id), { name: 'premium-limits' }),
    { maxRequests: 100, maxStorage: 1000 },  // Default for non-premium
    { name: 'check-limits', reason: 'Using default limits for non-premium user' }
  );

  return { user, limits };  // Always has limits, never undefined
});
```

### unlessOr - Execute if False, Default Otherwise

```typescript
import { unlessOr } from 'awaitly/conditional';

// Returns value if false, defaultValue if true
const result = await unlessOr(
  condition,
  () => someOperation(),
  defaultValue,
  { name: 'optional-step' }
);
```

**Example:**

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser(id));

  // Generate new token if NOT authenticated, use existing otherwise
  const token = await unlessOr(
    user.isAuthenticated,
    () => step(generateNewToken(user.id), { name: 'generate-token' }),
    user.existingToken,  // Use existing token if authenticated
    { name: 'check-auth', reason: 'Using existing token for authenticated user' }
  );

  return { user, token };
});
```

## Event Emission

### Setting Up Event Context

To emit `step_skipped` events, provide a context:

```typescript
import { when, createConditionalHelpers } from 'awaitly/conditional';

// Option 1: Pass context to each call
const ctx = {
  workflowId: 'wf_123',
  onEvent: (event) => console.log(event),
};

await when(
  condition,
  () => operation(),
  { name: 'step-name' },
  ctx  // Fourth parameter
);

// Option 2: Create bound helpers
const { when, unless, whenOr, unlessOr } = createConditionalHelpers(ctx);

await when(condition, () => operation(), { name: 'step-name' });
// Events automatically emitted
```

### step_skipped Event

When a step is skipped, this event is emitted:

```typescript
{
  type: 'step_skipped',
  workflowId: 'wf_123',
  stepKey: 'premium-features',   // From options.key
  name: 'check-premium',         // From options.name
  reason: 'User is not premium', // From options.reason
  decisionId: 'decision_...',    // Unique decision ID
  ts: 1699123456789,
  context: { /* workflow context if provided */ }
}
```

### Using with createWorkflow

```typescript
import { createWorkflow } from 'awaitly';
import { createConditionalHelpers } from 'awaitly/conditional';

const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    if (event.type === 'step_skipped') {
      console.log(`Skipped: ${event.name} - ${event.reason}`);
    }
  },
});

const result = await workflow(async (step, deps) => {
  const ctx = {
    workflowId: 'wf_123',
    onEvent: workflow.onEvent,
  };
  const { when, whenOr } = createConditionalHelpers(ctx);

  const user = await step(deps.fetchUser(id));

  const premium = await when(
    user.isPremium,
    () => step(deps.fetchPremiumData(user.id)),
    { name: 'premium-data', reason: 'User not premium' }
  );

  return { user, premium };
});
```

## Workflow Integration

### Common Patterns

**Feature Flags:**

```typescript
const { when } = createConditionalHelpers(ctx);

const result = await workflow(async (step) => {
  const features = await when(
    featureFlags.newCheckoutEnabled,
    () => step(newCheckoutFlow()),
    { name: 'new-checkout', reason: 'Feature flag disabled' }
  );

  return features ?? await step(legacyCheckoutFlow());
});
```

**User Tiers:**

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser(id));

  const analytics = await whenOr(
    user.tier === 'enterprise',
    () => step(fetchAdvancedAnalytics(user.id)),
    { basic: true },  // Default for non-enterprise
    { name: 'analytics' }
  );

  return { user, analytics };
});
```

**Validation Shortcuts:**

```typescript
const result = await workflow(async (step) => {
  const cached = await step(getFromCache(key));

  // Skip fetch if we have cached data
  const data = await unlessOr(
    cached !== null,
    () => step(fetchFromApi(id)),
    cached,  // Use cached value
    { name: 'fetch-data', reason: 'Using cached data' }
  );

  return data;
});
```

**A/B Testing:**

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser(id));
  const variant = await step(getABVariant(user.id, 'checkout-v2'));

  const checkout = await whenOr(
    variant === 'treatment',
    () => step(newCheckout(user)),
    await step(originalCheckout(user)),  // Control
    { name: 'ab-checkout', reason: `User in ${variant} group` }
  );

  return checkout;
});
```

## API Reference

### Functions

| Function | Description | Returns |
|----------|-------------|---------|
| `when(condition, operation, options?, ctx?)` | Execute if true | `T \| undefined` |
| `unless(condition, operation, options?, ctx?)` | Execute if false | `T \| undefined` |
| `whenOr(condition, operation, default, options?, ctx?)` | Execute if true, else default | `T \| D` |
| `unlessOr(condition, operation, default, options?, ctx?)` | Execute if false, else default | `T \| D` |
| `createConditionalHelpers(ctx)` | Create bound helpers | Object with all helpers |

### ConditionalOptions

```typescript
interface ConditionalOptions {
  /** Human-readable name for the step */
  name?: string;
  /** Stable identity key */
  key?: string;
  /** Reason for skipping (in events) */
  reason?: string;
}
```

### ConditionalContext

```typescript
interface ConditionalContext<C = unknown> {
  /** Workflow ID for event emission */
  workflowId: string;
  /** Event emitter function */
  onEvent?: (event: WorkflowEvent<unknown, C>) => void;
  /** Optional context for events */
  context?: C;
}
```

### Return Type Summary

| Function | Condition True | Condition False |
|----------|---------------|-----------------|
| `when` | Operation result | `undefined` |
| `unless` | `undefined` | Operation result |
| `whenOr` | Operation result | Default value |
| `unlessOr` | Default value | Operation result |
