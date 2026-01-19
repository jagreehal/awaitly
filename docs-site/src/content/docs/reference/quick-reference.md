---
title: Quick Reference
description: Decision guide for choosing the right awaitly APIs
---

## I want to...

### Handle errors without exceptions

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

async function fetchUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
  const user = await db.find(id);
  return user ? ok(user) : err('NOT_FOUND');
}
```

### Compose multiple Result-returning functions

```typescript
import { createWorkflow } from 'awaitly';

const workflow = createWorkflow({ fetchUser, chargeCard });
const result = await workflow(async (step) => {
  const user = await step(() => fetchUser('1'));
  const charge = await step(() => chargeCard(user.id, 100));
  return { user, charge };
});
// result.error is: 'NOT_FOUND' | 'CARD_DECLINED' | UnexpectedError
```

### Run multiple operations in parallel

```typescript
import { allAsync, anyAsync, allSettledAsync } from 'awaitly';

// All must succeed (fail-fast on first error)
const [user, posts] = await allAsync([fetchUser('1'), fetchPosts('1')]);

// First success wins (failover pattern)
const data = await anyAsync([fetchFromPrimary(), fetchFromBackup()]);

// Collect ALL errors (if any fail)
const result = await allSettledAsync([op1(), op2(), op3()]);
if (!result.ok) console.log('Errors:', result.error.map(e => e.error));
```

### Combine two Results into a tuple

```typescript
import { zip, zipAsync, andThen } from 'awaitly';

// Sync: combine two Results
const combined = zip(userResult, postsResult);
// combined: Result<[User, Post[]], UserError | PostsError>

// Async: run two fetches in parallel
const data = await zipAsync(fetchUser('1'), fetchPosts('1'));
if (data.ok) {
  const [user, posts] = data.value;
}

// Chain with andThen
const dashboard = andThen(
  zip(userResult, postsResult),
  ([user, posts]) => createDashboard(user, posts)
);
```

### Undo completed steps when one fails

```typescript
import { createSagaWorkflow } from 'awaitly';

const saga = createSagaWorkflow({ charge, refund, reserve, release });
const result = await saga(async (s) => {
  const payment = await s.step(
    () => charge({ amount: 100 }),
    { name: 'charge', compensate: (p) => refund({ id: p.id }) }
  );
  // If next step fails, charge is automatically refunded (LIFO order)
  const reservation = await s.step(
    () => reserve({ items }),
    { name: 'reserve', compensate: (r) => release({ id: r.id }) }
  );
  return { payment, reservation };
});
```

### Wait for human approval

```typescript
import { createApprovalStep, isPendingApproval, injectApproval } from 'awaitly';
import { stringifyState, parseState } from 'awaitly/persistence';

const approvalStep = createApprovalStep({
  key: 'manager-approval',
  checkApproval: async () => {
    const record = await db.approvals.find('workflow-123');
    if (!record) return { status: 'pending' };
    return record.approved ? { status: 'approved', value: record } : { status: 'rejected' };
  },
});

// Workflow pauses at approval step
const result = await workflow(async (step) => {
  const data = await step(() => fetchData());
  const approval = await step(approvalStep);
  return finalize(data);
});

if (!result.ok && isPendingApproval(result.error)) {
  // Save state and wait for approval...
}
```

### Persist and resume workflow state

```typescript
import { createStepCollector, createWorkflow } from 'awaitly';
import { stringifyState, parseState } from 'awaitly/persistence';

// Capture state as workflow executes
const collector = createStepCollector();
await workflow(fn, { onEvent: collector.handleEvent });

// Persist state
const json = stringifyState(collector.getState());
await db.save(workflowId, json);

// Resume later
const saved = await db.load(workflowId);
const resumeState = parseState(saved);
const workflow = createWorkflow(deps, { resumeState });
```

### Retry failed operations

```typescript
import { createWorkflow } from 'awaitly';

const workflow = createWorkflow(deps);
const result = await workflow(async (step) => {
  // Retry up to 3 times with exponential backoff
  const data = await step.retry(
    () => fetchUnreliableAPI(),
    { maxAttempts: 3, backoff: 'exponential', baseDelay: 100 }
  );
  return data;
});
```

### Add timeouts to operations

```typescript
const result = await workflow(async (step) => {
  // Timeout after 5 seconds
  const data = await step.withTimeout(
    () => slowOperation(),
    { ms: 5000, name: 'slow-op' }
  );
  return data;
});
```

### Process large datasets in batches

```typescript
import { processInBatches, batchPresets } from 'awaitly/batch';

const result = await processInBatches(
  users,
  async (user) => migrateUser(user),
  { batchSize: 50, concurrency: 5 },
  { onProgress: (p) => console.log(`${p.percent}%`) }
);
```

### Prevent cascading failures

```typescript
import { createCircuitBreaker, isCircuitOpenError } from 'awaitly/circuit-breaker';

const breaker = createCircuitBreaker('payment-api', {
  failureThreshold: 5,
  resetTimeMs: 30000,
});

const result = await breaker.call(() => paymentAPI.charge());
if (!result.ok && isCircuitOpenError(result.error)) {
  // Circuit is open - fail fast without calling the API
}
```

### Test workflows deterministically

```typescript
import { createWorkflowHarness, okOutcome, errOutcome } from 'awaitly/testing';

const harness = createWorkflowHarness(deps);
harness.script([
  okOutcome({ id: '1', name: 'Alice' }),
  errOutcome('PAYMENT_DECLINED'),
]);

const result = await harness.run(async (step) => {
  const user = await step(() => fetchUser('1'));
  const charge = await step(() => chargeCard(100));
  return { user, charge };
});

expect(result.ok).toBe(false);
harness.assertSteps(['fetch-user', 'charge-card']);
```

---

## Import Cheatsheet

| Need | Import from |
|------|-------------|
| Result types (`ok`, `err`, `isOk`, `isErr`) | `awaitly` or `awaitly/core` |
| Workflow engine (`createWorkflow`, `step`) | `awaitly` |
| Saga pattern (`createSagaWorkflow`) | `awaitly` |
| Parallel ops (`allAsync`, `allSettledAsync`, `zip`, `zipAsync`) | `awaitly` |
| HITL (`createApprovalStep`, `isPendingApproval`) | `awaitly` |
| State persistence (`stringifyState`, `parseState`) | `awaitly` or `awaitly/persistence` |
| Batch processing (`processInBatches`) | `awaitly/batch` |
| Circuit breaker | `awaitly/circuit-breaker` |
| Rate limiting | `awaitly/ratelimit` |
| Testing utilities | `awaitly/testing` |
| Visualization | `awaitly/visualize` |
| Duration helpers | `awaitly/duration` |
| Tagged errors | `awaitly/tagged-error` or `awaitly/core` |
| Pattern matching | `awaitly/match` or `awaitly/core` |

---

## Module Sizes

For optimal bundle size, import from specific entry points:

| Entry Point | Use Case |
|-------------|----------|
| `awaitly` | Full workflow engine + result primitives |
| `awaitly/core` | Just result types and transforms (no workflow) |
| `awaitly/workflow` | Just workflow engine (minimal) |
| `awaitly/batch` | Batch processing only |
| `awaitly/persistence` | State serialization only |

---

## Decision Matrix

| Scenario | Pattern | Key APIs |
|----------|---------|----------|
| Linear multi-step operations | Workflow | `createWorkflow`, `step()` |
| Steps that may need rollback | Saga | `createSagaWorkflow`, `compensate` |
| Independent parallel calls | Parallel | `allAsync()`, `allSettledAsync()` |
| First success wins (failover) | Race | `anyAsync()` |
| Human approval gates | HITL | `createApprovalStep()`, `injectApproval()` |
| High-volume processing | Batch | `processInBatches()` |
| Flaky external APIs | Circuit Breaker | `createCircuitBreaker()` |
| Rate-limited APIs | Rate Limiter | `createRateLimiter()` |

---

## Common Patterns

### Typed error domains

```typescript
// Define error types per domain
type UserError = 'NOT_FOUND' | 'SUSPENDED';
type PaymentError = 'DECLINED' | 'EXPIRED' | 'LIMIT_EXCEEDED';

// Workflows automatically union all possible errors
const workflow = createWorkflow({ fetchUser, chargeCard });
// result.error is: UserError | PaymentError | UnexpectedError
```

### Extracting error types from functions

```typescript
import type { ErrorOf, Errors } from 'awaitly';

type FetchUserError = ErrorOf<typeof fetchUser>; // 'NOT_FOUND' | 'SUSPENDED'
type AllErrors = Errors<[typeof fetchUser, typeof chargeCard]>; // Union of all
```

### Unwrapping results

```typescript
import { unwrap, unwrapOr, unwrapOrElse, UnwrapError } from 'awaitly';

// Throws UnwrapError if err
const user = unwrap(result);

// Returns default if err
const user = unwrapOr(result, defaultUser);

// Compute default from error
const user = unwrapOrElse(result, (error) => createGuestUser(error));
```

### Transforming results

```typescript
import { map, mapError, andThen, match } from 'awaitly';

// Transform value (if ok)
const name = map(userResult, user => user.name);

// Transform error (if err)
const apiError = mapError(result, error => ({ code: 'API_ERROR', cause: error }));

// Chain operations (flatMap)
const posts = andThen(userResult, user => fetchPosts(user.id));

// Pattern match
const message = match(result, {
  ok: (user) => `Hello, ${user.name}!`,
  err: (error) => `Failed: ${error}`,
});
```
