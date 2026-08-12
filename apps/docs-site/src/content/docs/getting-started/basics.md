---
title: The Basics
description: Result types and run() - the two ideas the rest of awaitly builds on
---

There are only two ideas to learn here. Everything else in awaitly is built from them.

1. Operations return a **Result** instead of throwing.
2. **`run(deps, fn)`** unwraps those Results for you and exits at the first error.

## 1. Results instead of throws

An operation that can fail returns `AsyncResult<T, E>` — either `ok(value)` or `err(error)`:

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

const divide = async (a: number, b: number): AsyncResult<number, 'DIVIDE_BY_ZERO'> =>
  b === 0 ? err('DIVIDE_BY_ZERO') : ok(a / b);

const result = await divide(10, 2);

if (result.ok) {
  result.value; // number
} else {
  result.error; // 'DIVIDE_BY_ZERO' — and TypeScript knows that's the only option
}
```

The failure is in the **return type**, so the compiler can see it. That is the whole
point: `catch (error: unknown)` tells you nothing, `result.error` tells you everything.

## 2. Composing with `run()`

Checking `result.ok` after every call gets tedious fast. `run()` does it for you.

Pass your operations as the first argument. You get back an object with the same
keys, and calling one gives you the **unwrapped value**:

```typescript
import { run, ok, err, type AsyncResult } from 'awaitly';

type User = { id: string; name: string };
type Order = { id: number; total: number };

const getUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
  id === '1' ? ok({ id: '1', name: 'Alice' }) : err('NOT_FOUND');

const getOrders = async (userId: string): AsyncResult<Order[], 'FETCH_ERROR'> =>
  ok([{ id: 1, total: 99.99 }]);

const result = await run({ getUser, getOrders }, async (s) => {
  const user = await s.getUser('1');         // User, not Result<User, ...>
  const orders = await s.getOrders(user.id); // Order[], not Result<Order[], ...>
  return { user, orders };
});
```

Inside the callback there are no Results and no error checks — just values. The
property names (`getUser`, `getOrders`) become the step names used in diagrams and
traces, so you never write an id by hand.

## Errors exit early

If any operation returns `err`, the callback stops there and `run()` returns that error:

```typescript
const result = await run({ getUser, getOrders }, async (s) => {
  const user = await s.getUser('999');       // returns err('NOT_FOUND') — stops here
  const orders = await s.getOrders(user.id); // never runs
  return { user, orders };
});

result.ok;    // false
result.error; // 'NOT_FOUND'
```

No try/catch, no early-return ladder, no `if (!x.ok) return x`.

## What you get back

This is the part worth internalising, because it is what you are buying:

```typescript
const result = await run({ getUser, getOrders }, async (s) => { /* ... */ });
//    ^? Result<{ user: User; orders: Order[] }, 'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError>
```

The error union was **computed from the deps you passed**. You never declared it.
Add a third operation that can fail and the union widens on its own; delete one and
it narrows. Your `switch` over `result.error` breaks at compile time when it goes stale.

`UnexpectedError` is always in the union: it represents an operation that *threw*
rather than returning `err`. See [What TypeScript gives you back](getting-started/types/)
for the full rules.

## Handling it at the boundary

`match` gives you one arm per error, and the compiler checks you covered them all:

```typescript
import { match } from 'awaitly';

type Response = { status: number; data?: unknown };

const response = match(result, {
  ok: (value): Response => ({ status: 200, data: value }),
  NOT_FOUND: () => ({ status: 404 }),
  FETCH_ERROR: () => ({ status: 502 }),
  UnexpectedError: (error) => {
    console.error(error.cause); // the original thrown value
    return { status: 500 };
  },
});
```

Annotate the `ok` arm when the arms return different shapes. TypeScript takes the
return type from the first arm, so an unannotated `ok` would reject the others.

Add a fourth dep that fails a new way and this stops compiling until you handle it.

The `if`/`switch` form does the same job when your arms need statements rather than a
returned value. Narrow on `result.ok` first, then read `result.error`:

```typescript
import { isUnexpectedError } from 'awaitly';

if (result.ok) {
  return { status: 200, data: result.value };
}

if (isUnexpectedError(result.error)) {
  console.error(result.error.cause); // the original thrown value
  return { status: 500 };
}

switch (result.error) {
  case 'NOT_FOUND':   return { status: 404 };
  case 'FETCH_ERROR': return { status: 502 };
}
```

Pass `isUnexpectedError` the error, never the whole `Result`. `isUnexpectedError(result)`
takes `unknown`, so it compiles, and it returns `false` on every call.

## Next

`run()` is for one-off composition. When you want a workflow you can name, test,
retry, persist, and diagram, you reach for `createWorkflow()` — the same deps-first
idea with more capability.

[Build your first workflow →](getting-started/first-workflow/)
