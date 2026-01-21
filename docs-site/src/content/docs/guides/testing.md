---
title: Testing
description: Test workflows deterministically
---

Use the test harness to control step execution and verify workflow behavior.

## Result assertions

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

## Basic testing

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
      const order = await step(fetchOrder('123'));
      const payment = await step(chargeCard(order.total));
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
      const order = await step(fetchOrder('123'));
      const payment = await step(chargeCard(order.total));
      return { order, payment };
    });

    const error = unwrapErr(result);
    expect(error).toBe('DECLINED');
  });
});
```

## Scripted outcomes

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

## Dynamic outcomes

Return different results based on input:

```typescript
const harness = createWorkflowHarness({
  fetchUser: (id: string) =>
    id === '1'
      ? okOutcome({ id, name: 'Alice' })
      : errOutcome('NOT_FOUND'),
});
```

## Mock functions

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
  await step(fetchUser('1'));
  await step(fetchUser('2'));
});

// Check calls
expect(mockFetchUser.calls.length).toBe(2);
expect(mockFetchUser.calls[0].args).toEqual(['1']);
expect(mockFetchUser.calls[1].args).toEqual(['2']);
```

## Testing retries

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
  return await step.retry(() => fetchData(), { attempts: 3 });
});

const value = unwrapOk(result);
expect(value.data).toBe('success');
expect(mockFetch.calls.length).toBe(3);
```

## Snapshot testing

Compare workflow behavior across changes:

```typescript
import { createSnapshot, compareSnapshots } from 'awaitly/testing';

const harness = createWorkflowHarness(mocks);

const result = await harness.run(executor);
const snapshot = createSnapshot(harness.getInvocations());

// Save to file or compare
expect(snapshot).toMatchSnapshot();
```

## Testing time-dependent workflows

Control time in tests:

```typescript
import { createTestClock } from 'awaitly/testing';

const clock = createTestClock();

const harness = createWorkflowHarness(mocks, { clock });

await harness.run(async (step) => {
  const data = await step.withTimeout(() => fetchData(), { ms: 1000 });
  return data;
});

// Advance time
clock.tick(500);  // 500ms passed
clock.tick(600);  // Now 1100ms, timeout triggers
```

## Assertions on step invocations

```typescript
const result = await harness.run(executor);

const invocations = harness.getInvocations();

// Check order
expect(invocations[0].name).toBe('fetchOrder');
expect(invocations[1].name).toBe('chargeCard');

// Check that chargeCard was called after fetchOrder
expect(invocations[1].startedAt).toBeGreaterThan(invocations[0].completedAt);
```

## Full example

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
      const refund = await step(calculateRefund('order-1'));
      return await step(processRefund(refund));
    });

    const value = unwrapOk(result);
    expect(value.refundId).toBe('ref-123');
    expect(mockCalculateRefund.calls.length).toBe(1);
    expect(mockProcessRefund.calls.length).toBe(1);
  });

  it('stops if calculation fails', async () => {
    mockCalculateRefund.returns(errOutcome('ORDER_NOT_FOUND'));

    const result = await harness.run(async (step) => {
      const refund = await step(calculateRefund('order-1'));
      return await step(processRefund(refund));
    });

    const error = unwrapErr(result);
    expect(error).toBe('ORDER_NOT_FOUND');
    expect(mockProcessRefund.calls.length).toBe(0); // Never called
  });
});
```

## Next

[Learn about Batch Processing →](../batch-processing/)
