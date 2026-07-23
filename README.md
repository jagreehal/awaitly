<p align="center">
  <img src="brand/awaitly-animated-morph.svg" alt="awaitly logo" width="120" height="120">
</p>

<h1 align="center">awaitly</h1>

<p align="center">
  <em>Good things come to those who a-<strong>wait</strong>-ly.</em>
</p>

Stop writing `try/catch` in every async handler.

awaitly lets you:

- return errors as data (`ok` / `err`)
- compose async steps linearly
- TypeScript knows **all possible errors** automatically
- map errors at the boundary (HTTP, RPC, jobs)

No exceptions for expected failures. No manual error unions.

```bash
npm install awaitly
```

Import from the capability you use. The small everyday entries are `awaitly/result`, `awaitly/run`, and `awaitly/reliability`; production capabilities have focused entries such as `awaitly/workflow`, `awaitly/durable`, `awaitly/persistence`, `awaitly/saga`, `awaitly/hitl`, `awaitly/streaming`, `awaitly/webhook`, and `awaitly/engine`. Test helpers live at `awaitly/testing`. The root `awaitly` entry remains the convenient front door for Result, `run()`, and reliability APIs.

📚 **[Full Documentation](https://jagreehal.github.io/awaitly/)** - guides, API reference, and examples.

---

## The Problem

JavaScript async code conflates two kinds of failures:

- **Expected**: "User not found", "Payment declined" — these are business outcomes
- **Unexpected**: Network timeout, SDK crash, OOM — these are bugs

Traditional try/catch loses type information:

```typescript
try {
  const user = await getUser(id);
  const order = await createOrder(user);
} catch (error) {
  // What type is error? unknown.
  // Was it "user not found" or a network crash? No idea.
}
```

awaitly separates these: expected failures become typed data, unexpected failures become `UnexpectedError`.

---

## Results as Data

Functions that can fail return `AsyncResult<SuccessType, ErrorType>`:

```typescript
import { err, ok, type AsyncResult } from 'awaitly';

type User = { id: string; name: string };
type UserNotFound = { type: 'USER_NOT_FOUND'; userId: string };

async function getUser(id: string): AsyncResult<User, UserNotFound> {
  if (id === 'u-1') return ok({ id, name: 'Alice' });
  return err({ type: 'USER_NOT_FOUND', userId: id });
}

const result = await getUser('u-2');
if (result.ok) {
  console.log(result.value.name); // TypeScript knows this is User
} else {
  console.log(result.error.userId); // TypeScript knows this is UserNotFound
}
```

No exceptions. TypeScript tracks every possible error.

---

## The Composition Problem

When you compose multiple Result-returning functions, you hit boilerplate:

```typescript
// ❌ Every call needs: if (!result.ok) return result
async function processOrder(orderId: string) {
  const orderResult = await getOrder(orderId);
  if (!orderResult.ok) return orderResult; // boilerplate

  const userResult = await getUser(orderResult.value.userId);
  if (!userResult.ok) return userResult; // more boilerplate

  const paymentResult = await charge(orderResult.value.total);
  if (!paymentResult.ok) return paymentResult; // even more

  return paymentResult;
}
```

10 steps = 10 if-checks. This is what `run()` solves.

---

## run() — Simple Composition

Pass your functions to `run()`. It hands you a steps object that mirrors them — each call unwraps the `ok` value and exits early on `err`:

```typescript
import { run } from 'awaitly';

const result = await run({ getOrder, getUser, charge }, async (s) => {
  const order = await s.getOrder(orderId); // unwraps ok, exits on err
  const user = await s.getUser(order.userId); // same
  const payment = await s.charge(order.total); // same
  return payment;
});
// result.error: 'ORDER_NOT_FOUND' | 'USER_NOT_FOUND' | 'CHARGE_DECLINED' | UnexpectedError
```

**The happy path reads linearly**, and TypeScript infers every possible error from the functions you passed. No type parameters, no string IDs, no wrappers — it looks like the code you already write.

Three things you get for free:

- **Plain functions are valid deps.** A function that throws instead of returning a Result works unchanged: its value passes through, its failures become `UnexpectedError`. Wrap existing code today, adopt typed errors one function at a time.
- **Loops are safe.** Calling the same dep twice auto-suffixes the step key (`getUser`, `getUser#2`, ...), so every iteration is a distinct step.
- **The classic `step` is still there** when you need per-step options like retries or timeouts: `run(deps, async (s, { step }) => ...)`.

### The explicit form: run(fn) with step('id', () => fn())

When dependencies are dynamic or you're building abstractions, use the callback-only form and spell out (or derive) the error union yourself:

```typescript
import { run, type ErrorOf, type Errors } from 'awaitly';

// Derive the union from your functions instead of writing it by hand
type AllErrors = Errors<[typeof getOrder, typeof getUser, typeof charge]>;
// e.g. 'ORDER_NOT_FOUND' | 'USER_NOT_FOUND' | 'CHARGE_DECLINED'

const result = await run<Payment, AllErrors>(async ({ step }) => {
  const order = await step('getOrder', () => getOrder(orderId));
  const user = await step('getUser', () => getUser(order.userId));
  const payment = await step('charge', () => charge(order.total));
  return payment;
});
```

`ErrorOf<typeof fn>` extracts the error type from a single function; `Errors<[typeof fn1, typeof fn2, ...]>` unions several. Both work with any function that returns `Result` or `AsyncResult`.

**When to use which:**

| Approach | Use when |
| --- | --- |
| `run(deps, fn)` | Default — errors inferred automatically, steps auto-bound |
| `createWorkflow(deps)` | Production handlers: caching, resume, retries, events |
| `run<T, Errors<[...]>>(fn)` | Dynamic deps with a derived error union |
| `run<T, 'ERR_A' \| 'ERR_B'>(fn)` | You want to spell out the error union manually |
| `run(fn)` (no type params) | You don't need typed errors (quick scripts, prototyping) |

### Why thunks in the explicit form? `step('id', () => fn())` not `step('id', fn())`

(The deps-first form has no thunks — `s.getUser(id)` is already the controlled call.) In the explicit form, `step()` requires a string ID as the first argument, and the operation must be wrapped in a function (thunk):

```typescript
step('getUser', () => getUser(id)); // ✅ Correct - step controls when it runs
step('getUser', getUser(id)); // ❌ Wrong - executes immediately
````

Thunks enable:

- **Caching**: step checks cache before calling
- **Retries**: step can re-call on failure
- **Timeouts**: step can abort mid-execution

### UnexpectedError — The Safety Net

If code throws instead of returning a Result, `run()` catches it:

```typescript
import { isUnexpectedError } from 'awaitly';

if (!result.ok && isUnexpectedError(result.error)) {
  console.error('Bug or SDK error:', result.error.cause);
}
```

- **Expected failures** → your typed errors
- **Unexpected failures** → `UnexpectedError`

TypeScript forces you to handle both.

---

## createWorkflow

`createWorkflow()` is `run(deps, fn)` plus production machinery: step caching, save & resume, events, and human-in-the-loop. The same bound steps object is there as `steps`:

```typescript
import { createWorkflow } from 'awaitly/workflow';

const deps = {
  getUser: async (id: string): AsyncResult<User, UserNotFound> => {
    /* ... */
  },
  getOrder: async (id: string): AsyncResult<Order, OrderNotFound> => {
    /* ... */
  },
};

const workflow = createWorkflow(deps);

const result = await workflow(async ({ steps }) => {
  const user = await steps.getUser(userId);
  const order = await steps.getOrder(orderId);
  return { user, order };
});
// TypeScript KNOWS: result.error is UserNotFound | OrderNotFound | UnexpectedError
```

The classic `step` and raw `deps` remain available in the same callback (`async ({ steps, step, deps, ctx }) => ...`) for per-step options like retries, timeouts, or explicit cache keys.

### When to use which?

Both share the same error inference and the same bound steps — the difference is machinery:

| `run(deps, fn)`            | `createWorkflow(deps)`       |
| -------------------------- | ---------------------------- |
| Simple one-off composition | Production handlers          |
| Lightweight, no caching    | Caching, save & resume       |
| Fire and forget            | Events, human-in-the-loop    |

---

## How It Works

```mermaid
flowchart TD
    subgraph "step('id', fn) unwraps Results, exits early on error"
        S1["step('fetchUser', () => deps.fetchUser(...))"] -->|ok| S2["step('fetchPosts', () => deps.fetchPosts(...))"]
        S2 -->|ok| S3["step('sendEmail', () => deps.sendEmail(...))"]
        S3 -->|ok| S4["✓ Success"]

        S1 -.->|error| EXIT["Return error"]
        S2 -.->|error| EXIT
        S3 -.->|error| EXIT
    end
```

Each `step()` unwraps a `Result`. If it's `ok`, you get the value and continue. If it's an error, the workflow exits immediately — no manual `if (!result.ok)` checks needed. The happy path stays clean.

---

## Key Concepts

| Concept                                                 | What it does                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Result**                                              | `ok(value)` or `err(error)` — typed success/failure, no exceptions                             |
| **Workflow**                                            | Wraps your dependencies and tracks their error types automatically                             |
| **step()**                                              | `step('id', fn, opts?)` — unwraps a Result, short-circuits on failure, enables caching/retries |
| **step.try / retry / sleep / withTimeout / fromResult** | Same: **id first** (e.g. `step.retry('id', fn, opts)`, `step.sleep('id', duration, opts?)`)    |
| **Events**                                              | `onEvent` streams everything — timing, retries, failures — for visualization or logging        |
| **Resume**                                              | Save completed steps, pick up later (great for approvals or crashes)                           |
| **UnexpectedError**                                     | Safety net for throws outside your declared errors; map it to HTTP 500 at the boundary         |

---

## Quickstart

Now that you understand the concepts, here's the complete pattern:

```typescript
import { err, ok, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

type Task = { id: string };
type TaskNotFound = { type: 'TASK_NOT_FOUND'; id: string };

// 1. Define dependencies that return Results
const deps = {
  loadTask: async (id: string): AsyncResult<Task, TaskNotFound> => {
    if (id === 't-1') return ok({ id });
    return err({ type: 'TASK_NOT_FOUND', id });
  },
};

// 2. Create and run a workflow
const workflow = createWorkflow(deps);

const result = await workflow(async ({ steps }) => {
  return await steps.loadTask('t-1');
});

// 3. Handle the result
console.log(result.ok ? result.value : result.error);
```

### What just happened?

- `deps.loadTask` returns a Result (`ok` or `err`)
- `createWorkflow(deps)` groups dependencies and infers all possible errors
- `steps.loadTask(...)` runs the dependency as a step and unwraps the success value
- if a step returns `err`, the workflow exits early

---

## Before & After: See Why This Matters

Let's build a money transfer - a real-world case where error handling matters. Same operation, two different approaches.

**Traditional approach: try/catch with manual error handling**

```typescript
// ❌ TypeScript sees: Promise<{ transactionId: string } | { error: string }>
async function transferMoney(
  fromUserId: string,
  toUserId: string,
  amount: number,
): Promise<{ transactionId: string } | { error: string }> {
  try {
    // Get sender - but what if this throws? What type of error?
    const fromUser = await getUser(fromUserId);
    if (!fromUser) {
      return { error: 'User not found' }; // Lost type information! Which user?
    }

    // Get recipient
    const toUser = await getUser(toUserId);
    if (!toUser) {
      return { error: 'User not found' }; // Same generic error - can't distinguish
    }

    // Validate balance
    if (fromUser.balance < amount) {
      return { error: 'Insufficient funds' }; // No details about how much needed
    }

    // Execute transfer
    const transaction = await executeTransfer(fromUser, toUser, amount);
    if (!transaction) {
      return { error: 'Transfer failed' }; // No reason why - was it network? DB? API?
    }

    return transaction;
  } catch (error) {
    // What kind of error? Unknown! Could be network, database, anything
    // TypeScript can't help you here - it's all `unknown`
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Helper functions that return null on failure (typical pattern)
async function getUser(
  userId: string,
): Promise<{ id: string; balance: number } | null> {
  // Simulate: might throw, might return null - who knows?
  if (userId === 'unknown') return null;
  return { id: userId, balance: 1000 };
}

async function executeTransfer(
  from: { id: string },
  to: { id: string },
  amount: number,
): Promise<{ transactionId: string } | null> {
  // Might fail for many reasons - all become null
  return { transactionId: 'tx-12345' };
}
```

**With workflow: typed errors, automatic inference, clean code**

```typescript
import { err, isUnexpectedError, ok, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

type User = { id: string; balance: number };
type UserNotFound = { type: 'USER_NOT_FOUND'; userId: string };
type InsufficientFunds = {
  type: 'INSUFFICIENT_FUNDS';
  required: number;
  available: number;
};
type TransferFailed = { type: 'TRANSFER_FAILED'; reason: string };

const deps = {
  getUser: async (userId: string): AsyncResult<User, UserNotFound> => {
    if (userId === 'unknown') return err({ type: 'USER_NOT_FOUND', userId });
    return ok({ id: userId, balance: 1000 });
  },

  validateBalance: (
    user: User,
    amount: number,
  ): AsyncResult<void, InsufficientFunds> => {
    if (user.balance < amount) {
      return err({
        type: 'INSUFFICIENT_FUNDS',
        required: amount,
        available: user.balance,
      });
    }
    return ok(undefined);
  },

  executeTransfer: async (): AsyncResult<
    { transactionId: string },
    TransferFailed
  > => {
    return ok({ transactionId: 'tx-12345' });
  },
};

const transfer = createWorkflow(deps);

// In an HTTP handler
async function handler(fromUserId: string, toUserId: string, amount: number) {
  const result = await transfer(async ({ step, deps }) => {
    const fromUser = await step('getUser', () => deps.getUser(fromUserId));
    const toUser = await step('getUser', () => deps.getUser(toUserId));
    await step('validateBalance', () => deps.validateBalance(fromUser, amount));
    return await step('executeTransfer', () => deps.executeTransfer());
  });

  // TypeScript knows ALL possible errors - map them to HTTP responses
  if (result.ok) return { statusCode: 200, body: result.value };

  if (isUnexpectedError(result.error)) {
    return { statusCode: 500, body: { message: 'Internal error' } };
  }

  switch (result.error.type) {
    case 'USER_NOT_FOUND':
      return {
        statusCode: 404,
        body: { message: 'User not found', userId: result.error.userId },
      };
    case 'INSUFFICIENT_FUNDS':
      return { statusCode: 400, body: result.error };
    case 'TRANSFER_FAILED':
      return { statusCode: 500, body: { message: 'Internal error' } };
  }
}
```

**How it works:** TypeScript knows **all possible errors** from your dependencies. Add a step? The errors update automatically. Remove one? They update. You'll never miss an error case.

---

## Mental model

Think of awaitly like this:

- Leaf functions return data OR an error (never throw for expected cases)
- A workflow runs steps in order
- `step()`:
  - gives you the value on success
  - exits immediately on error
- The boundary (HTTP, job, CLI) decides how to respond

---

## Mapping errors at the boundary

The final result maps to HTTP responses, job statuses, or CLI exit codes in **one exhaustive expression** — every exit point of the railway, named once:

```typescript
import { match } from 'awaitly';

// In an HTTP handler
return match(result, {
  ok: (task) => ({ statusCode: 200, body: task }),
  TASK_NOT_FOUND: (e) => ({ statusCode: 404, body: { message: `No task ${e.id}` } }),
  TimeoutError: () => ({ statusCode: 504, body: { message: 'Upstream timeout' } }),
  UnexpectedError: (e) => {
    console.error('Unexpected error:', e.cause);
    return { statusCode: 500, body: { message: 'Internal error' } };
  },
});
```

TypeScript enforces the arms exhaustively from the inferred union — add a step that can fail a new way, and this `match` won't compile until the boundary handles it. One error model everywhere: string errors match themselves, tagged objects match on `type`, and awaitly's system errors (`TimeoutError`, `UnexpectedError`) are matched by the same key. The `{ ok, err }` two-arm form remains when you just want a catch-all.

`if`/`switch` on `result.error.type` works too — `match` is the same thing with exhaustiveness checking.

**Why `UnexpectedError`?**

- Expected failures → your typed errors (e.g., `TASK_NOT_FOUND`)
- Unexpected failures (bugs, SDK throws) → `UnexpectedError`

TypeScript will force you to handle both. This is intentional.

---

## Key Features

### 🛡️ Built-in Reliability

Add resilience exactly where you need it - no nested try/catch or custom retry loops.

```typescript
const result = await workflow(async ({ step, deps }) => {
  // Retry 3 times with exponential backoff, timeout after 5 seconds
  const task = await step.retry('loadTask', () => deps.loadTask('t-1'), {
    attempts: 3,
    backoff: 'exponential',
    timeout: { ms: 5000 },
  });
  return task;
});
```

### 💾 Smart Caching (Never Double-Charge a Customer)

Use stable keys to ensure a step only runs once, even if the workflow crashes and restarts.

```typescript
const result = await processPayment(async ({ step }) => {
  // If the workflow crashes after charging but before saving,
  // the next run skips the charge - it's already cached.
  const charge = await step('chargeCard', () => chargeCard(amount), {
    key: `charge:${order.idempotencyKey}`,
  });

  await step('saveToDatabase', () => saveToDatabase(charge), {
    key: `save:${charge.id}`,
  });

  return charge;
});
```

### 💾 Save & Resume (Persist Workflows Across Restarts)

Save workflow state to a database and resume later from exactly where you left off. Perfect for long-running workflows, crash recovery, or pausing for approvals.

**Step 1: Collect state during execution**

```typescript
import { createResumeStateCollector, createWorkflow } from 'awaitly/workflow';

// Create a collector to automatically capture step results
const collector = createResumeStateCollector();

const workflow = createWorkflow(
  { fetchUser, fetchPosts },
  {
    onEvent: collector.handleEvent, // Automatically collects step_complete events
  },
);

await workflow(async ({ step, deps }) => {
  // Only steps with keys are saved
  const user = await step('fetchUser', () => deps.fetchUser('1'), {
    key: 'user:1',
  });
  const posts = await step('fetchPosts', () => deps.fetchPosts(user.id), {
    key: `posts:${user.id}`,
  });
  return { user, posts };
});

// Get the collected state
const state = collector.getResumeState(); // Returns ResumeState
```

**Step 2: Save to database**

```typescript
import { serializeResumeState } from 'awaitly/persistence';

// Serialize to a JSON-safe object
const workflowId = '123';
const json = JSON.stringify(serializeResumeState(state));

// Save to your database
await db.workflowStates.create({
  id: workflowId,
  state: json,
  createdAt: new Date(),
});
```

**Step 3: Resume from saved state**

```typescript
// Load from database
import { deserializeResumeState } from 'awaitly/persistence';

const workflowId = '123';
const saved = await db.workflowStates.findUnique({ where: { id: workflowId } });
const savedState = deserializeResumeState(JSON.parse(saved.state));

// Resume workflow - cached steps skip execution
const workflow = createWorkflow(
  { fetchUser, fetchPosts },
  {
    resumeState: savedState, // Pre-populates cache from saved state
  },
);

await workflow(async ({ step, deps }) => {
  const user = await step('fetchUser', () => deps.fetchUser('1'), {
    key: 'user:1',
  }); // ✅ Cache hit
  const posts = await step('fetchPosts', () => deps.fetchPosts(user.id), {
    key: `posts:${user.id}`,
  }); // ✅ Cache hit
  return { user, posts };
});
```

**With a database adapter (Postgres, MongoDB, libSQL)**

The adapter packages give you a ready-made store — pass it to `durable.run` and save/load/resume is handled for you:

```typescript
import { durable } from 'awaitly/durable';
import { postgres } from 'awaitly-postgres'; // or awaitly-mongo, awaitly-libsql

const store = postgres(process.env.DATABASE_URL);

const result = await durable.run(
  { fetchUser, fetchPosts },
  async ({ step, deps }) => {
    const user = await step('fetchUser', () => deps.fetchUser('1'), {
      key: 'user:1',
    });
    const posts = await step('fetchPosts', () => deps.fetchPosts(user.id), {
      key: `posts:${user.id}`,
    });
    return { user, posts };
  },
  { id: 'user-posts-123', store }, // same id + store = resume on re-run
);
```

**Key points:**

- Only steps with `key` options are saved (unkeyed steps execute fresh on resume)
- Error results are preserved with metadata for proper replay
- You can also pass an async function: `resumeState: async () => await loadFromDB()`
- Works seamlessly with HITL approvals and crash recovery

### 🧑‍💻 Human-in-the-Loop

Pause for manual approvals (large transfers, deployments, refunds) and resume exactly where you left off.

```typescript
const requireApproval = createApprovalStep({
  key: 'approve:refund',
  checkApproval: async () => {
    const status = await db.getApprovalStatus('refund_123');
    return status
      ? { status: 'approved', value: status }
      : { status: 'pending' };
  },
});

const result = await refundWorkflow(async ({ step, deps }) => {
  const refund = await step('calculateRefund', () =>
    deps.calculateRefund(orderId),
  );

  // Workflow pauses here until someone approves
  const approval = await step('approve', () => requireApproval(), {
    key: 'approve:refund',
  });

  return await step('processRefund', () =>
    deps.processRefund(refund, approval),
  );
});

if (!result.ok && isPendingApproval(result.error)) {
  // Notify Slack, send email, etc.
  // Later: injectApproval(savedState, { stepKey, value })
}
```

### 📊 Visualize What Happened

Hook into the event stream to generate diagrams for logs, PRs, or dashboards.

```typescript
import { createVisualizer } from 'awaitly-visualizer';

const viz = createVisualizer({ workflowName: 'checkout' });
const workflow = createWorkflow(
  { fetchOrder, chargeCard },
  {
    onEvent: viz.handleEvent,
  },
);

await workflow(async ({ step, deps }) => {
  const order = await step('fetchOrder', () => deps.fetchOrder('order_456'));
  const payment = await step('chargeCard', () => deps.chargeCard(order.total));
  return { order, payment };
});

console.log(viz.renderAs('mermaid'));
```

---

## What's next?

You have the foundation. Pick one:

- **If you need retries/timeouts:** [Reliability guide](https://jagreehal.github.io/awaitly/advanced/policies/)
- **If you need crash recovery:** [Persistence guide](https://jagreehal.github.io/awaitly/guides/persistence/)
- **If you want observability:** [Visualization guide](https://jagreehal.github.io/awaitly/guides/visualization/)

## Advanced Features (when you need them)

- **Retries / timeouts / backoff** → [Reliability guide](https://jagreehal.github.io/awaitly/advanced/policies/)
- **Step caching with keys** → [Caching guide](https://jagreehal.github.io/awaitly/guides/caching/)
- **Save & resume** → [Persistence guide](https://jagreehal.github.io/awaitly/guides/persistence/)
- **Human-in-the-loop approvals** → [HITL guide](https://jagreehal.github.io/awaitly/guides/human-in-loop/)
- **Visualization via `onEvent`** → [Visualization guide](https://jagreehal.github.io/awaitly/guides/visualization/)

---

## Common Patterns (quick reference)

```typescript
// Wrap throwing code — id first, then operation, then options
const data = await step.try('fetch', () => fetch(url).then((r) => r.json()), {
  error: 'HTTP_FAILED' as const,
});

// Retries with backoff — id first
const user = await step.retry('fetchUser', () => deps.fetchUser(id), {
  attempts: 3,
  backoff: 'exponential',
});

// Timeout protection — id first
const result = await step.withTimeout('slowOp', () => deps.slowOperation(), {
  ms: 5000,
});

// Caching (use thunk + key)
const user = await step('fetchUser', () => deps.fetchUser(id), {
  key: `user:${id}`,
});
```

---

## Processing Collections

Use `step.forEach()` for statically analyzable loops instead of manual `for` loops with dynamic keys:

```typescript
// ❌ Problematic - dynamic keys defeat static analysis
for (const payment of payments) {
  await step('processPayment', () => processPayment(payment), {
    key: `payment-${payment.id}`,
  });
}

// ✅ Better - step.forEach() is statically analyzable
await step.forEach('process-payments', payments, {
  stepIdPattern: 'payment-{i}',
  run: async (payment) => {
    await step('processPayment', () => processPayment(payment));
  },
});
```

`step.forEach()` provides:

- Static analysis support (awaitly-analyze can enumerate paths)
- Automatic indexing with `stepIdPattern`
- Resume support (tracks which items completed)

---

## Strict Mode (Closed Error Unions)

By default, workflows include `UnexpectedError` in the error union. Use strict mode for closed error unions:

```typescript
// Default - open error union includes UnexpectedError
const workflow = createWorkflow(deps);
// Result error: 'NOT_FOUND' | 'ORDER_FAILED' | UnexpectedError

// Strict mode - closed error union
const workflow = createWorkflow(deps, {
  strict: true,
  errors: ['NOT_FOUND', 'ORDER_FAILED'] as const,
  catchUnexpected: (cause) => ({ type: 'UNEXPECTED' as const, cause }),
});
// Result error: 'NOT_FOUND' | 'ORDER_FAILED' | { type: 'UNEXPECTED', cause }
```

With strict mode, TypeScript will error if a dep can produce an undeclared error.

---

## When to use awaitly

**Use it when:**

- You want Result types with async/await (not method chains)
- You need automatic error inference from dependencies
- You're building workflows that benefit from caching, retries, or resume

**Skip it when:**

- You prefer functional chaining (consider neverthrow)

### vs neverthrow

| awaitly                             | neverthrow                 |
| ----------------------------------- | -------------------------- |
| async/await with `step('id', fn)`   | `.andThen()` method chains |
| Automatic error inference           | Manual error unions        |
| Built-in retries, timeouts, caching | DIY                        |

**neverthrow:** Minimal bundle, functional chaining.
**awaitly:** async/await syntax + orchestration built in.

## Quick Reference

| API                                | Description                                          |
| ---------------------------------- | ---------------------------------------------------- |
| `run(deps, fn)`                    | Compose with auto-bound steps. Errors inferred.      |
| `createWorkflow(deps)`             | Production form. Adds caching, resume, events.       |
| `steps.fn(args)`                   | Bound step: unwraps ok, exits on err. Key = dep name.|
| `step('id', () => deps.fn())`      | Classic step with per-step options. ID required.     |
| `step.retry(id, fn, opts)`         | Retry with backoff. ID required.                     |
| `step.withTimeout(id, fn, { ms })` | Timeout protection. ID required.                     |
| `step.try(id, fn, opts)`           | Wrap throwing code; map to typed error. ID required. |
| `step.sleep(id, duration, opts?)`  | Pause execution. ID required.                        |
| `ok(value)` / `err(error)`         | Construct Results.                                   |

See [full API reference](https://jagreehal.github.io/awaitly/reference/api/) for `run()`, `step.fromResult`, combinators, circuit breakers, and more.

### run()

The deps-first form is the default — errors inferred, no type parameters:

```typescript
import { run } from 'awaitly';

const result = await run({ fetchUser }, async (s) => {
  return s.fetchUser(userId);
});
```

The explicit callback-only form exists for dynamic dependencies or when you're building abstractions and want manual control of the error union:

```typescript
const result = await run<Output, 'NOT_FOUND' | 'FETCH_ERROR'>(
  async ({ step }) => {
    const user = await step('fetchUser', () => fetchUser(userId)); // thunk for consistency
    return user;
  },
  { onError: (e) => console.log('Failed:', e) },
);
```

For production handlers, use `createWorkflow()` — same inference and bound steps, plus caching and resume.

### Imports

Most apps only need:

```typescript
import { err, isUnexpectedError, ok, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';
```

Everything else is optional and documented in the [guides](https://jagreehal.github.io/awaitly/).

## Common Pitfalls

**Use thunks for caching.** `step('fetchUser', deps.fetchUser('1'))` executes immediately. Use `step('fetchUser', () => deps.fetchUser('1'), { key })` for caching to work.

**Keys must be stable.** Use `user:${id}`, not `user:${Date.now()}`.

**Don't cache writes blindly.** Payments need carefully designed idempotency keys.

**Catch mistakes automatically.** Use [eslint-plugin-awaitly](./packages/eslint-plugin-awaitly) to detect these patterns at lint time.

## Troubleshooting & FAQ

- **Why is `UnexpectedError` in my result?** It's a safety net for unexpected throws. Map it to HTTP 500 at the boundary.
- **How do I inspect what ran?** Pass `onEvent` and log `step_*` / `workflow_*` events or feed them into `createVisualizer()` for diagrams.
- **A workflow is stuck waiting for approval. Now what?** Use `isPendingApproval(error)` to detect the state, notify operators, then call `injectApproval(state, { stepKey, value })` to resume.
- **Cache is not used between runs.** Supply a stable `{ key }` per step and provide a cache/resume adapter in `createWorkflow(deps, { cache })`.
- **I only need a single run with dynamic dependencies.** Use `run()` instead of `createWorkflow()` and pass dependencies directly to the executor.

## Next Steps

**If you only read one guide next:** [Retries & Timeouts](https://jagreehal.github.io/awaitly/guides/retries-timeouts/) - most apps need reliability.

**Other guides:**

- [Persistence](https://jagreehal.github.io/awaitly/guides/persistence/) - save & resume workflows
- [Testing](https://jagreehal.github.io/awaitly/guides/testing/) - deterministic harness
- [Full API Reference](https://jagreehal.github.io/awaitly/reference/api/)

---

## You're done

If you understand:

- `ok` / `err`
- `createWorkflow`
- `step()`
- mapping Result at the boundary

You already know ~80% of awaitly.

---

## License

MIT
