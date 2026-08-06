---
title: Why awaitly?
description: Typed errors and async workflows without leaving the TypeScript you already write
---

Most TypeScript services assume a function either returns a value or throws. The signature hides the throw. You find out by reading the body, or worse, in production.

```typescript
async function getUser(id: string): Promise<User> {
  const user = await db.find(id);
  if (!user) throw new Error('NOT_FOUND');
  return user;
}
```

TypeScript sees `Promise<User>`. It does not see `NOT_FOUND`. At the call site you wrap the call in try/catch and get `unknown`.

That gap is what awaitly closes. Expected failures return `ok(value)` or `err(failure)`. The failure is part of the return type.

## The pattern

With awaitly, the same function advertises the failure:

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
  const user = await db.find(id);
  return user ? ok(user) : err('NOT_FOUND');
}
```

The signature tells you:

- What you get on success (`User`)
- What can fail (`'NOT_FOUND'`)

No throw. No `unknown` at the boundary.

## Composing without boilerplate

Checking `result.ok` after every call gets old fast. Pass your deps to `run()` or `createWorkflow()` and call `step()` inside a normal async function. You receive unwrapped values; the first error exits the workflow.

```typescript
const result = await run({ getUser, getOrder }, async (s) => {
  const user = await s.getUser(id);
  return s.getOrder(user.id);
});
```

Add `getPaymentMethod` to deps and TypeScript widens the error union. Remove a step and the union narrows. You do not maintain that list by hand.

## What else ships in the box

Once steps have names and typed errors, you can attach production machinery where you need it:

- Retries and backoff on individual steps
- Timeouts without wrapping whole handlers
- Idempotency keys for safe retries
- Save and resume for long-running or human-in-the-loop flows
- Static analysis and diagrams from your source

You can ignore all of that on day one. Start with Results and `run()`.

## How it differs from neighbors

| Approach | What you get |
| -------- | ------------ |
| try/catch | Fast to write, `unknown` at the edge |
| neverthrow | Result types, manual error unions |
| **awaitly** | Results + inferred unions + workflow primitives + async/await |
| Effect | Full FP runtime, fibers, layers |

awaitly is for teams that want typed errors and step-level reliability without adopting a new runtime model. See [Comparison](comparison/) for side-by-side writeups.

## Adopt incrementally

You do not need a rewrite.

1. Pick one handler that can fail in known ways.
2. Return `ok`/`err` instead of throwing.
3. Call it through `run()` or a small workflow.
4. Expand to the next handler when you touch that code.

Existing try/catch code can stay until you open those files.

## Next steps

- [Installation](getting-started/installation/) — add the package
- [The Basics](getting-started/basics/) — Results and `run()` in fifteen minutes
- [Your First Workflow](getting-started/first-workflow/) — named steps and inferred errors

Questions? [Open an issue](https://github.com/jagreehal/awaitly) or check [Troubleshooting](guides/troubleshooting/).
