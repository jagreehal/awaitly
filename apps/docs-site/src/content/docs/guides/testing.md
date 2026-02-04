---
title: Testing
description: Test workflows deterministically
---

Use the test harness to control step execution and verify workflow behavior.

This guide progresses through: **asserting results** → **basic workflow testing** → **advanced mocking** → **specialized testing** (time, sagas, events).

---

## Part 1: Asserting Results

**WHAT**: Type-safe utilities to assert and unwrap Result values in tests.

**WHY**: Vitest assertions don't narrow TypeScript types - these utilities do, making your tests type-safe.

### Result assertions

The `awaitly/testing` module provides type-safe assertion utilities that work seamlessly with TypeScript:

```typescript
import { unwrapOk, unwrapErr, expectOk, expectErr } from 'awaitly/testing';

// Most concise - unwrap returns the value directly
const user = unwrapOk(await fetchUser('123'));
expect(user.name).toBe('Alice');

// Check for expected errors
const error = unwrapErr(await fetchUser('unknown'));
expect(error).toBe('NOT_FOUND');

// Async variants for cleaner code
const user = await unwrapOkAsync(fetchUser('123'));
const error = await unwrapErrAsync(fetchUser('unknown'));
```

**Why use these instead of `expect(result.ok).toBe(true)`?**

Vitest assertions don't narrow TypeScript types. After `expect(result.ok).toBe(true)`, TypeScript still sees `result` as `Result<T, E>` - you can't safely access `result.value`. The `unwrap*` and `expect*` functions throw on failure AND narrow the type:

```typescript
// ❌ TypeScript error - result.value might not exist
const result = await fetchUser('123');
expect(result.ok).toBe(true);
expect(result.value.name).toBe('Alice'); // TS error!

// ✅ Works - expectOk narrows the type
const result = await fetchUser('123');
expectOk(result);
expect(result.value.name).toBe('Alice'); // TS knows result is Ok<T>

// ✅ Even cleaner with unwrapOk
const user = unwrapOk(await fetchUser('123'));
expect(user.name).toBe('Alice');
```

### API Reference

| Function | Description |
|----------|-------------|
| `expectOk(result)` | Asserts result is Ok, throws if Err. Narrows type. |
| `expectErr(result)` | Asserts result is Err, throws if Ok. Narrows type. |
| `unwrapOk(result)` | Asserts Ok and returns the value `T`. |
| `unwrapErr(result)` | Asserts Err and returns the error `E`. |
| `unwrapOkAsync(promise)` | Awaits, asserts Ok, returns value. |
| `unwrapErrAsync(promise)` | Awaits, asserts Err, returns error. |

---

## Part 2: Basic Workflow Testing

**WHAT**: Create test harnesses with scripted or dynamic outcomes to control what each step returns.

**WHY**: Test workflows deterministically without real dependencies - script success, failure, and edge cases.

### Basic testing

```typescript
import { createWorkflowHarness, okOutcome, errOutcome } from 'awaitly/testing';
import { unwrapOk, unwrapErr } from 'awaitly/testing';
import { describe, it, expect } from 'vitest';

describe('checkout workflow', () => {
  it('completes when payment succeeds', async () => {
    const harness = createWorkflowHarness({
      fetchOrder: okOutcome({ id: '123', total: 100 }),
      chargeCard: okOutcome({ txId: 'tx-123' }),
    });

    const result = await harness.run(async (step) => {
      const order = await step('fetchOrder', () => fetchOrder('123'));
      const payment = await step('chargeCard', () => chargeCard(order.total));
      return { order, payment };
    });

    const value = unwrapOk(result);
    expect(value.payment.txId).toBe('tx-123');
  });

  it('fails when payment is declined', async () => {
    const harness = createWorkflowHarness({
      fetchOrder: okOutcome({ id: '123', total: 100 }),
      chargeCard: errOutcome('DECLINED'),
    });

    const result = await harness.run(async (step) => {
      const order = await step('fetchOrder', () => fetchOrder('123'));
      const payment = await step('chargeCard', () => chargeCard(order.total));
      return { order, payment };
    });

    const error = unwrapErr(result);
    expect(error).toBe('DECLINED');
  });
});
```

### Scripted outcomes

Control what each step returns:

```typescript
const harness = createWorkflowHarness({
  // Always succeeds
  fetchUser: okOutcome({ id: '1', name: 'Alice' }),

  // Always fails
  sendEmail: errOutcome('EMAIL_FAILED'),

  // Throws exception
  badOperation: throwOutcome(new Error('Boom')),
});
```

### Dynamic outcomes

Return different results based on input:

```typescript
const harness = createWorkflowHarness({
  fetchUser: (id: string) =>
    id === '1'
      ? okOutcome({ id, name: 'Alice' })
      : errOutcome('NOT_FOUND'),
});
```

---

## Part 3: Advanced Mocking

**WHAT**: Mock functions that track calls, support call-specific behavior, and enable retry testing.

**WHY**: Test complex scenarios like retries, call tracking, and conditional responses.

### Mock functions

Track calls and change behavior:

```typescript
import { createMockFn } from 'awaitly/testing';

const mockFetchUser = createMockFn<typeof fetchUser>();

// Set return value
mockFetchUser.returns(okOutcome({ id: '1', name: 'Alice' }));

const harness = createWorkflowHarness({
  fetchUser: mockFetchUser,
});

await harness.run(async (step) => {
  await step('fetchUser', () => fetchUser('1'));
  await step('fetchUser', () => fetchUser('2'));
});

// Check calls
expect(mockFetchUser.calls.length).toBe(2);
expect(mockFetchUser.calls[0].args).toEqual(['1']);
expect(mockFetchUser.calls[1].args).toEqual(['2']);
```

### Testing retries

```typescript
import { unwrapOk } from 'awaitly/testing';

const mockFetch = createMockFn<typeof fetchData>();

// Fail twice, then succeed
mockFetch
  .onCall(0).returns(errOutcome('NETWORK_ERROR'))
  .onCall(1).returns(errOutcome('NETWORK_ERROR'))
  .onCall(2).returns(okOutcome({ data: 'success' }));

const harness = createWorkflowHarness({ fetchData: mockFetch });

const result = await harness.run(async (step) => {
  return await step.retry('fetchData', () => fetchData(), { attempts: 3 });
});

const value = unwrapOk(result);
expect(value.data).toBe('success');
expect(mockFetch.calls.length).toBe(3);
```

---

## Part 4: Specialized Testing

**WHAT**: Tools for testing time-dependent workflows, sagas with compensation, event sequences, and debugging.

**WHY**: Production workflows involve timeouts, compensations, and complex event flows - these utilities make them testable.

### Snapshot testing

Compare workflow behavior across changes:

```typescript
import { createSnapshot, compareSnapshots } from 'awaitly/testing';

const harness = createWorkflowHarness(mocks);

const result = await harness.run(executor);
const snapshot = createSnapshot(harness.getInvocations());

// Save to file or compare
expect(snapshot).toMatchSnapshot();
```

### Testing time-dependent workflows

Control time in tests:

```typescript
import { createTestClock } from 'awaitly/testing';

const clock = createTestClock();

const harness = createWorkflowHarness(mocks, { clock });

await harness.run(async (step) => {
  const data = await step.withTimeout('fetchData', () => fetchData(), { ms: 1000 });
  return data;
});

// Advance time
clock.tick(500);  // 500ms passed
clock.tick(600);  // Now 1100ms, timeout triggers
```

### Assertions on step invocations

```typescript
const result = await harness.run(executor);

const invocations = harness.getInvocations();

// Check order
expect(invocations[0].name).toBe('fetchOrder');
expect(invocations[1].name).toBe('chargeCard');

// Check that chargeCard was called after fetchOrder
expect(invocations[1].startedAt).toBeGreaterThan(invocations[0].completedAt);
```

### Full example

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createWorkflowHarness,
  createMockFn,
  okOutcome,
  errOutcome,
  unwrapOk,
  unwrapErr,
} from 'awaitly/testing';

describe('refund workflow', () => {
  let mockCalculateRefund: ReturnType<typeof createMockFn>;
  let mockProcessRefund: ReturnType<typeof createMockFn>;
  let harness: ReturnType<typeof createWorkflowHarness>;

  beforeEach(() => {
    mockCalculateRefund = createMockFn();
    mockProcessRefund = createMockFn();

    mockCalculateRefund.returns(okOutcome({ amount: 50 }));
    mockProcessRefund.returns(okOutcome({ refundId: 'ref-123' }));

    harness = createWorkflowHarness({
      calculateRefund: mockCalculateRefund,
      processRefund: mockProcessRefund,
    });
  });

  it('calculates and processes refund', async () => {
    const result = await harness.run(async (step) => {
      const refund = await step('calculateRefund', () => calculateRefund('order-1'));
      return await step('processRefund', () => processRefund(refund));
    });

    const value = unwrapOk(result);
    expect(value.refundId).toBe('ref-123');
    expect(mockCalculateRefund.calls.length).toBe(1);
    expect(mockProcessRefund.calls.length).toBe(1);
  });

  it('stops if calculation fails', async () => {
    mockCalculateRefund.returns(errOutcome('ORDER_NOT_FOUND'));

    const result = await harness.run(async (step) => {
      const refund = await step('calculateRefund', () => calculateRefund('order-1'));
      return await step('processRefund', () => processRefund(refund));
    });

    const error = unwrapErr(result);
    expect(error).toBe('ORDER_NOT_FOUND');
    expect(mockProcessRefund.calls.length).toBe(0); // Never called
  });
});
```

### Testing saga workflows

Use `createSagaHarness` to test workflows with compensation:

```typescript
import { createSagaHarness, okOutcome, errOutcome, unwrapErr } from 'awaitly/testing';

describe('payment saga', () => {
  it('compensates on failure', async () => {
    const harness = createSagaHarness({
      chargePayment: () => okOutcome({ id: 'pay_1', amount: 100 }),
      reserveInventory: () => errOutcome('OUT_OF_STOCK'),
      refundPayment: () => okOutcome(undefined),
    });

    const result = await harness.runSaga(async (saga, deps) => {
      // Charge payment - add compensation to refund if later steps fail
      const payment = await saga.step(
        () => deps.chargePayment({ amount: 100 }),
        {
          name: 'charge-payment',
          compensate: (p) => deps.refundPayment({ id: p.id }),
        }
      );

      // This fails - triggers compensation
      const reservation = await saga.step(
        () => deps.reserveInventory({ items: [] }),
        { name: 'reserve-inventory' }
      );

      return { payment, reservation };
    });

    // Assert the workflow failed
    const error = unwrapErr(result);
    expect(error).toBe('OUT_OF_STOCK');

    // Assert compensation ran (LIFO order)
    harness.assertCompensationOrder(['charge-payment']);
    harness.assertCompensated('charge-payment');
    harness.assertNotCompensated('reserve-inventory'); // Failed step isn't compensated
  });
});
```

#### Saga harness API

| Method | Description |
|--------|-------------|
| `runSaga(fn)` | Run a saga workflow with compensation tracking |
| `getCompensations()` | Get recorded compensation invocations (in order) |
| `assertCompensationOrder(names)` | Assert compensations ran in expected order (LIFO) |
| `assertCompensated(name)` | Assert a specific step was compensated |
| `assertNotCompensated(name)` | Assert a step was NOT compensated |

### Event assertions

Assert on workflow events for detailed behavior testing:

```typescript
import {
  assertEventSequence,
  assertEventEmitted,
  assertEventNotEmitted,
} from 'awaitly/testing';
import { createWorkflow, type WorkflowEvent } from 'awaitly/workflow';

describe('event assertions', () => {
  it('verifies event sequence', async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow(deps, {
      onEvent: (e) => events.push(e),
    });

    await workflow(async (step) => {
      const user = await step('fetchUser', () => fetchUser('1'), { name: 'fetch-user' });
      const posts = await step('fetchPosts', () => fetchPosts(user.id), { name: 'fetch-posts' });
      return { user, posts };
    });

    // Assert events occurred in order
    const result = assertEventSequence(events, [
      'workflow_start',
      'step_start:fetch-user',
      'step_complete:fetch-user',
      'step_start:fetch-posts',
      'step_complete:fetch-posts',
      'workflow_complete',
    ]);

    expect(result.passed).toBe(true);
  });

  it('verifies specific event was emitted', async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow(deps, {
      onEvent: (e) => events.push(e),
    });

    await workflow(async (step) => {
      await step('fetchUser', () => fetchUser('unknown'), { name: 'fetch-user' });
    });

    // Assert error event was emitted
    const result = assertEventEmitted(events, {
      type: 'step_error',
      name: 'fetch-user',
    });

    expect(result.passed).toBe(true);
  });

  it('verifies event was NOT emitted', async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const workflow = createWorkflow(deps, {
      onEvent: (e) => events.push(e),
    });

    await workflow(async (step) => {
      const user = await step('fetchUser', () => fetchUser('1'), { name: 'fetch-user' });
      return user;
    });

    // Assert no retry events (step succeeded first try)
    const result = assertEventNotEmitted(events, {
      type: 'step_retry',
    });

    expect(result.passed).toBe(true);
  });
});
```

#### Non-strict sequence matching

Allow extra events between expected ones:

```typescript
// Only checks that these events appear in order, ignores others
const result = assertEventSequence(
  events,
  ['workflow_start', 'step_complete:payment', 'workflow_complete'],
  { strict: false }
);
```

### Debug helpers

Format results and events for debugging:

```typescript
import { formatResult, formatEvent, formatEvents } from 'awaitly/testing';
import { ok, err } from 'awaitly';

// Format results
console.log(formatResult(ok(42)));
// "Ok(42)"

console.log(formatResult(ok({ id: '1', name: 'Alice' })));
// "Ok({ id: '1', name: 'Alice' })"

console.log(formatResult(err('NOT_FOUND')));
// "Err('NOT_FOUND')"

console.log(formatResult(err({ type: 'VALIDATION_ERROR', field: 'email' })));
// "Err({ type: 'VALIDATION_ERROR', field: 'email' })"

// Format events
const event = { type: 'step_complete', name: 'fetch-user', durationMs: 42 };
console.log(formatEvent(event));
// "step_complete:fetch-user"

// Format event sequence
console.log(formatEvents(events));
// "workflow_start → step_start:fetch-user → step_complete:fetch-user → workflow_complete"
```

#### Using debug helpers in tests

```typescript
it('debugs failing workflow', async () => {
  const events: WorkflowEvent<unknown>[] = [];
  const workflow = createWorkflow(deps, { onEvent: (e) => events.push(e) });

  const result = await workflow(async (step) => {
    const user = await step('fetchUser', () => fetchUser('1'));
    return user;
  });

  // Print for debugging
  console.log('Result:', formatResult(result));
  console.log('Events:', formatEvents(events));

  // Then assert
  expectOk(result);
});
```

## Next

[Learn about Batch Processing →](/guides/batch-processing/)
