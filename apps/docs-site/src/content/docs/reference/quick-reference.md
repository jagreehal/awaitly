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
import { createWorkflow } from 'awaitly/workflow';

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
import { createSagaWorkflow } from 'awaitly/workflow';

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
import { createApprovalStep, isPendingApproval, injectApproval } from 'awaitly/hitl';
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
import { createResumeStateCollector, createWorkflow } from 'awaitly/workflow';
import { stringifyState, parseState } from 'awaitly/persistence';

// Capture state as workflow executes
const collector = createResumeStateCollector();
await workflow(fn, { onEvent: collector.handleEvent });

// Persist state
const json = stringifyState(collector.getResumeState());
await db.save(workflowId, json);

// Resume later
const saved = await db.load(workflowId);
const resumeState = parseState(saved);
const workflow = createWorkflow(deps, { resumeState });
```

### Retry failed operations

```typescript
import { createWorkflow } from 'awaitly/workflow';

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

### Timeout behavior variants

```typescript
// Default: return error on timeout
{ ms: 5000, onTimeout: 'error' }

// Return undefined instead of error (optional operation)
{ ms: 1000, onTimeout: 'option' }

// Return error but let operation finish in background
{ ms: 2000, onTimeout: 'disconnect' }

// Custom error handler
{ ms: 5000, onTimeout: ({ name, ms }) => ({ _tag: 'Timeout', name, ms }) }
```

### Cancel workflow from outside

```typescript
import { createWorkflow, isWorkflowCancelled } from 'awaitly/workflow';

const controller = new AbortController();
const workflow = createWorkflow(deps, { signal: controller.signal });

const resultPromise = workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { key: 'user' });
  await step(() => sendEmail(user.email), { key: 'email' });
  return user;
});

// Cancel from outside (e.g., timeout, user action)
setTimeout(() => controller.abort('timeout'), 5000);

const result = await resultPromise;
if (!result.ok && isWorkflowCancelled(result.error)) {
  console.log('Cancelled:', result.error.reason);
}
```

### Dedupe concurrent requests

```typescript
import { singleflight } from 'awaitly/singleflight';

const fetchUserOnce = singleflight(fetchUser, {
  key: (id) => `user:${id}`,
});

// 3 concurrent calls → 1 network request
const [a, b, c] = await Promise.all([
  fetchUserOnce('1'),
  fetchUserOnce('1'),  // Shares request
  fetchUserOnce('1'),  // Shares request
]);
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
| Result types + composition (`ok`, `err`, `isOk`, `isErr`, `map`, `mapError`, `andThen`, `tap`, `from`, `fromPromise`, `all`, `allAsync`, `partition`, `match`, `run`, `TaggedError`) | `awaitly` |
| Workflow engine (`createWorkflow`, `Duration`, `isStepComplete`, `createResumeStateCollector`, `isWorkflowCancelled`, step types, `ResumeState`) | `awaitly/workflow` |
| Saga pattern (`createSagaWorkflow`) | `awaitly/workflow` |
| Parallel ops (`allAsync`, `allSettledAsync`, `zip`, `zipAsync`) | `awaitly` |
| HITL (`pendingApproval`, `createApprovalStep`, `gatedStep`, `injectApproval`, `isPendingApproval`) | `awaitly/hitl` |
| State persistence (`stringifyState`, `parseState`) | `awaitly/persistence` |
| Batch processing (`processInBatches`) | `awaitly/batch` |
| Circuit breaker | `awaitly/circuit-breaker` |
| Rate limiting | `awaitly/ratelimit` |
| Singleflight (`singleflight`, `createSingleflightGroup`) | `awaitly/singleflight` |
| Testing utilities | `awaitly/testing` |
| Visualization | `awaitly/visualize` |
| Duration helpers | `awaitly/workflow` |
| Tagged errors | `awaitly` |
| Pattern matching | `awaitly` |
| Pre-built errors (`TimeoutError`, `RetryExhaustedError`, `RateLimitError`, etc.) | `awaitly/errors` |

---

## Module Sizes

For optimal bundle size, import from specific entry points:

| Entry Point | Use Case |
|-------------|----------|
| `awaitly` | Result types, transforms, and `run()` for composition |
| `awaitly/workflow` | Workflow engine (`createWorkflow`, `Duration`, etc.) |
| `awaitly/hitl` | Human-in-the-loop (`createApprovalStep`, `isPendingApproval`, etc.) |
| `awaitly/persistence` | State serialization (`stringifyState`, `parseState`) |
| `awaitly/batch` | Batch processing only |

---

## Decision Matrix

| Scenario | Pattern | Key APIs |
|----------|---------|----------|
| Linear multi-step operations | Workflow | `createWorkflow`, `step()` |
| Steps that may need rollback | Saga | `createSagaWorkflow`, `compensate` |
| Independent parallel calls | Parallel | `allAsync()`, `allSettledAsync()` |
| First success wins (failover) | Race | `anyAsync()` |
| Human approval gates | HITL | `createApprovalStep()`, `injectApproval()` |
| Cancel from outside | Cancellation | `signal`, `isWorkflowCancelled()` |
| Dedupe concurrent requests | Singleflight | `singleflight()` |
| High-volume processing | Batch | `processInBatches()` |
| Flaky external APIs | Circuit Breaker | `createCircuitBreaker()` |
| Rate-limited APIs | Rate Limiter | `createRateLimiter()` |
| Rich typed errors | Tagged Errors | `TaggedError()`, `TimeoutError`, etc. |

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

### Using tagged errors

```typescript
import { TaggedError } from 'awaitly';
import { TimeoutError, RetryExhaustedError, ValidationError, isAwaitlyError } from 'awaitly/errors';

// Create typed errors
const timeout = new TimeoutError({ operation: 'fetchUser', ms: 5000 });
const validation = new ValidationError({ field: 'email', reason: 'Invalid format' });

// Pattern match on errors
const message = TaggedError.match(error, {
  TimeoutError: (e) => `Timed out after ${e.ms}ms`,
  RetryExhaustedError: (e) => `Failed after ${e.attempts} attempts`,
  ValidationError: (e) => `Invalid ${e.field}: ${e.reason}`,
});

// Type guard
if (isAwaitlyError(error)) {
  console.log('Awaitly error:', error._tag);
}
```

---

## See Also

| Topic | Guide |
|-------|-------|
| Common issues | [Troubleshooting](../../guides/troubleshooting/) |
| Framework setup | [Framework Integrations](../../guides/framework-integrations/) |
| Production best practices | [Production Deployment](../../advanced/production-deployment/) |
| Complete API | [API Reference](../api/) |
