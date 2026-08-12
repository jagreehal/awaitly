---
title: Recipes
description: Find your situation, copy the smallest API that solves it
---

Find your situation in the headings below. Each recipe shows the smallest API that
solves it, then links to the guide that goes deeper.

Every snippet here is copied from `packages/awaitly/src/recipes.test.ts`, which runs on
every build. If you change a recipe, change it there too.

## Four tiers, one `run()`

Most questions on this page reduce to picking a tier. Start at the top and stop as
soon as one works.

| Your situation | Reach for |
| --- | --- |
| Call a dependency, unwrap it, exit on error | `s.getOrders(id)` |
| Every call to one dependency needs a retry or timeout | `retry(getOrders, { attempts: 3 })` in the deps object |
| One specific call needs options | `step('getOrders', () => getOrders(id), { retry })` |
| You need caching, resume, or events | `createWorkflow(deps)` |

```typescript
import { run, retry, match } from 'awaitly';

const result = await run(
  { getUser, getOrders: retry(getOrders, { attempts: 3 }) }, // tier 2
  async (s, { step }) => {
    const user = await s.getUser('1'); // tier 1
    const orders = await step('getOrders', () => getOrders(user.id), {
      timeout: { ms: 5000 }, // tier 3
    });
    return { user, orders };
  }
);

match(result, {
  ok: ({ user, orders }) => console.log({ user, orders }),
  NOT_FOUND: () => console.error('User not found'),
  VALIDATION_ERROR: () => console.error('Bad input'),
  FETCH_ERROR: () => console.error('Fetch error'),
  UnexpectedError: (error) => console.error(error.cause),
});
```

Tier 4 costs you a workflow name and a deps object. Skip it until you want the
caching or the resume.

## Start here

### Handle errors without exceptions

For minimal bundle use `awaitly/result`; for the full front-door API use `awaitly`. All imports are named.

```typescript
// Minimal: from 'awaitly/result'. Or from 'awaitly' for the full front-door API.
import { ok, err, type AsyncResult } from 'awaitly';

async function fetchUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
  const user = await db.find(id);
  return user ? ok(user) : err('NOT_FOUND');
}
```

### Compose multiple Result-returning functions

Pass them to `run()`. Each call unwraps the `ok` value and exits on the first error.

```typescript
import { run } from 'awaitly';

const result = await run({ fetchUser, chargeCard }, async (s) => {
  const user = await s.fetchUser('1');
  const charge = await s.chargeCard(user.id, 100);
  return { user, charge };
});
// result.error is: 'NOT_FOUND' | 'CARD_DECLINED' | UnexpectedError
```

Reach for `createWorkflow` when you want caching, resume, or events on top:

```typescript
import { createWorkflow } from 'awaitly';

const workflow = createWorkflow('workflow', { fetchUser, chargeCard });
const result = await workflow.run(async ({ step, deps }) => {
  const user = await step('fetchUser', () => deps.fetchUser('1'));
  const charge = await step('chargeCard', () => deps.chargeCard(user.id, 100));
  return { user, charge };
});
// First arg = label (literal); optional key = instance (cache/identity)
```

### Adopt awaitly without rewriting anything

A plain function that throws is a valid dep. Its value passes through, and its throws
arrive as `UnexpectedError`. Convert functions to `Result` one at a time.

```typescript
const parseConfig = async (raw: string) => JSON.parse(raw) as { port: number };

const result = await run({ parseConfig }, async (s) => s.parseConfig(raw));
// result.error is UnexpectedError, with the SyntaxError on .cause
```

### Read the result at the boundary

Reach for `match`. One arm per error, plus `ok`, plus `UnexpectedError`:

```typescript
import { match } from 'awaitly';

match(result, {
  ok: ({ user, orders }) => console.log({ user, orders }),
  NOT_FOUND: () => console.error('User not found'),
  VALIDATION_ERROR: () => console.error('Bad input'),
  FETCH_ERROR: () => console.error('Fetch error'),
  UnexpectedError: (error) => console.error(error.cause),
});
```

This is exhaustive. Add a dependency that fails a new way and every `match` over that
result stops compiling until you handle it. String errors key on themselves; tagged
errors and `TaggedError` classes key on their `type`.

`match` returns whatever the arms return, so it works as an expression:

```typescript
type Response = { status: number; body: unknown };

const response = match(result, {
  ok: (value): Response => ({ status: 200, body: value }),
  NOT_FOUND: () => ({ status: 404, body: 'No such user' }),
  CARD_DECLINED: () => ({ status: 402, body: 'Payment declined' }),
  UnexpectedError: () => ({ status: 500, body: 'Internal error' }),
});
```

Annotate the `ok` arm when the arms return different shapes. TypeScript infers the
return type from the first arm it sees, so an unannotated `ok` returning
`{ status, body: User }` rejects the sibling arms that put a string in `body`.

Want a single catch-all instead of one arm per error? Use the two-arm form,
`match(result, { ok, err })`.

#### The lower-level form

`if`/`switch` still works, and you need it when the arms do more than return a value.
A `Result` is an object, so narrow on `result.ok` before you touch `result.error`:

```typescript
if (result.ok) {
  return { status: 200, body: result.value };
}
if (isUnexpectedError(result.error)) {
  return { status: 500, body: 'Internal error' };
}
switch (result.error) {
  case 'NOT_FOUND':
    return { status: 404, body: 'No such user' };
  case 'CARD_DECLINED':
    return { status: 402, body: 'Payment declined' };
}
```

Two traps live here, and `match` avoids both:

- `switch (result)` instead of `switch (result.error)` gets you
  `Type 'string' is not comparable to type 'Result<...>'` (TS2678).
- `isUnexpectedError(result)` instead of `isUnexpectedError(result.error)` compiles
  and returns `false` every time. Pass the error, never the `Result`.

## Make it survive a bad day

### Retry every call to one dependency

Wrap it where you declare it. Call sites stay untouched, and the
[analyzer](guides/static-analysis/) reads the policy straight out of the deps literal.

```typescript
import { run, retry } from 'awaitly';

const result = await run(
  { fetchApi: retry(fetchUnreliableAPI, { attempts: 3, backoff: 'exponential', delay: 100 }) },
  async (s) => s.fetchApi()
);
```

See [Policies](advanced/policies/) for `retry`, `timeout`, and `fallback`, which compose:
`retry(timeout(charge, 5000), { attempts: 3 })`.

`delay` and `initialDelay` mean the same thing here, as do `retryIf` and `shouldRetry`,
so whichever you remember from step options also works on the policy. The defaults still
differ: policies start at `backoff: 'fixed'` with no delay, step retries start at
`backoff: 'exponential'` with a 100ms `initialDelay` and jitter on.

### Add timeouts to operations

Same three tiers. Per dependency:

```typescript
import { run, timeout } from 'awaitly';

const result = await run({ slowOp: timeout(slowOperation, 5000) }, async (s) => s.slowOp());
// error union gains TimeoutError
```

Per call, via step options (note the `{ ms }` object):

```typescript
const data = await step('slowOp', () => slowOperation(), { timeout: { ms: 5000 } });
```

Inside a workflow, `step.withTimeout('slowOp', () => slowOperation(), { ms: 5000 })` does
the same thing with a dedicated helper.

### Fall back to a default when a dependency fails

```typescript
import { run, fallback } from 'awaitly';

const result = await run(
  { sendEmail: fallback(sendEmail, () => ({ queued: true })) },
  async (s) => s.sendEmail(user.id)
);
// sendEmail's errors are consumed, so they never reach result.error
```

### Retry one specific call

Take `step` from the second callback argument. You keep the bound steps for
everything else.

```typescript
const result = await run({ fetchUser, fetchApi }, async (s, { step }) => {
  const user = await s.fetchUser('1');
  const data = await step('fetchApi', () => fetchUnreliableAPI(user.id), {
    retry: { attempts: 3, backoff: 'exponential', initialDelay: 100 },
  });
  return data;
});
```

Inside a workflow the same options live on `step`, plus the `step.retry(id, fn, opts)`
helper. See [Retries & Timeouts](guides/retries-timeouts/).

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

## Do several things at once

### Run multiple operations in parallel

```typescript
import { allAsync, anyAsync, allSettledAsync, createWorkflow } from 'awaitly';

// Inside a workflow: step.all (named results, step tracking)
await workflow.run(async ({ step, deps }) => {
  const { user, posts } = await step.all('fetchAll', {
    user: () => deps.fetchUser('1'),
    posts: () => deps.fetchPosts('1'),
  });
  const users = await step.map('fetchUsers', ['1', '2', '3'], (id) => deps.fetchUser(id));
  return { user, posts, users };
});

// Standalone: allAsync — all must succeed (fail-fast)
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

### Process large datasets in batches

```typescript
import { processInBatches, batchPresets } from 'awaitly';

const result = await processInBatches(
  users,
  async (user) => migrateUser(user),
  { batchSize: 50, concurrency: 5 },
  { onProgress: (p) => console.log(`${p.percent}%`) }
);
```

### Dedupe concurrent requests

```typescript
import { singleflight } from 'awaitly';

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

## Reach for a workflow

### Compose steps inside a workflow

Inside a workflow callback use `({ step, deps }) => { ... }` when the workflow has deps:

```typescript
// Unwrap an AsyncResult (cache by passing { key })
const user = await step('fetchUser', () => fetchUser('1'), { key: 'user:1' });

// Chain — just call step again with the success value
const enriched = await step('enrich', () => enrichUser(user));

// Pattern match — branch on the unwrapped value
const msg = user.name ? `Hello ${user.name}` : 'Failed';
```

### Skip work you already did

Caching is opt-in twice: pass a `cache` to `createWorkflow`, and give each cacheable
step a `key`. A `key` with no cache configured is inert, so the step runs every time.

```typescript
const cache = new Map();
const checkout = createWorkflow('checkout', { charge }, { cache });

await checkout.run(async ({ step, deps }) =>
  step('charge', () => deps.charge(100), { key: 'order-1' })
);
// A second run with the same key reads the cache and does not charge again.
```

Options passed to `workflow.run()` rather than `createWorkflow()` are ignored in
silence. See [Caching](guides/caching/).

### Persist and resume workflow state

```typescript
import { createWorkflow } from 'awaitly';
import { postgres } from 'awaitly-postgres';

const store = postgres(process.env.DATABASE_URL!);
const workflow = createWorkflow('workflow', deps);

const { result, resumeState } = await workflow.runWithState(fn);
await store.save(workflowId, resumeState);

// Resume later (use loadResumeState for type-safe restore)
const loaded = await store.loadResumeState(workflowId);
if (loaded) await workflow.run(fn, { resumeState: loaded });
```

Three things to know before you rely on this:

- **Only keyed steps are recorded.** A step without `key` runs again on every resume.
- **`resumeState.steps` is a `Map`.** `JSON.stringify` turns it into `{}` and reports no
  error, so a hand-rolled store saves an empty state. Use `serializeResumeState` and
  `deserializeResumeState` when you persist as JSON.
- **Failed steps are recorded too, and replay returns the recorded failure.** Resuming a
  crashed run reproduces the same error without calling the dependency again. Drop the
  failures first when you want a retry:

```typescript
const retryable = {
  steps: new Map([...loaded.steps].filter(([, entry]) => entry.result.ok)),
};
await workflow.run(fn, { resumeState: retryable });
```

### Cancel workflow from outside

```typescript
import { createWorkflow, isWorkflowCancelled } from 'awaitly';

const controller = new AbortController();
const workflow = createWorkflow('workflow', deps, { signal: controller.signal });

const resultPromise = workflow.run(async ({ step, deps }) => {
  const user = await step('fetchUser', () => fetchUser('1'), { key: 'user' });
  await step('sendEmail', () => sendEmail(user.email), { key: 'email' });
  return user;
});

// Cancel from outside (e.g., timeout, user action)
setTimeout(() => controller.abort('timeout'), 5000);

const result = await resultPromise;
if (!result.ok && isWorkflowCancelled(result.cause)) {
  console.log('Cancelled:', result.cause.reason);
}
```

### Undo completed steps when one fails

```typescript
import { createSagaWorkflow } from 'awaitly/durable';

const saga = createSagaWorkflow('checkout', { charge, refund, reserve, release });
const result = await saga.run(async ({ step, deps }) => {
  const payment = await step('charge', () => deps.charge({ amount: 100 }), {
    compensate: (p) => deps.refund({ id: p.id }),
  });
  // If a later step fails, charge is automatically refunded (LIFO order)
  const reservation = await step('reserve', () => deps.reserve({ items }), {
    compensate: (r) => deps.release({ id: r.id }),
  });
  return { payment, reservation };
});
```

A rollback that fails is reported, not swallowed. If `refund` returns `err(...)` or throws,
the saga returns `SAGA_COMPENSATION_ERROR` carrying both the original error and every
compensation that failed:

```typescript
if (!result.ok && isSagaCompensationError(result.error)) {
  console.error('rollback incomplete', result.error.compensationErrors);
  console.error('what started it', result.error.originalError);
}
```

### Wait for human approval

```typescript
import { createApprovalStep, isPendingApproval } from 'awaitly/durable';
import { createResumeStateCollector } from 'awaitly';

const approvalStep = createApprovalStep({
  key: 'manager-approval',
  checkApproval: async () => {
    const record = await db.approvals.find('workflow-123');
    if (!record) return { status: 'pending' };
    // The 'rejected' arm requires a `reason`.
    return record.approved
      ? { status: 'approved', value: record }
      : { status: 'rejected', reason: record.rejectionReason ?? 'Not approved' };
  },
});

const collector = createResumeStateCollector();
const workflow = createWorkflow('workflow', deps, { onEvent: collector.handleEvent });

// Workflow pauses at approval step
const result = await workflow.run(async ({ step, deps }) => {
  const data = await step('fetchData', () => deps.fetchData());
  const approval = await step('approval', approvalStep);
  return finalize(data);
});

if (!result.ok && isPendingApproval(result.error)) {
  const state = collector.getResumeState();
  await store.save(workflowId, state);
}
```

### Prevent cascading failures

```typescript
import { createCircuitBreaker, isCircuitOpenError } from 'awaitly';

const breaker = createCircuitBreaker('payment-api', {
  failureThreshold: 5,
  resetTimeout: 30000,
});

const result = await breaker.executeResult(() => paymentAPI.charge());
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

const result = await harness.run(async ({ step, deps }) => {
  const user = await step('fetchUser', () => fetchUser('1'));
  const charge = await step('chargeCard', () => chargeCard(100));
  return { user, charge };
});

expect(result.ok).toBe(false);
harness.assertSteps(['fetch-user', 'charge-card']);
```

---

## Import Cheatsheet

Use the task-shaped entry point for the capability you need. Everything is a **named import** — there is no namespace object.

| Need | Import from |
|------|-------------|
| Result types only (minimal bundle) | `awaitly/result` |
| Result types + composition (`ok`, `err`, `isOk`, `isErr`, `map`, `mapError`, `andThen`, `tap`, `from`, `fromPromise`, `all`, `allAsync`, `partition`, `match`, `TaggedError`) | `awaitly` |
| `run()` for step composition | `awaitly` |
| Parallel ops (`allAsync`, `allSettledAsync`, `zip`, `zipAsync`) | `awaitly` |
| Retry policy for async/Result code (`retry`) | `awaitly` |
| Circuit breaker (`createCircuitBreaker`, `isCircuitOpenError`) | `awaitly` |
| Rate limiting | `awaitly` |
| Singleflight (`singleflight`, `createSingleflightGroup`) | `awaitly` |
| Duration helpers (`Duration`, `seconds`, `minutes`) | `awaitly` |
| Tagged errors, pattern matching | `awaitly` |
| Pre-built errors (`TimeoutError`, `RetryExhaustedError`, `RateLimitError`, etc.) | `awaitly` |
| Conditionals (`when`, `unless`) | `awaitly` |
| Workflow engine (`createWorkflow`, `isStepComplete`, `createResumeStateCollector`, `isWorkflowCancelled`, step types, `ResumeState`) | `awaitly` |
| Workflow instance (`.run(name?, fn, config?)`) | Returned by `createWorkflow` |
| Durable execution (`durable.run`) | `awaitly/durable` |
| Saga pattern (`createSagaWorkflow`) | `awaitly/durable` |
| HITL (`pendingApproval`, `createApprovalStep`, `gatedStep`, `injectApproval`, `isPendingApproval`) | `awaitly/durable` |
| Snapshot store types and validation (`SnapshotStore`, `WorkflowSnapshot`, `validateSnapshot`) | `awaitly/durable` |
| Streaming (`createMemoryStreamStore`, `toAsyncIterable`, transformers) | `awaitly/durable` |
| Webhooks (`createWebhookHandler`) | `awaitly/durable` |
| Runtime engine (`createEngine`) | `awaitly/durable` |
| Batch processing (`processInBatches`) | `awaitly` |
| Testing utilities | `awaitly/testing` |
| Visualization | `awaitly-visualizer` (createVisualizer, Mermaid/ASCII/JSON; optional React UI) |

---

## Entry points

| Entry Point | Use Case |
|-------------|----------|
| `awaitly/result` | Result types only (smallest bundle; sizes in docs are gzipped when given) |
| `awaitly` | The front door: Result types, `run()`, `createWorkflow()`, per-dep policies, circuit breakers, rate limiting, caching, singleflight, pattern matching, durations, pre-built errors, and batch processing |
| `awaitly/durable` | Production machinery: durable execution, snapshot persistence, saga/compensation, human-in-the-loop, streaming stores, webhooks, and the low-level engine |
| `awaitly/testing` | Test utilities (`createWorkflowHarness`, scripted outcomes, assertions) |

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
const workflow = createWorkflow('workflow', { fetchUser, chargeCard });
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
import { TaggedError, TimeoutError, RetryExhaustedError, ValidationError, isAwaitlyError } from 'awaitly';

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
  console.log('Awaitly error:', error.type);
}
```

---

## See Also

| Topic | Guide |
|-------|-------|
| Common issues | [Troubleshooting](guides/troubleshooting/) |
| Framework setup | [Framework Integration](guides/framework-integration/) |
| Production best practices | [Production Deployment](advanced/production-deployment/) |
| Complete API | [API Reference](reference/api/) |
