# Testing

Deterministic workflow testing with scripted outcomes, mock functions, and assertion helpers. Test your workflows without network calls or external dependencies.

## Table of Contents

- [Overview](#overview)
- [Test Harness](#test-harness)
- [Scripting Outcomes](#scripting-outcomes)
- [Mock Functions](#mock-functions)
- [Assertions](#assertions)
- [Snapshot Testing](#snapshot-testing)
- [Test Utilities](#test-utilities)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)

## Overview

The testing module provides tools for deterministic workflow testing:

```typescript
import { createWorkflowHarness, okOutcome, errOutcome } from 'awaitly/testing';
import { ok, err } from 'awaitly';

// Create harness with your dependencies
const harness = createWorkflowHarness({ fetchUser, chargeCard });

// Script step outcomes
harness.script([
  okOutcome({ id: '1', name: 'Alice' }),    // fetchUser returns this
  okOutcome({ txId: 'tx_123' }),            // chargeCard returns this
]);

// Run workflow with mocked steps
const result = await harness.run(async (step, { fetchUser, chargeCard }) => {
  const user = await step(() => fetchUser('1'), 'fetch-user');
  const charge = await step(() => chargeCard(100), 'charge-card');
  return { user, charge };
});

// Assert
expect(result.ok).toBe(true);
harness.assertSteps(['fetch-user', 'charge-card']);
```

## Test Harness

### Creating a Harness

```typescript
import { createWorkflowHarness } from 'awaitly/testing';

const deps = {
  fetchUser: async (id: string) => ok({ id, name: 'Alice' }),
  chargeCard: async (amount: number) => ok({ txId: 'tx_123' }),
};

const harness = createWorkflowHarness(deps, {
  recordInvocations: true,  // Record step invocations (default: true)
  clock: Date.now,          // Custom clock for deterministic timing
});
```

### Running Workflows

```typescript
// Basic run
const result = await harness.run(async (step, deps) => {
  const user = await step(() => deps.fetchUser('1'), 'fetch-user');
  return user;
});

// Run with input
const result = await harness.runWithInput(
  { userId: '1', amount: 100 },
  async (step, deps, input) => {
    const user = await step(() => deps.fetchUser(input.userId));
    const charge = await step(() => deps.chargeCard(input.amount));
    return { user, charge };
  }
);
```

### Resetting Between Tests

```typescript
beforeEach(() => {
  harness.reset();  // Clear all state
});
```

## Scripting Outcomes

### Sequential Scripting

Script outcomes in order of step execution:

```typescript
import { okOutcome, errOutcome, throwOutcome } from 'awaitly/testing';

harness.script([
  okOutcome({ id: '1', name: 'Alice' }),     // First step returns this
  okOutcome({ txId: 'tx_123' }),             // Second step returns this
  errOutcome('EMAIL_FAILED'),                 // Third step returns this error
]);
```

### Named Step Scripting

Script specific steps by name or key:

```typescript
// Script by step name
harness.scriptStep('fetch-user', okOutcome({ id: '1', name: 'Alice' }));
harness.scriptStep('charge-card', errOutcome('CARD_DECLINED'));

// Named steps override sequential order
harness.script([
  okOutcome('default1'),
  okOutcome('default2'),
]);
harness.scriptStep('fetch-user', okOutcome('specific'));  // This overrides

const result = await harness.run(async (step) => {
  const user = await step(() => deps.fetchUser('1'), 'fetch-user');  // Gets 'specific'
  const other = await step(() => deps.other(), 'other');             // Gets 'default1'
  return { user, other };
});
```

### Outcome Types

```typescript
import { okOutcome, errOutcome, throwOutcome } from 'awaitly/testing';

// Success outcome
okOutcome({ id: '1', name: 'Alice' })

// Error outcome (Result error)
errOutcome('USER_NOT_FOUND')
errOutcome({ type: 'VALIDATION_ERROR', field: 'email' })

// Throw outcome (simulates thrown exception)
throwOutcome(new Error('Network timeout'))
```

### No Scripted Outcome

If no outcome is scripted, the real operation runs:

```typescript
harness.script([
  okOutcome({ id: '1' }),  // First step is mocked
  // Second step has no script - runs real operation
]);

const result = await harness.run(async (step, deps) => {
  const user = await step(() => deps.fetchUser('1'));     // Returns scripted
  const data = await step(() => deps.fetchData());        // Runs real operation
  return { user, data };
});
```

## Mock Functions

### Creating Mock Functions

```typescript
import { createMockFn, ok, err } from 'awaitly/testing';

const fetchUser = createMockFn<User, 'NOT_FOUND'>();

// Set default return
fetchUser.returns(ok({ id: '1', name: 'Alice' }));

// Queue return values
fetchUser.returnsOnce(ok({ id: '1', name: 'Alice' }));
fetchUser.returnsOnce(ok({ id: '2', name: 'Bob' }));
fetchUser.returnsOnce(err('NOT_FOUND'));

// Use in deps
const deps = { fetchUser };
const harness = createWorkflowHarness(deps);
```

### Inspecting Calls

```typescript
const fetchUser = createMockFn<User, 'NOT_FOUND'>();
fetchUser.returns(ok({ id: '1', name: 'Alice' }));

await harness.run(async (step, { fetchUser }) => {
  await step(() => fetchUser('user-1'));
  await step(() => fetchUser('user-2'));
});

// Inspect calls
expect(fetchUser.getCallCount()).toBe(2);
expect(fetchUser.getCalls()).toEqual([
  ['user-1'],
  ['user-2'],
]);
```

### Resetting Mocks

```typescript
fetchUser.reset();  // Clears calls and return values
```

## Assertions

### Assert Step Order

```typescript
const result = harness.assertSteps(['fetch-user', 'validate', 'charge-card']);
if (!result.passed) {
  console.log(result.message);  // "Expected steps [fetch-user, validate, charge-card] but got [fetch-user, charge-card]"
  console.log(result.expected); // ['fetch-user', 'validate', 'charge-card']
  console.log(result.actual);   // ['fetch-user', 'charge-card']
}
```

### Assert Step Called / Not Called

```typescript
// Assert step was called
const called = harness.assertStepCalled('send-email');
expect(called.passed).toBe(true);

// Assert step was NOT called
const notCalled = harness.assertStepNotCalled('refund-payment');
expect(notCalled.passed).toBe(true);
```

### Assert Result

```typescript
import { ok, err } from 'awaitly';

const result = await harness.run(/* ... */);

const assertion = harness.assertResult(result, ok({ id: '1', name: 'Alice' }));
expect(assertion.passed).toBe(true);

// Or for errors
const assertion = harness.assertResult(result, err('USER_NOT_FOUND'));
```

### Get Invocations

```typescript
const invocations = harness.getInvocations();

for (const inv of invocations) {
  console.log({
    name: inv.name,           // Step name
    key: inv.key,             // Step key
    order: inv.order,         // 0-indexed invocation order
    timestamp: inv.timestamp, // When invoked
    durationMs: inv.durationMs,
    result: inv.result,       // Result<T, E>
    cached: inv.cached,       // Was from cache?
  });
}
```

## Snapshot Testing

### Creating Snapshots

```typescript
import { createSnapshot, compareSnapshots } from 'awaitly/testing';

// Create snapshot after run
const invocations = harness.getInvocations();
const result = await harness.run(/* ... */);

const snapshot = createSnapshot(invocations, result);

// Compare with previous snapshot
const comparison = compareSnapshots(previousSnapshot, snapshot);
if (!comparison.equal) {
  console.log('Differences:', comparison.differences);
}
```

### Snapshot Structure

```typescript
interface WorkflowSnapshot {
  invocations: StepInvocation[];  // Step invocations (timestamps normalized)
  result: Result<unknown, unknown>;
  events?: WorkflowEvent<unknown>[];
  durationMs?: number;
}
```

## Test Utilities

### Deterministic Clock

```typescript
import { createTestClock } from 'awaitly/testing';

const clock = createTestClock(0);  // Start at time 0

const harness = createWorkflowHarness(deps, { clock: clock.now });

// Control time in tests
clock.advance(1000);  // Advance 1 second
clock.set(5000);      // Set to specific time
clock.reset();        // Reset to start time
```

### Outcome Helpers

```typescript
import { okOutcome, errOutcome, throwOutcome } from 'awaitly/testing';

// Type-safe outcome creation
const userOutcome = okOutcome<User>({ id: '1', name: 'Alice' });
const errorOutcome = errOutcome<'NOT_FOUND'>('NOT_FOUND');
const throwable = throwOutcome(new Error('Network error'));
```

## Best Practices

### 1. Test Happy Path First

```typescript
describe('checkout workflow', () => {
  it('completes successfully with valid inputs', async () => {
    harness.script([
      okOutcome({ id: '1', name: 'Alice' }),
      okOutcome({ txId: 'tx_123' }),
      okOutcome({ emailId: 'email_456' }),
    ]);

    const result = await harness.run(checkoutWorkflow);

    expect(result.ok).toBe(true);
    harness.assertSteps(['fetch-user', 'charge-card', 'send-email']);
  });
});
```

### 2. Test Each Error Path

```typescript
it('handles user not found', async () => {
  harness.script([
    errOutcome('USER_NOT_FOUND'),
  ]);

  const result = await harness.run(checkoutWorkflow);

  expect(result.ok).toBe(false);
  expect(result.error).toBe('USER_NOT_FOUND');
  harness.assertStepNotCalled('charge-card');  // Should not proceed
});

it('handles card declined', async () => {
  harness.script([
    okOutcome({ id: '1', name: 'Alice' }),
    errOutcome('CARD_DECLINED'),
  ]);

  const result = await harness.run(checkoutWorkflow);

  expect(result.ok).toBe(false);
  expect(result.error).toBe('CARD_DECLINED');
  harness.assertStepNotCalled('send-email');  // Should not proceed
});
```

### 3. Test Conditional Branches

```typescript
it('skips premium features for regular users', async () => {
  harness.script([
    okOutcome({ id: '1', name: 'Alice', isPremium: false }),
  ]);

  const result = await harness.run(userDashboard);

  expect(result.ok).toBe(true);
  harness.assertStepNotCalled('fetch-premium-features');
});

it('includes premium features for premium users', async () => {
  harness.script([
    okOutcome({ id: '1', name: 'Alice', isPremium: true }),
    okOutcome({ features: ['advanced-analytics'] }),
  ]);

  const result = await harness.run(userDashboard);

  expect(result.ok).toBe(true);
  harness.assertStepCalled('fetch-premium-features');
});
```

### 4. Reset Between Tests

```typescript
describe('workflow tests', () => {
  const harness = createWorkflowHarness(deps);

  beforeEach(() => {
    harness.reset();
  });

  // Tests are isolated
});
```

### 5. Use Named Steps for Clarity

```typescript
// In workflow
const user = await step(() => fetchUser(id), { name: 'fetch-user' });
const payment = await step(() => chargeCard(amount), { name: 'charge-card' });

// In tests
harness.assertSteps(['fetch-user', 'charge-card']);
harness.assertStepCalled('fetch-user');
```

## API Reference

### Functions

| Function | Description |
|----------|-------------|
| `createWorkflowHarness(deps, options?)` | Create a test harness |
| `createMockFn<T, E>()` | Create a mock Result function |
| `createSnapshot(invocations, result, events?)` | Create workflow snapshot |
| `compareSnapshots(a, b)` | Compare two snapshots |
| `createTestClock(startTime?)` | Create deterministic clock |
| `okOutcome<T>(value)` | Create success outcome |
| `errOutcome<E>(error)` | Create error outcome |
| `throwOutcome(error)` | Create throw outcome |

### WorkflowHarness Methods

| Method | Description |
|--------|-------------|
| `script(outcomes)` | Script sequential outcomes |
| `scriptStep(nameOrKey, outcome)` | Script named step outcome |
| `run(fn)` | Run workflow with scripted outcomes |
| `runWithInput(input, fn)` | Run workflow with input |
| `getInvocations()` | Get recorded invocations |
| `assertSteps(names)` | Assert step order |
| `assertStepCalled(nameOrKey)` | Assert step was called |
| `assertStepNotCalled(nameOrKey)` | Assert step wasn't called |
| `assertResult(result, expected)` | Assert result matches |
| `reset()` | Clear all state |

### MockFunction Methods

| Method | Description |
|--------|-------------|
| `returns(result)` | Set default return value |
| `returnsOnce(result)` | Queue return value |
| `getCalls()` | Get call arguments |
| `getCallCount()` | Get call count |
| `reset()` | Reset mock state |

### Types

```typescript
type ScriptedOutcome<T, E> =
  | { type: 'ok'; value: T }
  | { type: 'err'; error: E }
  | { type: 'throw'; error: unknown };

interface StepInvocation {
  name?: string;
  key?: string;
  order: number;
  timestamp: number;
  durationMs?: number;
  result?: Result<unknown, unknown>;
  cached?: boolean;
}

interface AssertionResult {
  passed: boolean;
  message: string;
  expected?: unknown;
  actual?: unknown;
}
```
