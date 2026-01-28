---
title: The Basics
description: Learn Result types and run() - the simplest way to use awaitly
---

Before diving into workflows, let's cover the fundamentals: **Result types** and the **`run()`** function.

## Result types

Instead of throwing errors, awaitly uses Result types. Every operation returns either `ok(value)` or `err(error)`:

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

// Functions return Results instead of throwing
const divide = (a: number, b: number): AsyncResult<number, 'DIVIDE_BY_ZERO'> =>
  b === 0 ? err('DIVIDE_BY_ZERO') : ok(a / b);

const result = await divide(10, 2);

if (result.ok) {
  console.log(result.value); // 5
} else {
  console.log(result.error); // TypeScript knows this is 'DIVIDE_BY_ZERO'
}
```

This gives you:
- **Type safety**: TypeScript knows exactly what errors can occur
- **Explicit handling**: No hidden exceptions - errors are part of the return type
- **Composability**: Results can be chained and transformed

## The `run()` function

`run()` is the simplest way to compose multiple Result-returning operations:

```typescript
import { ok, err, type AsyncResult } from 'awaitly';
import { run } from 'awaitly/run';

// Define operations that return Results
const getUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
  const user = await db.find(id);
  return user ? ok(user) : err('NOT_FOUND');
};

const getOrders = async (userId: string): AsyncResult<Order[], 'FETCH_ERROR'> => {
  const orders = await db.orders.findByUser(userId);
  return ok(orders);
};

// Compose them with run()
const result = await run(async (step) => {
  const user = await step(getUser('123'));
  const orders = await step(getOrders(user.id));
  return { user, orders };
});
```

## Using `step()` for early exit

The `step()` function unwraps Results automatically. If any step returns an error, the workflow exits immediately:

```typescript
const result = await run(async (step) => {
  // If getUser returns err('NOT_FOUND'), we exit here
  const user = await step(getUser('unknown'));

  // This line never runs if getUser failed
  const orders = await step(getOrders(user.id));

  return { user, orders };
});

// result.ok is false, result.error is 'NOT_FOUND'
```

No try/catch, no manual error checking - `step()` handles it all.

## Handling the result

At your application boundary, check the result:

```typescript
if (result.ok) {
  // Success path
  return { status: 200, data: result.value };
} else {
  // Error path - TypeScript knows all possible errors
  switch (result.error.type ?? result.error) {
    case 'NOT_FOUND':
      return { status: 404 };
    case 'FETCH_ERROR':
      return { status: 500 };
  }
}
```

## Complete example

```typescript
import { ok, err, type AsyncResult } from 'awaitly';
import { run } from 'awaitly/run';

type User = { id: string; name: string };
type Order = { id: number; total: number };

const getUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
  id === '1' ? ok({ id: '1', name: 'Alice' }) : err('NOT_FOUND');

const getOrders = async (userId: string): AsyncResult<Order[], 'FETCH_ERROR'> =>
  ok([{ id: 1, total: 99.99 }]);

const result = await run(async (step) => {
  const user = await step(getUser('1'));
  const orders = await step(getOrders(user.id));
  return { user, orders };
});

if (result.ok) {
  console.log(`${result.value.user.name} has ${result.value.orders.length} orders`);
}
```

## When to use `createWorkflow()`

`run()` is great for simple workflows. Graduate to `createWorkflow()` when you need:

| Need | Use |
|------|-----|
| Dependency injection for testing | `createWorkflow(deps)` |
| Retries, timeouts, caching | `createWorkflow(deps)` with step helpers |
| State persistence | `createWorkflow(deps)` |
| Auto-inferred error types from deps | `createWorkflow(deps)` |

For most cases, start with `run()`. You can always migrate later.

## Next

[Build your first workflow →](../first-workflow/)
