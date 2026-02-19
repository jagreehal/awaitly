---
name: awaitly-patterns
description: "Core patterns for awaitly: typed async workflows with automatic error inference. Use when writing workflows, migrating from try/catch, or debugging Result types."
user-invocable: true
---

# Awaitly Core Patterns

**This document defines the supported patterns for using awaitly. Avoid inventing alternatives.** Effect-style helpers (run, andThen, match, all, map) keep the API as close to Effect as we can get while still using async/await and not generators.

Workflows are sequential unless explicitly composed using step concurrency helpers like `step.all`, `step.parallel`, or `step.map`. `Awaitly.allAsync()` is the underlying Result combinator and should typically be executed inside a step.

**Execution is only via `workflow.run()`.** There is no callable form (`workflow(fn)` or `workflow(args, fn)`). Use closures for workflow input (e.g. `userId` in scope).

**Callback shape:** Workflow callbacks receive a single destructured object:
- `run()` (from `awaitly/run`): `async ({ step }) => { ... }` — deps via closures.
- `createWorkflow('name', deps)` → **execute with** `workflow.run(fn)`: `async ({ step, deps }) => { ... }`. Optional `ctx` when `createContext` is set: `async ({ step, deps, ctx }) => { ... }`.

**Call form (mechanical):**
- **Anonymous run:** `await workflow.run(async ({ step, deps }) => { ... })`
- **With per-run config (deps override, onEvent, etc.):** `await workflow.run(async ({ step, deps }) => { ... }, { deps: overrideDeps, onEvent })`
- **Named run (for logging/tracing/resume):** `await workflow.run('my-run', async ({ step, deps }) => { ... })`
- **Named run with config:** `await workflow.run('my-run', async ({ step, deps }) => { ... }, { deps: mockDeps })`
- **Persistence (resume state):** `await workflow.runWithState(fn)` or `workflow.runWithState(fn, config)` returns `{ result, resumeState }` for persisting partial state.

---

## Agent Contract (MUST follow)

Use this as a checklist when generating or editing awaitly code. Satisfy every item; no interpretation.

### Execution
- **MUST** execute workflows via `workflow.run(...)` or `workflow.runWithState(...)`.
- **MUST NOT** use callable form: `workflow(fn)` or `workflow(args, fn)`.

### Async discipline
- **MUST** wrap all async work in `step()` or a step helper.
- **MUST NOT** use bare `await deps.fn()` inside workflow callbacks. Replace with `await step('id', () => deps.fn())`.
- **MUST NOT** wrap `step()` calls in `try/catch`. Use `step.try()` for throw-to-typed conversion.

### Step identity
- The first argument to every step **MUST** be a **static string literal** (e.g. `step('getUser', ...)`).
- **MUST NOT** use a computed, concatenated, templated, or variable-derived value (e.g. `` step(`user-${i}`, ...) `` or `const id = 'getUser'; step(id, ...)`). Use a literal ID + optional `{ key }` for per-item identity.

### Error handling at boundaries
- **MUST** check `result.error === Awaitly.UNEXPECTED_ERROR` first when handling `!result.ok`.
- **MUST** normalize other errors with `result.error.type ?? result.error` (handles string and object errors, including `STEP_TIMEOUT`).

### Concurrency inside workflows
- **MUST NOT** use `Promise.all`, `Promise.race`, or `Promise.allSettled` inside workflows. Replace with `step.all`, `step.map`, `step.parallel`, or `step.race` (consult types).

### Workflow callback invariants
Inside a workflow callback:
- **MUST** return raw values (not `Result`).
- **MUST NOT** call `Awaitly.ok()` or `Awaitly.err()` directly.
- **MUST NOT** manually propagate `Result` objects (e.g. `return userResult`).
- **MUST NOT** call `return step(...)` directly from inside conditionals without awaiting it.
- `step()` always returns the unwrapped Ok value.
- On Err, the callback is exited automatically; do not return the Err.

### API surface constraint
- **MUST NOT** invent new step helpers.
- **MUST NOT** assume undocumented overloads.
- **MUST NOT** assume `step()` is globally available outside workflow callbacks.
- If a helper is not listed here, consult package types before using it.

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
// createWorkflow('name', deps)
await step('getUser', deps.getUser(id));

// run(): deps via closures
await step('getUser', getUser(id));
```

**Prefer thunk form** (`() => deps.fn()`) unless you have a specific reason not to. **Direct form is allowed only when:** no retries, no caching, and no conditional execution. When in doubt, use the thunk form.

**When thunk form is required:**
- Retries (`step.retry`) — needs to re-execute.
- Caching with keys — checks cache before executing.
- Expensive operations — defer until needed.

**When direct form is allowed (all must hold):**
- No retries, no caching, no conditional execution.
- You already have a Result/Promise to unwrap and do not need step to re-invoke.

**Step APIs:** Every step type takes a string as the first argument (ID or name). There is no `name` in options—the first argument is the step name/id. Use optional `key` in options for per-iteration identity (e.g. in loops). See the **Step Helpers** table below and package types for full signatures.

**Label vs instance:** The first argument is the step **label** (category, e.g. `'fetchUser'`). The optional `key` is the **instance** identity (which iteration or entity). In loops, use one literal ID + key: `step('fetchUser', () => fetchUser(id), { key: \`user:${id}\` })`. Rules of thumb for key: stable (same input → same key); scoped to the step (e.g. `fetchUser:${id}`, `user:${id}`); keep short for logs/snapshots.

**Step ID naming cheatsheet:**

| Pattern | Step ID | Notes |
|---------|---------|-------|
| Fetch a resource | `'getUser'`, `'fetchOrder'` | Verb + noun, camelCase |
| Create/write | `'createOrder'`, `'sendEmail'` | Action verb + noun |
| Validation | `'validateInput'`, `'checkInventory'` | Verb + what's checked |
| Parallel group | `'fetchAll'`, `'validateOrder'` | Describes the group |
| Retry target | `'chargeCard'` | Same name as the dep being retried |
| Sleep/delay | `'rateLimitDelay'`, `'cooldown'` | Describes the wait reason |
| In a loop | `'processItem'` + `{ key: \`item:${id}\` }` | Literal ID + dynamic key |

### R2: On Err, step() short-circuits the workflow

When a step resolves to `Err`, `step()` short-circuits the workflow and `workflow.run()` resolves to that `Err`. **Inside workflows, `step()` returns the unwrapped Ok value; on Err the workflow callback is not continued.** Do not return Result objects from the callback—return raw values.

**MUST NOT** call deps directly and then manually branch on `.ok`—it bypasses step tracking and breaks retries/caching. **MUST** use `step()` (or a step helper) for any async dep call. Using `step.match(id, result, { ok, err })` or `step.fromResult(id, fn, opts)` is allowed; they keep control flow inside the step engine.

```typescript
// step handles early exit automatically
const user = await step('getUser', () => deps.getUser(id));
const order = await step('createOrder', () => deps.createOrder(user));
```

```typescript
// MUST NOT - calling dep directly and branching bypasses step tracking
const userResult = await deps.getUser(id);  // not through step
if (!userResult.ok) return userResult;
const order = await step('createOrder', () => deps.createOrder(userResult.value));
// Replace with: const user = await step('getUser', () => deps.getUser(id)); then use user.
```

### R3: Handle `"UNEXPECTED_ERROR"` at boundaries, normalize other errors with `error.type ?? error`

Errors can be strings (`'NOT_FOUND'`), objects (`{ type: 'NOT_FOUND', id }`), or the `"UNEXPECTED_ERROR"` string for uncaught exceptions. Always check for `"UNEXPECTED_ERROR"` first (it's a plain string, not an object), then normalize the rest:

```typescript
import { Awaitly } from 'awaitly';

if (!result.ok) {
  if (result.error === Awaitly.UNEXPECTED_ERROR) {
    // result.cause has the original thrown Error
    console.error('Bug:', result.cause);
    return { status: 500 };
  }

  // Typed errors: normalize with .type ?? error for mixed string/object unions (includes STEP_TIMEOUT)
  switch (result.error.type ?? result.error) {
    case 'NOT_FOUND': return { status: 404 };
    case 'ORDER_FAILED': return { status: 400 };
    case 'STEP_TIMEOUT': return { status: 504 };
  }
}
```

### R4: `"UNEXPECTED_ERROR"` is a string in the error union

`run()` and `createWorkflow` always include `"UNEXPECTED_ERROR"` in the error union. It represents any thrown exception escaping a dep. The original thrown value is in `result.cause`, not `result.error.cause`.

### R5: All async work inside workflows must go through step()

**MUST** use `step()` or a step helper for every async operation. **MUST NOT** use bare `await` on async deps inside workflow callbacks. Replace with `await step('id', () => deps.fn())`.

```typescript
const user = await step('getUser', () => deps.getUser(id));
const data = await step.try('fetch', () => deps.fetchExternal(url), { error: 'FETCH_ERROR' });
```

```typescript
// MUST NOT - bare await bypasses error handling and tracking
const user = await deps.getUser(id);
const response = await deps.fetchExternal(url);
// Replace with: await step('getUser', () => deps.getUser(id)); await step('fetch', () => deps.fetchExternal(url));
```

### R6: Don't wrap step() in try/catch

Errors from `step()` propagate automatically to the workflow result. Wrapping steps in `try/catch` breaks that guarantee. If you need to convert thrown errors to typed errors, use `step.try()`—not try/catch.

```typescript
// Errors propagate to workflow result
const result = await workflow.run(async ({ step, deps }) => {
  const payment = await step('makePayment', () => deps.makePayment());
  return payment;
});

// Handle errors at the boundary
if (!result.ok) {
  if (result.error === Awaitly.UNEXPECTED_ERROR) {
    console.error('Bug:', result.cause);
  } else {
    switch (result.error.type ?? result.error) {
      case 'PAYMENT_FAILED':
        await handleFailedPayment(result.error);
        break;
    }
  }
}
```

```typescript
// MUST NOT - try/catch defeats typed error propagation
try {
  const result = await step('makePayment', () => deps.makePayment());
} catch (error) {
  await step('handleFailed', () => deps.handleFailed(error));
}
// Replace with: step.try() for throw-to-typed conversion, or handle errors at boundary only.
```

If you need per-item error handling in a loop, use `step.forEach()` with error collection.

---

## MUST NOT + Replacement (Agent Rules)

### Execution
| MUST NOT | Replacement |
|----------|-------------|
| `workflow(fn)` or `workflow(args, fn)` (callable) | `workflow.run(async ({ step, deps }) => { ... })`. Use closures for input. |
| Pass options as first arg to `.run()` | Pass per-run options as the **second** argument: `workflow.run(fn, { deps, onEvent })`. |

### Inside Workflows
| MUST NOT | Replacement |
|----------|-------------|
| `step(...)` without string ID as first argument | `step('id', fn, opts)` or `step('id', result, opts)`. First argument MUST be a literal string. |
| Template literal as step ID (e.g. `` step(`step-${i}`, ...) ``) | Literal ID + `key`: `step('fetchUser', () => fetchUser(i), { key: \`user:${i}\` })`. |
| `step(promise)` when using retries/caching | Thunk form: `step('id', () => deps.fn(args))`. |
| `step.run(id, promise, { key })` in createWorkflow when you need lazy execution | `step.run` takes a result directly: `step.run(id, deps.fn(), { key })`. If you need lazy execution (cache check before running), use `step(id, () => deps.fn(), { key })`. |
| Bare `await deps.fn()` (or any async without step) | `await step('id', () => deps.fn())`. |
| Manual `if (!result.ok)` after calling deps directly | Call through step; step() short-circuits on Err. |
| `Promise.all`, `Promise.race`, or `Promise.allSettled` inside workflows | `step.all`, `step.map`, `step.parallel`, or `step.race`. See Concurrency section. |
| `throw` in deps | Return `err()` instead, or wrap with `step.try(id, fn, { error: 'TYPED_ERROR' })`. |
| `try/catch` around step() | Remove try/catch; errors propagate to workflow result. Use `step.try()` only for converting throws to typed errors. |

Synchronous computation and pure logic are allowed inside workflows. Only async operations require `step()`.

---

## Autofix Rules (deterministic rewrites)

When you see these patterns, apply the rewrite:

| See | Rewrite to |
|-----|------------|
| `workflow(async ...)` or `workflow(args, async ...)` | `workflow.run(async ...)`. Use closures for args. |
| `Promise.all([...])` inside a workflow callback | `step.all('name', { a: () => opA(), b: () => opB() })` or `step.parallel('name', () => Awaitly.allAsync([...]))`. |
| `try { await step(...) } catch (e) { ... }` | Remove try/catch; handle errors at boundary. If converting throws: `step.try('id', fn, { error: 'ERR' })`. |
| `const x = await deps.fn()` (no step) | `const x = await step('id', () => deps.fn())`. |
| Options object as first argument to `workflow.run(...)` | Move options to second argument: `workflow.run(fn, options)`. |
| `return result` from a boundary handler (e.g. HTTP) | **MUST NOT** let Result objects escape. Convert to HTTP/status mapping using the boundary handling canonical snippet (check `result.ok`, then `result.error === Awaitly.UNEXPECTED_ERROR`, then `result.error.type ?? result.error`). |

---

## Choosing Your Pattern

**Canonical signatures:**
- `run(callback, options?)` — `import { run } from 'awaitly/run'` (standalone; no workflow object).
- `createWorkflow('name', deps, options?)` returns a workflow object; **execute only via** `workflow.run(fn)`, `workflow.run(fn, config)`, `workflow.run(name, fn)`, or `workflow.run(name, fn, config)` — `import { createWorkflow } from 'awaitly/workflow'`.

| Aspect | `run()` | `createWorkflow('name', deps)` |
|--------|---------|-------------------------------|
| Import | `awaitly/run` | `awaitly/workflow` |
| Execute | `run(fn)` or `run(fn, options)` | `workflow.run(fn)` or `workflow.run(fn, config)` or `workflow.run(name, fn)` or `workflow.run(name, fn, config)` — **no callable** |
| Step syntax | `step('id', promiseOrResult)` or `step('id', () => promiseOrResult)` | `step('id', deps.fn(args))` or `step('id', () => deps.fn(args))` |
| Deps | Closures | Injected at creation; override per run with `workflow.run(fn, { deps: partialOverride })` |
| Error types | **Recommended:** `run<T, ErrorOf<typeof dep>>(fn)` or `run<T, Errors<[typeof d1, typeof d2]>>(fn)` so `result.error` is typed. Or manual `E`; or `catchUnexpected` for custom unexpected. | Auto-inferred from deps |
| Features | Basic step execution | Retries, timeout, state persistence, caching |
| Bundle | Smaller | Larger |
| Best for | Single-use, wrapping throwing APIs | Shared deps, DI, testing (deps override), typed errors (best DX) |

### Use `run()` when:
- Single-use workflow (not reused across files)
- Dependencies available via closures
- Wrapping throwing APIs with `step.try()`
- Minimal bundle size matters

### Use `createWorkflow('name', deps)` when:
- Shared deps across multiple workflows
- Need dependency injection for testing
- Deps already return `AsyncResult`
- Need retries, timeout, or state persistence

**Deps and throwing:** Prefer deps that return Results and never throw. If you can't control a dep (e.g. third-party), wrap it with `step.try()` or convert at the boundary.

---

## Do / Don't — Canonical Snippets (copy these)

Agents: use these as the single canonical style for each entrypoint.

### run() canonical
```typescript
import { run } from 'awaitly/run';
import { type ErrorOf } from 'awaitly';

type RunErrors = ErrorOf<typeof fetchUser>;
const result = await run<Value, RunErrors>(async ({ step }) => {
  const user = await step('fetchUser', () => fetchUser(id));
  return user;
});
```

### createWorkflow() canonical (execute only via .run())
```typescript
import { createWorkflow } from 'awaitly/workflow';

const workflow = createWorkflow('myWorkflow', deps);
const result = await workflow.run(async ({ step, deps }) => {
  const user = await step('getUser', () => deps.getUser(id));
  return user;
});
```

### Boundary handling canonical
```typescript
if (!result.ok) {
  if (result.error === Awaitly.UNEXPECTED_ERROR) {
    console.error('Bug:', result.cause);
    return { status: 500 };
  }
  switch (result.error.type ?? result.error) {
    case 'NOT_FOUND': return { status: 404 };
    case 'ORDER_FAILED': return { status: 400 };
    case 'STEP_TIMEOUT': return { status: 504 };
  }
}
```

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

**Recommended pattern for `run()`:** Derive the error type with `ErrorOf<typeof dep>` and pass it as the second type parameter to `run<T, RunErrors>()`. This gives typed `result.error` (your errors plus `"UNEXPECTED_ERROR"`) without manual unions.

```typescript
import { run } from 'awaitly/run';
import { ok, type AsyncResult } from 'awaitly';
import { type ErrorOf } from 'awaitly';

type User = { id: string; name: string };

const fetchUser = async (): AsyncResult<User, 'NOT_FOUND'> =>
  ok({ id: '1', name: 'Alice' });

type RunErrors = ErrorOf<typeof fetchUser>;

const result = await run<User, RunErrors>(async ({ step }) => {
  const user = await step('fetchUser', () => fetchUser());
  return user;
});
// result.error is: 'NOT_FOUND' | 'UNEXPECTED_ERROR'
```

**Multiple deps:** Use `Errors<[typeof dep1, typeof dep2, ...]>` for the union of all dep error types:

```typescript
import { run } from 'awaitly/run';
import { type ErrorOf, type Errors } from 'awaitly';

// Single dep: ErrorOf<typeof fn>
type RunErrors = ErrorOf<typeof getUser>;
const result = await run<Order, RunErrors>(async ({ step }) => {
  const user = await step('getUser', getUser(userId));
  return user;
});
// result.error is: 'NOT_FOUND' | 'UNEXPECTED_ERROR'

// Multiple deps: Errors<[...]> (union of all dep errors)
type AllErrors = Errors<[typeof getUser, typeof createOrder]>;
const result2 = await run<Order, AllErrors>(async ({ step }) => {
  const user = await step('getUser', getUser(userId));
  const order = await step('createOrder', createOrder(user));
  return order;
});
// result2.error is: 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED_ERROR'
```

**With explicit E** (manual type params):
```typescript
const result = await run<Order, 'NOT_FOUND' | 'ORDER_FAILED'>(
  async ({ step }) => {
    const user = await step('getUser', getUser(userId));
    const order = await step('createOrder', createOrder(user));
    return order;
  }
);
// result.error is: 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED_ERROR'
```

**With `catchUnexpected`** (custom unexpected type — replaces `"UNEXPECTED_ERROR"` with your type):
```typescript
type MyErrors = 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED';

const result = await run<Order, MyErrors>(
  async ({ step }) => {
    const user = await step('getUser', getUser(userId));
    const order = await step('createOrder', createOrder(user));
    return order;
  },
  { catchUnexpected: () => 'UNEXPECTED' as const }
);
// result.error is: 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED' (custom unexpected)
```

**Without type params** (error is `"UNEXPECTED_ERROR"` only):
```typescript
const result = await run(async ({ step }) => {
  const user = await step('getUser', getUser(userId));
  return user;
});
// result.error is: 'UNEXPECTED_ERROR' (step error types not preserved at compile time)
```

### Step 2b: Use `createWorkflow('name', deps)` for DI cases

For shared deps, testing, or advanced features (retries, timeout):

```typescript
import { createWorkflow } from 'awaitly/workflow';

const deps = { getUser, createOrder, sendEmail };
const processOrder = createWorkflow('processOrder', deps);
// TypeScript infers all error types from deps
```

### Step 3: Execute with workflow.run() and use step() inside (createWorkflow only)

```typescript
const result = await processOrder.run(async ({ step, deps }) => {
  const user = await step('getUser', () => deps.getUser(userId));
  const order = await step('createOrder', () => deps.createOrder(user));
  await step('sendEmail', () => deps.sendEmail(user.email, order));
  return order;
});
```

---

## Step Helpers

**Invariant:** Every step helper takes a **string as the first argument** (ID or name). There is no `name` in options. Use optional `key` in options for per-iteration identity (e.g. in loops). **For full signatures and any helpers not listed here, consult package types.**

| Need | Use (first arg = string ID) | Example |
|------|------------------------------|---------|
| Result-returning fn | `step(id, fn, opts)` | `step('getUser', () => deps.getUser(id))` |
| Unwrap AsyncResult | `step.run(id, result, opts?)` | `step.run('getUser', deps.getUser(id), { key: 'user:1' })` |
| Chain from value | `step.andThen(id, value, fn, opts?)` | `step.andThen('enrich', user, (u) => deps.enrichUser(u))` |
| Pattern match on Result | `step.match(id, result, { ok, err }, opts?)` | `step.match('handleUser', result, { ok: (u) => u.name, err: () => 'n/a' })` |
| Throwing fn → typed error | `step.try(id, fn, opts)` | `step.try('parse', () => JSON.parse(s), { error: 'PARSE_ERROR' })` |
| Result with error map | `step.fromResult(id, fn, opts)` | `step.fromResult('callApi', () => callApi(), { onError: ... })` |
| Retries | `step.retry(id, fn, opts)` | `step.retry('fetch', () => deps.fn(), { attempts: 3 })` |
| Timeout | `step.withTimeout(id, fn, opts)` | `step.withTimeout('slowOp', () => deps.fn(), { ms: 5000 })` |
| Sleep/delay | `step.sleep(id, duration, opts?)` | `step.sleep('rate-limit', '1s')` — id and duration required. |
| Parallel (object) | `step.all(name, shape)` or `step.parallel(name, operations)` | `step.all('fetchAll', { user: () => deps.getUser(id), posts: () => deps.getPosts(id) })` |
| Parallel (array) | `step.parallel(name, callback)` | `step.parallel('Fetch users', () => Awaitly.allAsync([deps.getUser('1'), deps.getUser('2')]))` |
| Parallel over array | `step.map(id, items, mapper, opts?)` | `step.map('fetchUsers', ids, (id) => deps.getUser(id))` |

Other helpers (e.g. `step.race`, `step.allSettled`) may exist; consult package types before use.

**Effect-style helpers (`step.run`, `step.andThen`, `step.match`, `step.all`, `step.map`)** run through the full step engine: they emit step events, support retry/timeout options, and in `createWorkflow` use the cache and `onAfterStep` when you pass a key. `step.run` takes an already-created `AsyncResult` (no getter overload): `step.run('getUser', deps.getUser(id), { key: 'user:1' })`. If you need lazy execution with cache short-circuit, use base `step`: `step('getUser', () => deps.getUser(id), { key: 'user:1' })`. For `step.all` and `step.map`, caching applies only when you pass an explicit `key`; without a key they do not cache by step id (matches core `run()` semantics).

**`step.try()` handles both sync and async**: It catches exceptions from sync code (like `JSON.parse`) and rejections from async code (like `fetch`).

**`step.try()` has the same control-flow as `step()`**: It returns the unwrapped value on success, or exits the workflow with the provided typed error on throw/rejection. Do not check `.ok` on its return value.

**Timeout returns `STEP_TIMEOUT`**: When `step.withTimeout()` times out, it returns `{ type: 'STEP_TIMEOUT', timeoutMs, stepName }` directly (not wrapped in `UNEXPECTED_ERROR`). Handle it at the boundary like other typed errors (normalize with `result.error.type ?? result.error`; see R3).

---

## Loops with step.forEach()

Prefer `step.forEach()` when you want static analyzability and predictable per-item step IDs. For analyzability use an index-based `stepIdPattern` (e.g. `'item-{i}'`); use `{ key }` inside the loop only when you need cache identity tied to the input.

### Agent rule: double-step is intentional

- **`step.forEach(..., { stepIdPattern, run })`** provides per-item **structural** step IDs for static analysis (e.g. `item-0`, `item-1`).
- The **inner** `step('processItem', () => deps.processItem(item))` inside `run` is **required**: it provides retries, caching, timeout, and typed error propagation for the actual operation.
- **MUST NOT** remove the inner `step(...)` thinking it is redundant. Both layers are intentional: forEach for structure, inner step for the engine.

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
// step.forEach() is statically analyzable
await step.forEach('process', items, {
  stepIdPattern: 'process-{i}',
  run: (item) => step('processItem', () => process(item))
});
```

```typescript
// Prefer step.forEach for analyzability; dynamic keys in manual loops reduce static analysis
for (const item of items) {
  await step('process', () => process(item), { key: `process-${item.id}` });
}
```

Manual `for` loops with dynamic keys like `${item.id}`:
- Cannot be enumerated by static analysis
- Reduce path generation accuracy
- Make test matrix generation incomplete

---

## Concurrency (Agent Rules)

**Preferred order (use first that fits):**
1. **`step.all(name, { key: () => op(), ... })`** — object form, named keys.
2. **`step.map(id, items, mapper)`** — parallel over array.
3. **`step.parallel(name, ...)`** — custom shape or `step.parallel(name, () => Awaitly.allAsync([...]))`.
4. **`Awaitly.allAsync([...])`** — ONLY inside a step callback (e.g. inside `step.parallel(name, () => Awaitly.allAsync([...]))`).

**MUST NOT** use `Promise.all`, `Promise.race`, or `Promise.allSettled` inside workflows. Replace with `step.all`, `step.map`, `step.parallel`, or `step.race` (consult types).

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

**Array form** (wraps Awaitly.allAsync):
```typescript
import { Awaitly } from 'awaitly';

const [user1, user2] = await step.parallel('Fetch users', () =>
  Awaitly.allAsync([deps.getUser('1'), deps.getUser('2')])
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

**Recommended:** Use `ErrorOf<typeof dep>` (single dep) or `Errors<[typeof d1, typeof d2, ...]>` (multiple deps) to derive the error type and pass it to `run<T, RunErrors>()`. `"UNEXPECTED_ERROR"` is always included automatically.

```typescript
import { Awaitly, type AsyncResult, type Errors } from 'awaitly';
import { run } from 'awaitly/run';

// deps return Results, never throw
async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
  const user = await db.find(id);
  return user ? Awaitly.ok(user) : Awaitly.err('NOT_FOUND');
}

async function createOrder(user: User): AsyncResult<Order, 'ORDER_FAILED'> {
  // ...
}

// Recommended: derive errors from deps
type RunErrors = Errors<[typeof getUser, typeof createOrder]>;

// Execute workflow with typed errors
export async function handleRequest(userId: string) {
  const result = await run<Order, RunErrors>(
    async ({ step }) => {
      const user = await step('getUser', getUser(userId));
      const order = await step('createOrder', createOrder(user));
      return order;
    }
  );
  // result.error is: 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED_ERROR'

  if (result.ok) {
    return { status: 200, body: result.value };
  }

  // Check for unexpected errors first (it's a plain string)
  if (result.error === Awaitly.UNEXPECTED_ERROR) {
    console.error('Bug:', result.cause);
    return { status: 500 };
  }

  switch (result.error) {
    case 'NOT_FOUND': return { status: 404 };
    case 'ORDER_FAILED': return { status: 400 };
  }
}
```

**With `catchUnexpected`** (custom unexpected type):
```typescript
type MyErrors = 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED';

const result = await run<Order, MyErrors>(
  async ({ step }) => {
    const user = await step('getUser', getUser(userId));
    const order = await step('createOrder', createOrder(user));
    return order;
  },
  { catchUnexpected: () => 'UNEXPECTED' as const }
);
// result.error is: 'NOT_FOUND' | 'ORDER_FAILED' | 'UNEXPECTED' (custom unexpected)
```

**Without type params** (only `"UNEXPECTED_ERROR"` in the type):
```typescript
const result = await run(async ({ step }) => {
  const user = await step('getUser', getUser(userId));
  return user;
});

if (!result.ok) {
  // result.error is 'UNEXPECTED_ERROR'
  // result.cause has the original thrown error
  console.error('Failed:', result.cause);
}
```

### Full: createWorkflow('name', deps) with DI — execute only via .run()

```typescript
import { Awaitly, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

// 1. deps return Results, never throw (see "Deps and throwing" above)
const deps = {
  getUser: async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
    const user = await db.find(id);
    return user ? Awaitly.ok(user) : Awaitly.err('NOT_FOUND');
  },
  createOrder: async (user: User): AsyncResult<Order, 'ORDER_FAILED'> => {
    // ...
  },
};

// 2. Create workflow (no callable; execute via .run() or .runWithState())
const processOrder = createWorkflow('processOrder', deps);

// 3. Execute with workflow.run() — no branching, no try/catch
export async function handleRequest(userId: string) {
  const result = await processOrder.run(async ({ step, deps }) => {
    const user = await step('getUser', () => deps.getUser(userId));
    const order = await step('createOrder', () => deps.createOrder(user));
    return order;
  });

  // 4. Handle at boundary — check "UNEXPECTED_ERROR" first (it's a plain string)
  if (result.ok) {
    return { status: 200, body: result.value };
  }

  if (result.error === Awaitly.UNEXPECTED_ERROR) {
    console.error('Bug:', result.cause);
    return { status: 500 };
  }

  switch (result.error.type ?? result.error) {
    case 'NOT_FOUND': return { status: 404 };
    case 'ORDER_FAILED': return { status: 400 };
    case 'STEP_TIMEOUT': return { status: 504 };
  }
}
```

---

## Testing

Use type-safe assertions from `awaitly/testing`. **Execute workflows only with `workflow.run()`** (no callable form).

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

### Testing workflows (always use workflow.run())

Test workflows by creating the workflow with deps and calling **`workflow.run(async ({ step, deps }) => { ... })`**:

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

  const workflow = createWorkflow('orderFlow', deps);

  const result = await workflow.run(async ({ step, deps }) => {
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

  const workflow = createWorkflow('orderFlow', deps);

  const result = await workflow.run(async ({ step, deps }) => {
    const user = await step('getUser', () => deps.getUser('unknown'));
    return await step('createOrder', () => deps.createOrder(user));
  });

  expect(unwrapErr(result)).toBe('NOT_FOUND');
});
```

### Overriding deps at run time (testing)

**`workflow.run(fn, { deps })`** overrides creation-time deps for that run only. Partial overrides merge with creation-time deps. Use this to inject mocks in tests without creating a new workflow.

```typescript
it('run(fn, { deps }) overrides creation-time deps for that run only', async () => {
  const getPosts = createWorkflow('getPosts', { fetchUser, fetchPosts });

  // First run: uses creation-time deps
  const result1 = await getPosts.run(async ({ step, deps }) => {
    const user = await step('fetchUser', () => deps.fetchUser('1'));
    return user.name;
  });
  expect(unwrapOk(result1)).toBe('Alice');

  // Second run: override fetchUser with a mock for this run only
  const mockFetchUser = vi.fn(async (id: string) =>
    Awaitly.ok({ id, name: 'Mock User', email: 'mock@test.com' })
  );
  const result2 = await getPosts.run(
    async ({ step, deps }) => {
      const user = await step('fetchUser', () => deps.fetchUser('1'));
      return user.name;
    },
    { deps: { fetchUser: mockFetchUser } }
  );
  expect(unwrapOk(result2)).toBe('Mock User');
  expect(mockFetchUser).toHaveBeenCalledWith('1');

  // Third run: no override, still uses original deps
  const result3 = await getPosts.run(async ({ step, deps }) => {
    const user = await step('fetchUser', () => deps.fetchUser('1'));
    return user.name;
  });
  expect(unwrapOk(result3)).toBe('Alice');
});

it('partial deps override merges with creation-time deps', async () => {
  const getPosts = createWorkflow('getPosts', { fetchUser, fetchPosts });
  const mockFetchUser = vi.fn(async (id: string) =>
    Awaitly.ok({ id, name: 'Overridden', email: 'o@test.com' })
  );

  // Override only fetchUser; fetchPosts stays from creation-time
  const result = await getPosts.run(
    async ({ step, deps }) => {
      const user = await step('fetchUser', () => deps.fetchUser('1'));
      const posts = await step('fetchPosts', () => deps.fetchPosts(user.id));
      return { userName: user.name, postsCount: posts.length };
    },
    { deps: { fetchUser: mockFetchUser } }
  );
  expect(unwrapOk(result).userName).toBe('Overridden');
  expect(unwrapOk(result).postsCount).toBe(1); // fetchPosts still original
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

  const workflow = createWorkflow('retryTest', deps);

  const result = await workflow.run(async ({ step, deps }) => {
    return await step.retry('fetchData', () => deps.fetchData(), { attempts: 3 });
  });

  expect(unwrapOk(result).data).toBe('success');
  expect(attempts).toBe(3);
});
```

### Named runs in tests

Use **`workflow.run('test-run', fn)`** or **`workflow.run('test-run', fn, config)`** when you need a stable run id for events or assertions:

```typescript
it('run(name, fn) uses name as workflowId in events', async () => {
  const events = [];
  const workflow = createWorkflow('myWorkflow', { fetchUser }, {
    onEvent: (e) => events.push(e),
  });

  await workflow.run('custom-run-id', async ({ step, deps }) => {
    return await step('getUser', () => deps.fetchUser('1'));
  });

  expect(events[0].workflowId).toBe('custom-run-id');
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
| Creation-time (createWorkflow / createSagaWorkflow) | `description`, `markdown`, `strict`, `catchUnexpected`, `onEvent`, `createContext`, `cache`, `resumeState`, `signal`, `streamStore` |
| Per-run (second argument to `workflow.run(fn, config)` or `workflow.run(name, fn, config)`) | `deps` (partial override; merges with creation-time deps), `onEvent`, `resumeState`, `cache`, `signal`, `createContext`, `onError`, `onBeforeStart`, `onAfterStep`, `shouldRun`, `streamStore` — use for testing (deps override) or per-run hooks. |
| Step (step, step.run, step.andThen, step.match, step.all, step.map, step.sleep, step.retry, step.withTimeout, step.try, step.fromResult, step.parallel, step.race, step.allSettled) | **Every step type**: first arg is string (ID or name, required). No `name` in options. `step(id, fn, opts)`, `step.run(id, result, opts?)`, `step.andThen(id, value, fn, opts?)`, `step.match(id, result, { ok, err }, opts?)`, `step.all(name, shape, opts?)`, `step.map(id, items, mapper, opts?)`, `step.retry(id, fn, opts)`, `step.withTimeout(id, fn, opts)`, `step.try(id, fn, opts)`, `step.fromResult(id, fn, opts)`, `step.sleep(id, duration, opts?)`, `step.parallel(name, operations | callback)`, `step.race(name, callback)`, `step.allSettled(name, callback)`. Options (where applicable): `key`, `description`, `markdown`, `ttl`, `retry`, `timeout`, `signal`. For createWorkflow cache: use `step(id, () => dep(), { key })` for lazy cache checks; `step.all`/`step.map` only cache when `key` is provided. |
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
