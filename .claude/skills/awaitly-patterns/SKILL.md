---
name: awaitly-patterns
description: "Core patterns for awaitly: typed async workflows with automatic error inference. Use when writing workflows, migrating from try/catch, or debugging Result types."
user-invocable: true
---

# Awaitly Core Patterns

**This document defines the only supported patterns for using awaitly. Do not invent alternatives.** Effect-style helpers (run, andThen, match, all, map) keep the API as close to Effect as we can get while still using async/await and not generators.

Workflows are sequential unless explicitly composed with helpers like `allAsync()`.

---

## Rules

### R1: step() requires an explicit string ID and accepts both direct and thunk forms

`step()` **requires a string ID as the first argument** in both `run()` and `createWorkflow()` workflows:

**Signature:** `step('id', fnOrResult, opts?)` or `step('id', result, opts?)`

**Thunk form** (deferred execution; use for retries, caching, or expensive work):
```typescript
await step('getUser', () => deps.getUser(id));  // Operation starts when step runs
```

**Direct form** (Promise/Result passed immediately; cannot be retried/cached-before-run):
```typescript
// createWorkflow(deps)
await step('getUser', deps.getUser(id));

// run(): deps via closures
await step('getUser', getUser(id));
```

**When to use thunks:**
- Retries (`step.retry`) - needs to re-execute
- Caching with keys - checks cache before executing
- Expensive operations - defer until needed

**Rule: If an operation must be re-executed (retry) or conditionally executed (cache), you MUST use the thunk form.**

**When direct form is fine:**
- Simple sequential workflows
- No retries or caching needed
- Already have a Result/Promise to unwrap

**Every step type takes a string as the first argument (ID or name).** `step(id, fn, opts)`, `step.retry(id, operation, options)`, `step.withTimeout(id, operation, options)`, `step.try(id, fn, opts)`, `step.fromResult(id, fn, opts)`, `step.sleep(id, duration, options?)`, `step.parallel(name, operations | callback)`, `step.race(name, callback)`, `step.allSettled(name, callback)`, `step.run(id, result | getter, options?)`, `step.andThen(id, value, fn, options?)`, `step.match(id, result, handlers, options?)`, `step.all(name, shape, options?)`, `step.map(id, items, mapper, options?)`. There is no `name` in options—the first argument is the step name/id. Use optional `key` in options for per-iteration identity (e.g. in loops).

**Label vs instance:** The first argument is the step **label** (category, e.g. `'fetchUser'`). The optional `key` is the **instance** identity (which iteration or entity). In loops, use one literal ID + key: `step('fetchUser', () => fetchUser(id), { key: \`user:${id}\` })`. Rules of thumb for key: stable (same input → same key); scoped to the step (e.g. `fetchUser:${id}`, `user:${id}`); keep short for logs/snapshots.

### R2: On err, step() immediately returns that error as the workflow result

When `step()` receives an `err` result, it immediately returns that error as the workflow result. No wrapping, no transformation. Do not check `result.ok` inside workflows.

```typescript
// CORRECT - step handles early exit
const user = await step('getUser', () => deps.getUser(id));
const order = await step('createOrder', () => deps.createOrder(user));

// WRONG - never check result.ok inside workflows
const userResult = await deps.getUser(id);  // calling dep directly, not through step
if (!userResult.ok) return userResult;
const order = await step('createOrder', () => deps.createOrder(userResult.value));
```

### R3: Normalize errors with `error.type ?? error`

Errors can be strings (`'NOT_FOUND'`) or objects (`{ type: 'NOT_FOUND', id }`). Always normalize when switching:

```typescript
switch (result.error.type ?? result.error) {
  case 'NOT_FOUND': return { status: 404 };
  case 'ORDER_FAILED': return { status: 400 };
  case UNEXPECTED_ERROR: return { status: 500 };
}
```

### R4: Handle UnexpectedError at boundaries

`UnexpectedError` represents any thrown exception escaping a dep. It must be handled at HTTP/API boundaries.

```typescript
import { Awaitly } from 'awaitly';

if (!result.ok) {
  if ((result.error.type ?? result.error) === Awaitly.UNEXPECTED_ERROR) {
    console.error('Bug:', result.error.cause);
    return { status: 500 };
  }
  // handle typed errors
}
```

### R5: All async work inside workflows must go through step()

Do not use bare `await` inside workflow functions. Every async operation must use `step()` or a step helper.

```typescript
// CORRECT
const user = await step('getUser', () => deps.getUser(id));
const data = await step.try('fetch', () => deps.fetchExternal(url), { error: 'FETCH_ERROR' });

// WRONG - bare await bypasses error handling and tracking
const user = await deps.getUser(id);
const response = await deps.fetchExternal(url);
```

### R6: Never wrap step() in try/catch

Errors from `step()` propagate automatically to the workflow result. Using `try/catch` around steps breaks this:

```typescript
// ❌ WRONG - try/catch defeats typed error propagation
try {
  const result = await step('makePayment', () => deps.makePayment());
} catch (error) {
  await step('handleFailed', () => deps.handleFailed(error));
}

// ✅ CORRECT - errors propagate to workflow result
const result = await workflow(async (step, deps) => {
  const payment = await step('makePayment', () => deps.makePayment());
  return payment;
});

// Handle errors at the boundary
if (!result.ok) {
  switch (result.error.type ?? result.error) {
    case 'PAYMENT_FAILED':
      await handleFailedPayment(result.error);
      break;
  }
}
```

If you need per-item error handling in a loop, use `step.forEach()` with error collection.

---

## Disallowed Inside Workflows

| Pattern | Why |
|---------|-----|
| `step(...)` without string ID as first argument | step() requires `step('id', fn, opts)` or `step('id', result, opts)` |
| `step.parallel(operations, { name })` (legacy) | Use `step.parallel('name', operations)` — name is always the first argument |
| Template literal as step ID (e.g. `` step(`step-${i}`, ...) ``) | Use a literal ID + `key` instead: `step('fetchUser', () => fetchUser(i), { key: \`user:${i}\` })` |
| `step(promise)` when using retries/caching | Direct form can't re-execute or cache-before-run; use thunk `step('id', () => deps.fn(args))` |
| `step.run(id, promise, { key })` in createWorkflow | Use getter so cache hits don't run: `step.run(id, () => deps.fn(), { key })` |
| `await x` without step | Bypasses error handling and tracking |
| `if (!result.ok)` checks | step() already handles early exit |
| `Promise.all()` | Disallowed even wrapped in step(); use `allAsync()` so errors are typed as Results |
| `throw` in deps | Return `err()` instead, or wrap with `step.try()` |
| `try/catch` | Use `step.try()` to convert throws to typed errors |
| `try/catch` around step() | Errors propagate automatically; use workflow-level handling |

Synchronous computation and pure logic are allowed inside workflows. Only async operations require `step()`.

---

## Choosing Your Pattern

| Aspect | `run()` | `createWorkflow(deps)` |
|--------|---------|------------------------|
| Import | `awaitly` (core) | `awaitly/workflow` |
| Step syntax | `step('id', promiseOrResult)` or `step('id', () => promiseOrResult)` | `step('id', deps.fn(args))` or `step('id', () => deps.fn(args))` |
| Deps | Closures | Injected deps object |
| Error types | Manual (`catchUnexpected`) or `UnexpectedError` | Auto-inferred from deps |
| Features | Basic step execution | Retries, timeout, state persistence, caching |
| Bundle | Smaller | Larger |
| Best for | Single-use, wrapping throwing APIs | Shared deps, DI, testing, typed errors |

### Use `run()` when:
- Single-use workflow (not reused across files)
- Dependencies available via closures
- Wrapping throwing APIs with `step.try()`
- Minimal bundle size matters

### Use `createWorkflow(deps)` when:
- Shared deps across multiple workflows
- Need dependency injection for testing
- Deps already return `AsyncResult`
- Need retries, timeout, or state persistence

---

## Migration: 3 Steps

### Step 1: Change functions to return Result

```typescript
// BEFORE
async function getUser(id: string): Promise<User | null> {
  const user = await db.find(id);
  if (!user) throw new Error('Not found');
  return user;
}

// AFTER
import { Awaitly, type AsyncResult } from 'awaitly';

async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
  const user = await db.find(id);
  return user ? Awaitly.ok(user) : Awaitly.err('NOT_FOUND');
}
```

### Step 2a: Use `run()` for simple cases

For single-use workflows where deps are available via closures.

**With typed errors** (use `catchUnexpected`):
```typescript
import { run } from 'awaitly/run';

type MyErrors = 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED';

  const result = await run<Order, MyErrors>(
    async (step) => {
      const user = await step('getUser', getUser(userId));
      const order = await step('createOrder', createOrder(user));
      return order;
    },
  { catchUnexpected: () => 'UNEXPECTED' as const }
);
```

**Without options** (errors wrapped as `UnexpectedError`):
```typescript
const result = await run(async (step) => {
  const user = await step('getUser', getUser(userId));
  return user;
});
// result.error is UnexpectedError - access original via result.error.cause.error
```

### Step 2b: Use `createWorkflow(deps)` for DI cases

For shared deps, testing, or advanced features (retries, timeout):

```typescript
import { createWorkflow } from 'awaitly/workflow';

const deps = { getUser, createOrder, sendEmail };
const processOrder = createWorkflow(deps);
// TypeScript infers all error types from deps
```

### Step 3: Use step() for linear flow (createWorkflow only)

```typescript
const result = await processOrder(async (step, deps) => {
  const user = await step('getUser', () => deps.getUser(userId));
  const order = await step('createOrder', () => deps.createOrder(user));
  await step('sendEmail', () => deps.sendEmail(user.email, order));
  return order;
});
```

---

## Step Helpers

| Need | Use | Example |
|------|-----|---------|
| Result-returning fn | `step(id, fn, opts)` | `step('getUser', () => deps.getUser(id))` |
| Unwrap AsyncResult | `step.run(id, result \| getter, opts?)` | `step.run('getUser', () => deps.getUser(id))` or `step.run('getUser', () => deps.getUser(id), { key: 'user:1' })` |
| Chain from value | `step.andThen(id, value, fn, opts?)` | `step.andThen('enrich', user, (u) => deps.enrichUser(u))` |
| Pattern match | `step.match(id, result, { ok, err }, opts?)` | `step.match('handleUser', result, { ok: (u) => u.name, err: () => 'n/a' })` |
| Throwing fn (sync) | `step.try(id, fn, opts)` | `step.try('parse', () => JSON.parse(s), { error: 'PARSE_ERROR' })` |
| Throwing fn (async) | `step.try(id, fn, opts)` | `step.try('fetch', () => deps.fetchExternal(url), { error: 'FETCH_ERROR' })` |
| Result with error map | `step.fromResult(id, fn, opts)` | `step.fromResult('callApi', () => callApi(), { onError: ... })` |
| Retries | `step.retry(id, fn, opts)` | `step.retry('fetch', () => deps.fn(), { attempts: 3 })` |
| Timeout | `step.withTimeout(id, fn, opts)` | `step.withTimeout('slowOp', () => deps.fn(), { ms: 5000 })` |
| Sleep/delay | `step.sleep(id, duration, opts?)` | `step.sleep('rate-limit', '1s')` |
| Parallel (object) | `step.parallel(name, operations)` or `step.all(name, shape, opts?)` | `step.all('fetchAll', { user: () => deps.getUser(id), posts: () => deps.getPosts(id) })` |
| Parallel (array) | `step.parallel(name, callback)` | `step.parallel('Fetch all', () => allAsync([deps.getUser(id), deps.getPosts(id)]))` |
| Parallel over array | `step.map(id, items, mapper, opts?)` | `step.map('fetchUsers', ids, (id) => deps.getUser(id))` |
| Race | `step.race(name, callback)` | `step.race('Fastest API', () => anyAsync([primary(), fallback()]))` |
| All settled | `step.allSettled(name, callback)` | `step.allSettled('Fetch all', () => allSettledAsync([...]))` |

**All step helpers take a string as the first argument (ID or name). There is no `name` in options.** For `step.sleep`, the second argument is the duration (string like `'5s'` or a `Duration` from `awaitly/duration`). Single-argument `step.sleep('5s')` (old API) is invalid and fails at runtime—always use `step.sleep('id', duration, opts?)`. Use optional `key` in options for per-iteration identity (e.g. in loops).

**Effect-style helpers (`step.run`, `step.andThen`, `step.match`, `step.all`, `step.map`)** run through the full step engine: they emit step events, support retry/timeout options, and in `createWorkflow` use the cache and `onAfterStep` when you pass a key. Use a **getter** with `step.run` when caching so cache hits don't run the operation: `step.run('getUser', () => deps.getUser(id), { key: 'user:1' })`. For `step.all` and `step.map`, caching applies only when you pass an explicit `key`; without a key they do not cache by step id (matches core `run()` semantics).

**`step.try()` handles both sync and async**: It catches exceptions from sync code (like `JSON.parse`) and rejections from async code (like `fetch`).

**`step.try()` has the same control-flow as `step()`**: It returns the unwrapped value on success, or exits the workflow with the provided typed error on throw/rejection. Do not check `.ok` on its return value.

**Timeout returns `STEP_TIMEOUT`**: When `step.withTimeout()` times out, it returns `{ type: 'STEP_TIMEOUT', timeoutMs, stepName }` directly (not wrapped in `UNEXPECTED_ERROR`).

---

## Loops with step.forEach()

Use `step.forEach()` instead of manual `for` loops for static analyzability:

### Basic Usage

```typescript
// Process items with automatic indexing
await step.forEach('process-items', items, {
  stepIdPattern: 'item-{i}',
  run: async (item) => {
    const processed = await step('processItem', () => deps.processItem(item));
    return processed;
  }
});
```

### With Collected Results

```typescript
// Collect all results
const results = await step.forEach('fetch-users', userIds, {
  stepIdPattern: 'user-{i}',
  collect: 'array',  // or 'last' for only final result
  run: async (userId) => {
    return await step('getUser', () => deps.getUser(userId));
  }
});
```

### Why Not Manual Loops?

```typescript
// ❌ AVOID - dynamic keys reduce static analyzability
for (const item of items) {
  await step('process', () => process(item), { key: `process-${item.id}` });
}

// ✅ PREFERRED - step.forEach() is statically analyzable
await step.forEach('process', items, {
  stepIdPattern: 'process-{i}',
  run: (item) => step('processItem', () => process(item))
});
```

Manual `for` loops with dynamic keys like `${item.id}`:
- Cannot be enumerated by static analysis
- Reduce path generation accuracy
- Make test matrix generation incomplete

---

## Concurrency with allAsync, step.parallel, step.all, step.map

For parallel work, use **step.all** (Effect-style, named keys) or **step.parallel** (name is always the first argument) or wrap `allAsync` in `step()`. Use **step.map** to run a mapper over an array in parallel.

**Object form** (named keys; prefer `step.all` for Effect-style API):
```typescript
const { user, posts } = await step.all('fetchAll', {
  user: () => deps.getUser(id),
  posts: () => deps.getPosts(id),
});

// Same with step.parallel
const { user, posts } = await step.parallel('Fetch user and posts', {
  user: () => deps.getUser(id),
  posts: () => deps.getPosts(id),
});
```

**Array form** (wraps allAsync):
```typescript
import { Awaitly } from 'awaitly';

const [user, posts] = await step.parallel('Fetch user and posts', () =>
  Awaitly.allAsync([deps.getUser(id), deps.getPosts(id)])
);
```

**Map over array** (parallel, step-tracked):
```typescript
const users = await step.map('fetchUsers', userIds, (id) => deps.getUser(id));
```

Legacy `step.parallel(operations, { name })` is not supported; always pass the name as the first argument. **step.all** and **step.map** only use the workflow cache when you pass an explicit `key`; without a key they do not cache by step id.

---

## Common Patterns

These utilities work on Result values **outside workflows** (at boundaries, in deps, in tests).

### Default values

```typescript
import { Awaitly } from 'awaitly';

// Static default
const name = Awaitly.unwrapOr(result, 'Anonymous');

// Computed default (only called on Err)
const user = Awaitly.unwrapOrElse(result, () => createGuestUser());
```

### Transform values

```typescript
import { Awaitly } from 'awaitly';

// Transform Ok value
const upperName = Awaitly.map(result, user => user.name.toUpperCase());

// Transform Err value
const httpError = Awaitly.mapError(result, e => ({ code: 404, message: e }));
```

### Chain operations

```typescript
import { Awaitly } from 'awaitly';

// Chain Result-returning functions (flatMap)
const orderResult = Awaitly.andThen(userResult, user => createOrder(user));
```

### Fallback on error

```typescript
import { Awaitly } from 'awaitly';

// Try alternative on Err
const result = Awaitly.orElse(primaryResult, () => fallbackResult);
```

### Convert nullable to Result

```typescript
import { Awaitly } from 'awaitly';

// null/undefined → Err, value → Ok
const result = Awaitly.fromNullable(maybeUser, () => 'NOT_FOUND');
```

### Wrap throwing code (outside workflows)

```typescript
import { Awaitly } from 'awaitly';

// Sync throwing code → Result
const parsed = Awaitly.from(() => JSON.parse(data), () => 'PARSE_ERROR');

// Async throwing code → AsyncResult
const response = await Awaitly.fromPromise(fetch(url), () => 'FETCH_ERROR');

// With error context from the cause
const detailed = Awaitly.from(
  () => JSON.parse(data),
  (cause) => ({ type: 'PARSE_ERROR', message: String(cause) })
);
```

### Type guards

```typescript
import { Awaitly } from 'awaitly';

if (Awaitly.isOk(result)) {
  console.log(result.value);  // TypeScript knows it's Ok
}

if (Awaitly.isErr(result)) {
  console.log(result.error);  // TypeScript knows it's Err
}
```

### Side effects without changing Result

```typescript
import { Awaitly } from 'awaitly';

// Log success without changing result
const logged = Awaitly.tap(result, user => console.log('Got user:', user.id));

// Log error without changing result
const loggedErr = Awaitly.tapError(result, e => console.error('Failed:', e));
```

### Partial application at composition boundaries

```typescript
import { bindDeps } from 'awaitly/bind-deps';

// Core function: explicit fn(args, deps) for testing
const notify = (args: { name: string }, deps: { send: SendFn }) =>
  deps.send(args.name);

// At composition root: bind deps once
const notifySlack = bindDeps(notify)(slackDeps);
const notifyEmail = bindDeps(notify)(emailDeps);

// Call sites are clean
await notifySlack({ name: 'Alice' });
```

---

## Error Types

| Need | Use |
|------|-----|
| Simple states | String: `'NOT_FOUND'` |
| Error with context | Object: `{ type: 'NOT_FOUND', userId: string }` |
| 3+ variants | `TaggedError` with `match()` |

Start with strings. Migrate to objects when you need context.

---

## Complete Template

### Simple: run() with closures

`run()` without options wraps ALL errors as `UnexpectedError`. To get typed errors, use `catchUnexpected`:

```typescript
import { Awaitly, type AsyncResult } from 'awaitly';
import { run } from 'awaitly/run';

// deps return Results, never throw
async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
  const user = await db.find(id);
  return user ? Awaitly.ok(user) : Awaitly.err('NOT_FOUND');
}

async function createOrder(user: User): AsyncResult<Order, 'ORDER_FAILED'> {
  // ...
}

type MyErrors = 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED';

// Execute workflow with catchUnexpected for typed errors
export async function handleRequest(userId: string) {
const result = await run<Order, MyErrors>(
  async (step) => {
    const user = await step('getUser', getUser(userId));
    const order = await step('createOrder', createOrder(user));
    return order;
  },
  {
    catchUnexpected: () => 'UNEXPECTED' as const,
  }
);

  // Handle at boundary - all errors are typed
  if (result.ok) {
    return { status: 200, body: result.value };
  }

  switch (result.error) {
    case 'NOT_FOUND': return { status: 404 };
    case 'ORDER_FAILED': return { status: 400 };
    case 'UNEXPECTED': return { status: 500 };
  }
}
```

**Without `catchUnexpected`**: errors are `UnexpectedError` with original error in `cause`:
```typescript
const result = await run(async (step) => {
  const user = await step('getUser', getUser(userId));
  return user;
});

if (!result.ok && result.error.type === Awaitly.UNEXPECTED_ERROR) {
  // Access original error via cause
  const cause = result.error.cause;
  if (cause.type === 'STEP_FAILURE') {
    console.log('Original error:', cause.error); // 'NOT_FOUND'
  }
}
```

### Full: createWorkflow(deps) with DI

```typescript
import { Awaitly, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

// 1. deps return Results, never throw
const deps = {
  getUser: async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
    const user = await db.find(id);
    return user ? Awaitly.ok(user) : Awaitly.err('NOT_FOUND');
  },
  createOrder: async (user: User): AsyncResult<Order, 'ORDER_FAILED'> => {
    // ...
  },
};

// 2. Create workflow
const processOrder = createWorkflow(deps);

// 3. Execute with steps - no branching, no try/catch
export async function handleRequest(userId: string) {
  const result = await processOrder(async (step, deps) => {
    const user = await step('getUser', () => deps.getUser(userId));
    const order = await step('createOrder', () => deps.createOrder(user));
    return order;
  });

  // 4. Handle at boundary with normalized error access
  if (result.ok) {
    return { status: 200, body: result.value };
  }

  switch (result.error.type ?? result.error) {
    case 'NOT_FOUND': return { status: 404 };
    case 'ORDER_FAILED': return { status: 400 };
    case 'STEP_TIMEOUT': return { status: 504 };
    case Awaitly.UNEXPECTED_ERROR:
      console.error(result.error.cause);
      return { status: 500 };
  }
}
```

---

## Testing

Use type-safe assertions from `awaitly/testing`.

**Note**: Test helpers like `unwrapOk` throw on failure. This is acceptable in tests. Workflow rules (no throws, use `err()`) apply to workflow and dep code, not test code.

### Result assertions

```typescript
import { unwrapOk, unwrapErr } from 'awaitly/testing';

// unwrapOk returns the value directly, throws if Err
const user = unwrapOk(await deps.fetchUser('123'));
expect(user.name).toBe('Alice');

// unwrapErr returns the error, throws if Ok
const error = unwrapErr(await deps.fetchUser('unknown'));
expect(error).toBe('NOT_FOUND');
```

### Testing workflows

Test workflows by creating real deps and using `unwrapOk`/`unwrapErr`:

```typescript
import { createWorkflow } from 'awaitly/workflow';
import { Awaitly } from 'awaitly';
import { unwrapOk, unwrapErr } from 'awaitly/testing';

it('completes order flow', async () => {
  const deps = {
    getUser: async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
      id === '1' ? Awaitly.ok({ id, name: 'Alice' }) : Awaitly.err('NOT_FOUND'),
    createOrder: async (user: User): AsyncResult<Order, 'ORDER_FAILED'> =>
      Awaitly.ok({ orderId: '123' }),
  };

  const workflow = createWorkflow(deps);

  const result = await workflow(async (step, deps) => {
    const user = await step('getUser', () => deps.getUser('1'));
    return await step('createOrder', () => deps.createOrder(user));
  });

  expect(unwrapOk(result).orderId).toBe('123');
});

it('returns NOT_FOUND for unknown user', async () => {
  const deps = {
    getUser: async (id: string): AsyncResult<User, 'NOT_FOUND'> => Awaitly.err('NOT_FOUND'),
    createOrder: async (user: User): AsyncResult<Order, 'ORDER_FAILED'> => Awaitly.ok({ orderId: '123' }),
  };

  const workflow = createWorkflow(deps);

  const result = await workflow(async (step, deps) => {
    const user = await step('getUser', () => deps.getUser('unknown'));
    return await step('createOrder', () => deps.createOrder(user));
  });

  expect(unwrapErr(result)).toBe('NOT_FOUND');
});
```

### Testing retries

```typescript
it('retries on failure', async () => {
  let attempts = 0;

  const deps = {
    fetchData: async (): AsyncResult<{ data: string }, 'NETWORK_ERROR'> => {
      attempts++;
      if (attempts < 3) return Awaitly.err('NETWORK_ERROR');
      return Awaitly.ok({ data: 'success' });
    },
  };

  const workflow = createWorkflow(deps);

  const result = await workflow(async (step, deps) => {
    return await step.retry('fetchData', () => deps.fetchData(), { attempts: 3 });
  });

  expect(unwrapOk(result).data).toBe('success');
  expect(attempts).toBe(3);
});
```

---

## Documentation and static analysis

### Documentation options

- **Workflows:** Set `description` and `markdown` in `createWorkflow` (deps or second-argument options) for doc generation and static analysis. Not available on `run()` / `runSaga()` (no options object).
- **Steps:** Set `description` and `markdown` in step options, e.g. `step('id', fn, { key, description, markdown })`, `step.sleep(id, duration, { description, markdown })`, `saga.step('name', fn, { description, markdown, compensate })`.

### Static analysis output

`awaitly-analyze` can output JSON via `renderStaticJSON(ir)`. The shape includes:

- `root.workflowName`, `root.description`, `root.markdown`
- `root.children` (steps and control nodes; steps have `stepId`, `name`, `key`, `description`, `markdown`)
- `root.dependencies` (each: `name`, `typeSignature?` when type checker available, `errorTypes`)

Full structure is documented in awaitly-analyze README (“JSON output shape”) and in `packages/awaitly-analyze/schema/static-workflow-ir.schema.json`.

### Options quick reference

| Context | Option keys (use when generating/editing workflow code) |
|---------|--------------------------------------------------------|
| Workflow (createWorkflow / createSagaWorkflow) | `description`, `markdown`, `strict`, `catchUnexpected`, `onEvent`, `createContext`, `cache`, `resumeState`, `signal`, `streamStore` |
| Step (step, step.run, step.andThen, step.match, step.all, step.map, step.sleep, step.retry, step.withTimeout, step.try, step.fromResult, step.parallel, step.race, step.allSettled) | **Every step type**: first arg is string (ID or name, required). No `name` in options. `step(id, fn, opts)`, `step.run(id, result | getter, opts?)`, `step.andThen(id, value, fn, opts?)`, `step.match(id, result, { ok, err }, opts?)`, `step.all(name, shape, opts?)`, `step.map(id, items, mapper, opts?)`, `step.retry(id, fn, opts)`, `step.withTimeout(id, fn, opts)`, `step.try(id, fn, opts)`, `step.fromResult(id, fn, opts)`, `step.sleep(id, duration, opts?)`, `step.parallel(name, operations | callback)`, `step.race(name, callback)`, `step.allSettled(name, callback)`. Options (where applicable): `key`, `description`, `markdown`, `ttl`, `retry`, `timeout`, `signal`. For createWorkflow cache: use getter with `step.run` when using key; `step.all`/`step.map` only cache when `key` is provided. |
| Saga step (saga.step / saga.tryStep) | First argument is step name (required). Options: `description`, `markdown`, `compensate`. No `name` in options. |

---

## Imports

**Recommended:** Use the `Awaitly` namespace for a clean, organized API surface:

```typescript
// Core - All-in-one namespace (recommended)
import { Awaitly, type AsyncResult, type Result } from 'awaitly';

// Access everything via Awaitly:
Awaitly.ok(value)
Awaitly.err(error)
Awaitly.map(result, fn)
Awaitly.allAsync([...])
Awaitly.UNEXPECTED_ERROR

// Simple workflow (closures, no DI)
import { run } from 'awaitly/run';

// Full workflow (DI, retries, timeout)
import { createWorkflow } from 'awaitly/workflow';

// Partial application
import { bindDeps } from 'awaitly/bind-deps';

// Testing
import { unwrapOk, unwrapErr } from 'awaitly/testing';
```

**Alternative:** Named imports (backwards compatible):

```typescript
// Core - Named imports (still supported)
import {
  ok, err,                           // constructors
  type AsyncResult, type Result,     // types
  unwrapOr, unwrapOrElse,           // defaults
  map, mapError,                     // transform
  andThen, orElse,                   // chain
  fromNullable, from, fromPromise,   // wrap
  isOk, isErr,                       // guards
  tap, tapError,                     // side effects
  allAsync,                          // parallel
  UNEXPECTED_ERROR,                  // error discriminant
} from 'awaitly';
```

**Tree-shaking:** For minimal bundle size, use the `awaitly/result` entry point:

```typescript
// Result types only (minimal bundle, no namespace)
import { ok, err, type AsyncResult } from 'awaitly/result';
```
