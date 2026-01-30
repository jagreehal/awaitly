---
title: Dependency Binding
description: Using bindDeps for clean composition boundaries
---

import { Aside } from '@astrojs/starlight/components';

The `bindDeps` utility enables clean composition boundaries in the `fn(args, deps)` pattern. It transforms functions from `(args, deps) => out` into curried form: `(deps) => (args) => out`.

## Why bindDeps?

The `fn(args, deps)` pattern keeps functions testable by making dependencies explicit. However, at composition boundaries (like route handlers, React components, or service entry points), you want to bind dependencies once and call with arguments.

`bindDeps` bridges this gap:

```typescript
// Core function: explicit and testable
const notify = (args: { name: string }, deps: { send: SendFn }) =>
  deps.send(args.name);

// At composition root: bind deps once
const notifySlack = bindDeps(notify)(slackDeps);

// Call sites: clean and simple
await notifySlack({ name: 'Alice' });
```

## Basic Usage

### Simple example

```typescript
import { bindDeps } from 'awaitly/bind-deps';

// Core function with explicit dependencies
const greet = (args: { name: string }, deps: { prefix: string }) =>
  `${deps.prefix} ${args.name}`;

// Bind dependencies at composition boundary
const greetWithHello = bindDeps(greet)({ prefix: 'Hello' });
const greetWithHi = bindDeps(greet)({ prefix: 'Hi' });

// Use the bound functions
greetWithHello({ name: 'Alice' }); // "Hello Alice"
greetWithHi({ name: 'Bob' });      // "Hi Bob"
```

### Multiple bound functions

You can create multiple bound functions from the same base function:

```typescript
const notify = async (
  args: { userId: string; message: string },
  deps: { send: SendFn; channel: string }
) => {
  await deps.send(`${deps.channel}:${args.userId}`, args.message);
  return { sent: true, channel: deps.channel };
};

const mockSend: SendFn = async (to, msg) => {
  console.log(`Sending to ${to}: ${msg}`);
};

// Create multiple bound functions
const notifySlack = bindDeps(notify)({ send: mockSend, channel: 'slack' });
const notifyEmail = bindDeps(notify)({ send: mockSend, channel: 'email' });
const notifySms = bindDeps(notify)({ send: mockSend, channel: 'sms' });

// All are independent
await notifySlack({ userId: '1', message: 'Hello' });
await notifyEmail({ userId: '1', message: 'Hello' });
await notifySms({ userId: '1', message: 'Hello' });
```

## With Result Types

`bindDeps` works seamlessly with `Result` and `AsyncResult`:

```typescript
import { bindDeps } from 'awaitly/bind-deps';
import { ok, err, type AsyncResult } from 'awaitly';

const getUser = async (
  args: { id: string },
  deps: { db: Map<string, { name: string }> }
): AsyncResult<{ name: string }, 'NOT_FOUND'> => {
  const user = deps.db.get(args.id);
  return user ? ok(user) : err('NOT_FOUND');
};

const db = new Map([['1', { name: 'Alice' }]]);
const bound = bindDeps(getUser)({ db });

const result = await bound({ id: '1' });
if (result.ok) {
  console.log(result.value.name); // "Alice"
}
```

## Testing

The `fn(args, deps)` pattern makes testing straightforward - just pass mock dependencies:

```typescript
// Core function is easy to test
const notify = (args: { name: string }, deps: { send: SendFn }) =>
  deps.send(args.name);

// In tests, pass mock dependencies directly
const mockSend = vi.fn();
const result = notify({ name: 'Alice' }, { send: mockSend });

expect(mockSend).toHaveBeenCalledWith('Alice');
```

<Aside type="tip" title="Keep core functions explicit">
Always write core functions in the explicit `fn(args, deps)` form. Use `bindDeps` only at composition boundaries (route handlers, component entry points, service boundaries). This keeps functions testable while providing clean call sites.
</Aside>

## Framework Integration

### Express route handlers

```typescript
import { bindDeps } from 'awaitly/bind-deps';
import express from 'express';

// Core function
const createOrder = async (
  args: { items: OrderItem[] },
  deps: { validateOrder: ValidateFn; processPayment: PaymentFn }
) => {
  const validated = await deps.validateOrder(args.items);
  const payment = await deps.processPayment(validated.total);
  return { orderId: payment.id };
};

// At route boundary: bind deps once
const app = express();
const boundCreateOrder = bindDeps(createOrder)({
  validateOrder,
  processPayment,
});

app.post('/orders', async (req, res) => {
  const result = await boundCreateOrder({ items: req.body.items });
  if (result.ok) {
    res.json(result.value);
  } else {
    res.status(400).json({ error: result.error });
  }
});
```

### React components

```typescript
import { bindDeps } from 'awaitly/bind-deps';
import { useState } from 'react';

// Core function
const fetchUser = async (
  args: { id: string },
  deps: { api: ApiClient }
): Promise<User> => {
  return await deps.api.get(`/users/${args.id}`);
};

// At component boundary: bind deps
const api = new ApiClient();
const boundFetchUser = bindDeps(fetchUser)({ api });

function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    boundFetchUser({ id: userId }).then(setUser);
  }, [userId]);

  return user ? <div>{user.name}</div> : <div>Loading...</div>;
}
```

### Next.js server actions

```typescript
'use server';

import { bindDeps } from 'awaitly/bind-deps';

// Core function
const checkout = async (
  args: { cartId: string },
  deps: { validateCart: ValidateFn; processPayment: PaymentFn }
) => {
  const cart = await deps.validateCart(args.cartId);
  const payment = await deps.processPayment(cart.total);
  return { orderId: payment.id };
};

// At server action boundary: bind deps
const boundCheckout = bindDeps(checkout)({
  validateCart,
  processPayment,
});

export async function handleCheckout(cartId: string) {
  return await boundCheckout({ cartId });
}
```

## Type Safety

`bindDeps` preserves all type information:

```typescript
// TypeScript infers all types automatically
const fn = (
  args: { id: number; name: string },
  deps: { log: boolean }
) => args.name;

const bound = bindDeps(fn)({ log: true });

// TypeScript ensures args must match { id: number; name: string }
const result = bound({ id: 1, name: 'test' }); // ✅
// const result = bound({ id: 1 });            // ❌ Error: missing 'name'
```

## Empty Args

For functions that don't need arguments, use `Record<string, never>`:

```typescript
const getTimestamp = (
  _: Record<string, never>,
  deps: { now: () => number }
) => deps.now();

let time = 1000;
const bound = bindDeps(getTimestamp)({ now: () => time++ });

expect(bound({})).toBe(1000);
expect(bound({})).toBe(1001);
```

## Best Practices

1. **Keep core functions explicit**: Write functions in `fn(args, deps)` form for testability
2. **Bind at boundaries**: Use `bindDeps` only at composition boundaries (routes, components, services)
3. **Preserve types**: Let TypeScript infer types - no need for explicit annotations
4. **Test the core**: Test the explicit `fn(args, deps)` form with mock dependencies
5. **One bind per boundary**: Bind dependencies once per composition boundary, not at every call site

## Related

- [Framework Integration/framework-integration/) - Integration patterns for React, Next.js, Express
- [Testing Guide/testing/) - Testing workflows and functions
- [API Reference/../reference/api/) - Complete `bindDeps` API documentation
