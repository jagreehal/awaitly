---
name: awaitly-patterns
description: "Core patterns for awaitly: typed async workflows with automatic error inference. Use when writing workflows, migrating from try/catch, or debugging Result types."
user-invocable: true
---

# Awaitly Core Patterns

**This document defines the only supported patterns for using awaitly. Do not invent alternatives.**

Workflows are sequential unless explicitly composed with helpers like `allAsync()`.

---

## Rules

### R1: step() accepts both forms

`step()` accepts both forms (in both `run()` and `createWorkflow()` workflows):

**Direct form** (Promise/Result passed immediately):
```typescript
// createWorkflow(deps): deps available
await step(deps.getUser(id));  // Already started; cannot be retried/cached-before-run

// run(): deps via closures
await step(getUser(id));       // Already started; cannot be retried/cached-before-run
```

**Thunk form** (deferred execution):
```typescript
await step(() => deps.getUser(id));  // Operation starts when step runs
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

### R2: On err, step() immediately returns that error as the workflow result

When `step()` receives an `err` result, it immediately returns that error as the workflow result. No wrapping, no transformation. Do not check `result.ok` inside workflows.

```typescript
// CORRECT - step handles early exit
const user = await step(() => deps.getUser(id));
const order = await step(() => deps.createOrder(user));

// WRONG - never check result.ok inside workflows
const userResult = await deps.getUser(id);  // calling dep directly, not through step
if (!userResult.ok) return userResult;
const order = await step(() => deps.createOrder(userResult.value));
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
import { UNEXPECTED_ERROR } from 'awaitly';

if (!result.ok) {
  if ((result.error.type ?? result.error) === UNEXPECTED_ERROR) {
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
const user = await step(() => deps.getUser(id));
const data = await step.try(() => deps.fetchExternal(url), { error: 'FETCH_ERROR' });

// WRONG - bare await bypasses error handling and tracking
const user = await deps.getUser(id);
const response = await deps.fetchExternal(url);
```

---

## Disallowed Inside Workflows

| Pattern | Why |
|---------|-----|
| `step(promise)` when using retries/caching | Direct form can't re-execute or cache-before-run; use thunk `step(() => deps.fn(args))` |
| `await x` without step | Bypasses error handling and tracking |
| `if (!result.ok)` checks | step() already handles early exit |
| `Promise.all()` | Disallowed even wrapped in step(); use `allAsync()` so errors are typed as Results |
| `throw` in deps | Return `err()` instead, or wrap with `step.try()` |
| `try/catch` | Use `step.try()` to convert throws to typed errors |

Synchronous computation and pure logic are allowed inside workflows. Only async operations require `step()`.

---

## Choosing Your Pattern

| Aspect | `run()` | `createWorkflow(deps)` |
|--------|---------|------------------------|
| Import | `awaitly` (core) | `awaitly/workflow` |
| Step syntax | `step(promiseOrResult)` or `step(() => promiseOrResult)` | `step(deps.fn(args))` or `step(() => deps.fn(args))` |
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
import { ok, err, type AsyncResult } from 'awaitly';

async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
  const user = await db.find(id);
  return user ? ok(user) : err('NOT_FOUND');
}
```

### Step 2a: Use `run()` for simple cases

For single-use workflows where deps are available via closures.

**With typed errors** (use `catchUnexpected`):
```typescript
import { run } from 'awaitly';

type MyErrors = 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED';

const result = await run<Order, MyErrors>(
  async (step) => {
    const user = await step(getUser(userId));
    const order = await step(createOrder(user));
    return order;
  },
  { catchUnexpected: () => 'UNEXPECTED' as const }
);
```

**Without options** (errors wrapped as `UnexpectedError`):
```typescript
const result = await run(async (step) => {
  const user = await step(getUser(userId));
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
  const user = await step(() => deps.getUser(userId));
  const order = await step(() => deps.createOrder(user));
  await step(() => deps.sendEmail(user.email, order));
  return order;
});
```

---

## Step Helpers

| Need | Use | Example |
|------|-----|---------|
| Result-returning fn | `step()` | `step(() => deps.getUser(id))` |
| Throwing fn (sync) | `step.try()` | `step.try(() => JSON.parse(s), { error: 'PARSE_ERROR' })` |
| Throwing fn (async) | `step.try()` | `step.try(() => deps.fetchExternal(url), { error: 'FETCH_ERROR' })` |
| Retries | `step.retry()` | `step.retry(() => deps.fn(), { attempts: 3 })` |
| Timeout | `step.withTimeout()` | `step.withTimeout(() => deps.fn(), { ms: 5000 })` |

**`step.try()` handles both sync and async**: It catches exceptions from sync code (like `JSON.parse`) and rejections from async code (like `fetch`).

**`step.try()` has the same control-flow as `step()`**: It returns the unwrapped value on success, or exits the workflow with the provided typed error on throw/rejection. Do not check `.ok` on its return value.

**Timeout returns `STEP_TIMEOUT`**: When `step.withTimeout()` times out, it returns `{ type: 'STEP_TIMEOUT', timeoutMs, stepName }` directly (not wrapped in `UNEXPECTED_ERROR`).

---

## Concurrency with allAsync

Use `allAsync()` for parallel operations. Always wrap in `step()`:

```typescript
// Parallel fetch with allAsync
const [user, posts] = await step(() => allAsync([
  deps.getUser(id),
  deps.getPosts(id),
]));
```

Import: `import { allAsync } from 'awaitly';`

---

## Common Patterns

These utilities work on Result values **outside workflows** (at boundaries, in deps, in tests).

### Default values

```typescript
import { unwrapOr, unwrapOrElse } from 'awaitly';

// Static default
const name = unwrapOr(result, 'Anonymous');

// Computed default (only called on Err)
const user = unwrapOrElse(result, () => createGuestUser());
```

### Transform values

```typescript
import { map, mapError } from 'awaitly';

// Transform Ok value
const upperName = map(result, user => user.name.toUpperCase());

// Transform Err value
const httpError = mapError(result, e => ({ code: 404, message: e }));
```

### Chain operations

```typescript
import { andThen } from 'awaitly';

// Chain Result-returning functions (flatMap)
const orderResult = andThen(userResult, user => createOrder(user));
```

### Fallback on error

```typescript
import { orElse } from 'awaitly';

// Try alternative on Err
const result = orElse(primaryResult, () => fallbackResult);
```

### Convert nullable to Result

```typescript
import { fromNullable } from 'awaitly';

// null/undefined → Err, value → Ok
const result = fromNullable(maybeUser, () => 'NOT_FOUND');
```

### Wrap throwing code (outside workflows)

```typescript
import { from, fromPromise } from 'awaitly';

// Sync throwing code → Result
const parsed = from(() => JSON.parse(data), () => 'PARSE_ERROR');

// Async throwing code → AsyncResult
const response = await fromPromise(fetch(url), () => 'FETCH_ERROR');

// With error context from the cause
const detailed = from(
  () => JSON.parse(data),
  (cause) => ({ type: 'PARSE_ERROR', message: String(cause) })
);
```

### Type guards

```typescript
import { isOk, isErr } from 'awaitly';

if (isOk(result)) {
  console.log(result.value);  // TypeScript knows it's Ok
}

if (isErr(result)) {
  console.log(result.error);  // TypeScript knows it's Err
}
```

### Side effects without changing Result

```typescript
import { tap, tapError } from 'awaitly';

// Log success without changing result
const logged = tap(result, user => console.log('Got user:', user.id));

// Log error without changing result
const loggedErr = tapError(result, e => console.error('Failed:', e));
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
import { run, ok, err, type AsyncResult, UNEXPECTED_ERROR } from 'awaitly';

// deps return Results, never throw
async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
  const user = await db.find(id);
  return user ? ok(user) : err('NOT_FOUND');
}

async function createOrder(user: User): AsyncResult<Order, 'ORDER_FAILED'> {
  // ...
}

type MyErrors = 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED';

// Execute workflow with catchUnexpected for typed errors
export async function handleRequest(userId: string) {
  const result = await run<Order, MyErrors>(
    async (step) => {
      const user = await step(getUser(userId));
      const order = await step(createOrder(user));
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
  const user = await step(getUser(userId));
  return user;
});

if (!result.ok && result.error.type === UNEXPECTED_ERROR) {
  // Access original error via cause
  const cause = result.error.cause;
  if (cause.type === 'STEP_FAILURE') {
    console.log('Original error:', cause.error); // 'NOT_FOUND'
  }
}
```

### Full: createWorkflow(deps) with DI

```typescript
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';
import { UNEXPECTED_ERROR } from 'awaitly';

// 1. deps return Results, never throw
const deps = {
  getUser: async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
    const user = await db.find(id);
    return user ? ok(user) : err('NOT_FOUND');
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
    const user = await step(() => deps.getUser(userId));
    const order = await step(() => deps.createOrder(user));
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
    case UNEXPECTED_ERROR:
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
import { ok, err } from 'awaitly';
import { unwrapOk, unwrapErr } from 'awaitly/testing';

it('completes order flow', async () => {
  const deps = {
    getUser: async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
      id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND'),
    createOrder: async (user: User): AsyncResult<Order, 'ORDER_FAILED'> =>
      ok({ orderId: '123' }),
  };

  const workflow = createWorkflow(deps);

  const result = await workflow(async (step, deps) => {
    const user = await step(() => deps.getUser('1'));
    return await step(() => deps.createOrder(user));
  });

  expect(unwrapOk(result).orderId).toBe('123');
});

it('returns NOT_FOUND for unknown user', async () => {
  const deps = {
    getUser: async (id: string): AsyncResult<User, 'NOT_FOUND'> => err('NOT_FOUND'),
    createOrder: async (user: User): AsyncResult<Order, 'ORDER_FAILED'> => ok({ orderId: '123' }),
  };

  const workflow = createWorkflow(deps);

  const result = await workflow(async (step, deps) => {
    const user = await step(() => deps.getUser('unknown'));
    return await step(() => deps.createOrder(user));
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
      if (attempts < 3) return err('NETWORK_ERROR');
      return ok({ data: 'success' });
    },
  };

  const workflow = createWorkflow(deps);

  const result = await workflow(async (step, deps) => {
    return await step.retry(() => deps.fetchData(), { attempts: 3 });
  });

  expect(unwrapOk(result).data).toBe('success');
  expect(attempts).toBe(3);
});
```

---

## Imports

`UNEXPECTED_ERROR` is imported from `awaitly` in all examples.

```typescript
// Core
import { ok, err, type AsyncResult } from 'awaitly';

// Simple workflow (closures, no DI)
import { run } from 'awaitly';

// Utilities (use outside workflows)
import {
  unwrapOr, unwrapOrElse,           // defaults
  map, mapError,                     // transform
  andThen, orElse,                   // chain
  fromNullable, from, fromPromise,   // wrap
  isOk, isErr,                       // guards
  tap, tapError,                     // side effects
  allAsync,                          // parallel
  UNEXPECTED_ERROR,                  // error discriminant
} from 'awaitly';

// Full workflow (DI, retries, timeout)
import { createWorkflow } from 'awaitly/workflow';

// Partial application
import { bindDeps } from 'awaitly/bind-deps';

// Testing
import { unwrapOk, unwrapErr } from 'awaitly/testing';
```
