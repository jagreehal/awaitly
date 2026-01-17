---
title: Workflows
description: createWorkflow vs run() and when to use each
---

There are two ways to run workflows: `createWorkflow` for reusable workflows with dependency inference, and `run` for one-off operations.

## createWorkflow

Creates a reusable workflow with automatic error type inference from dependencies:

```typescript
import { createWorkflow, ok, err, type AsyncResult } from 'awaitly';

const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => { ... };
const sendEmail = async (to: string): AsyncResult<void, 'EMAIL_FAILED'> => { ... };

// Error types inferred from dependencies
const workflow = createWorkflow({ fetchUser, sendEmail });

const result = await workflow(async (step) => {
  const user = await step(fetchUser('1'));
  await step(sendEmail(user.email));
  return user;
});
// result.error is: 'NOT_FOUND' | 'EMAIL_FAILED' | UnexpectedError
```

### With options

```typescript
const workflow = createWorkflow(
  { fetchUser, sendEmail },
  {
    cache: new Map(),                    // Enable step caching
    onEvent: (event) => console.log(event), // Event stream
    strict: true,                        // Force explicit error handling
  }
);
```

## run()

For one-off workflows where you specify error types manually:

```typescript
import { run } from 'awaitly';

const result = await run<User, 'NOT_FOUND' | 'EMAIL_FAILED'>(
  async (step) => {
    const user = await step(fetchUser('1'));
    await step(sendEmail(user.email));
    return user;
  }
);
```

## When to use each

| Scenario | Use |
|----------|-----|
| Dependencies known at compile time | `createWorkflow` |
| Dependencies passed as parameters | `run` |
| Need step caching or resume | `createWorkflow` |
| Need automatic error inference | `createWorkflow` |
| One-off workflow | `run` |
| Testing with mocks | `run` |

## Workflow options

### cache

Enable step caching to avoid re-executing completed steps:

```typescript
const workflow = createWorkflow(deps, {
  cache: new Map(),
});

const result = await workflow(async (step) => {
  // This step runs once, even if workflow is called multiple times
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  return user;
});
```

### resumeState

Resume a workflow from saved state:

```typescript
const workflow = createWorkflow(deps, {
  resumeState: savedState, // From a previous run
});

const result = await workflow(async (step) => {
  // Cached steps return their saved values
  const user = await step(() => fetchUser('1'), { key: 'user:1' });
  return user;
});
```

See [Persistence](/workflow/guides/persistence/) for details.

### onEvent

Subscribe to workflow events for logging, visualization, or debugging:

```typescript
const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    switch (event.type) {
      case 'step_start':
        console.log('Starting:', event.name);
        break;
      case 'step_complete':
        console.log('Completed:', event.name, event.durationMs, 'ms');
        break;
      case 'step_error':
        console.error('Failed:', event.name, event.error);
        break;
    }
  },
});
```

### strict

Force explicit handling of unexpected errors:

```typescript
const workflow = createWorkflow(deps, {
  strict: true,
  catchUnexpected: (thrown) => ({
    type: 'UNEXPECTED' as const,
    message: String(thrown),
  }),
});
```

## Composing workflows

Workflows are just functions. Compose them naturally:

```typescript
const validateInput = createWorkflow({ validateEmail, validatePassword });
const processPayment = createWorkflow({ chargeCard, saveReceipt });

const checkout = createWorkflow({
  validateEmail,
  validatePassword,
  chargeCard,
  saveReceipt,
});

const result = await checkout(async (step) => {
  // Use steps from all dependencies
  await step(validateEmail(input.email));
  await step(validatePassword(input.password));
  await step(chargeCard(input.amount));
  await step(saveReceipt(input.orderId));
});
```

## Context

Pass context through workflow execution:

```typescript
const workflow = createWorkflow(deps);

const result = await workflow(
  async (step, context) => {
    console.log('User ID:', context.userId);
    const user = await step(fetchUser(context.userId));
    return user;
  },
  { context: { userId: '123', requestId: 'abc' } }
);
```

## Next

[Learn about Tagged Errors →](/workflow/concepts/tagged-errors/)
