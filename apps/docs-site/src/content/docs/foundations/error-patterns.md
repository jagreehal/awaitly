---
title: "Error Patterns"
description: When to use Result types, when to let exceptions throw, and how awaitly keeps you safe either way
---

Result types are a powerful tool for modeling expected outcomes, but using them everywhere creates noise without benefit. awaitly is designed so you only model expected domain errors as typed Results — unexpected exceptions are caught automatically and wrapped as `UnexpectedError` with the original exception preserved in `cause`. This page shows patterns to follow and patterns to avoid.

## Three classes of errors

Not every error deserves a type. Errors fall into three classes, and each one calls for a different approach:

| Class | What it is | How awaitly handles it |
|-------|-----------|----------------------|
| **Domain errors** | Expected business failures — validation, not-found, insufficient funds | You model these as typed errors with `err()`. Result is the right tool. |
| **Panics** | Programmer errors, out-of-memory, null references | Let them throw. `run`, `createWorkflow`, and `saga` all wrap these as `UnexpectedError` with the original exception in `cause`. |
| **Infrastructure errors** | Network timeouts, auth failures, disk I/O | Case-by-case. Model the ones your domain branches on. Let the rest become `UnexpectedError`. |

The patterns below follow from this classification.

## Patterns to avoid

### Don't wrap every exception in Result

awaitly already catches unexpected throws in `run()`, `createWorkflow()`, and `saga()`. Wrapping them yourself adds noise and hides the real exception.

```typescript
// ❌ Manually catching and wrapping — redundant, loses the real stack trace
const result = await workflow.run(async ({ step, deps }) => {
  try {
    return await step('fetchUser', () => deps.fetchUser('123'));
  } catch (e) {
    return err('UNEXPECTED');
  }
});

// ✅ Let it throw — awaitly wraps it as UnexpectedError with cause
const result = await workflow.run(async ({ step, deps }) => {
  return await step('fetchUser', () => deps.fetchUser('123'));
});

// The original exception is preserved:
if (!result.ok && isUnexpectedError(result.error)) {
  console.error(result.error.cause); // Original Error with stack trace
}
```

### Don't use Result when you should fail fast

If your app can't continue without a config file or database connection, don't return a Result — throw at startup. Returning `err()` delays the inevitable and obscures the failure.

```typescript
// ❌ Returning a Result for something that should halt the process
const loadConfig = (): AsyncResult<Config, 'CONFIG_MISSING'> => {
  const raw = process.env.DATABASE_URL;
  if (!raw) return err('CONFIG_MISSING');
  return ok({ databaseUrl: raw });
};

// Then deep in a workflow:
const config = await step('loadConfig', () => loadConfig());
// The workflow keeps running, but nothing after this will work.

// ✅ Throw at startup, before any workflow runs
function loadConfig(): Config {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required');
  return { databaseUrl: raw };
}

const config = loadConfig(); // Fails immediately if missing
const workflow = createWorkflow('checkout', { /* deps using config */ });
```

### Don't model every possible I/O error

Only model the errors your domain logic actually branches on. Trying to represent every possible failure in a union type creates busywork with no benefit.

```typescript
// ❌ Modeling every possible file-system error
type FileError =
  | 'FILE_NOT_FOUND'
  | 'DIRECTORY_NOT_FOUND'
  | 'FILE_NOT_ACCESSIBLE'
  | 'PATH_TOO_LONG'
  | 'DISK_FULL'
  | 'OTHER_IO_ERROR';

const readTemplate = async (path: string): AsyncResult<string, FileError> => {
  // ...
};

// ✅ Model only what the domain cares about
const readTemplate = async (path: string): AsyncResult<string, 'TEMPLATE_NOT_FOUND'> => {
  try {
    return ok(await fs.readFile(path, 'utf-8'));
  } catch {
    return err('TEMPLATE_NOT_FOUND');
  }
};
// If the disk is full or the path is invalid, that's a panic —
// let it throw and become UnexpectedError with the real exception in cause.
```

### Don't use Result if no one checks the error cases

If every consumer just checks `result.ok` and never branches on specific error types, a rich error union is overhead. Keep it simple.

```typescript
// ❌ Rich error type that no consumer ever inspects
const enrichProfile = async (
  id: string
): AsyncResult<Profile, 'API_TIMEOUT' | 'RATE_LIMITED' | 'MALFORMED_RESPONSE' | 'SERVICE_DOWN'> => {
  // ...
};

// Every caller does the same thing:
const profile = await step('enrich', () => deps.enrichProfile(id));
if (!result.ok) {
  logger.warn('Enrichment failed, continuing without it');
}

// ✅ Simple error type — callers don't distinguish between failure reasons
const enrichProfile = async (id: string): AsyncResult<Profile, 'ENRICHMENT_FAILED'> => {
  // ...
};
```

## Patterns to follow

### Use Result for expected domain errors

Validation failures, business rule violations, and not-found are expected outcomes that callers need to branch on. This is exactly what Result is for — a glorified boolean with extra information, not a replacement for exceptions.

```typescript
// ✅ Domain errors that callers handle differently
const checkout = async (
  cart: Cart, payment: PaymentMethod
): AsyncResult<Order, 'CART_EMPTY' | 'INSUFFICIENT_FUNDS' | 'ITEM_OUT_OF_STOCK'> => {
  if (cart.items.length === 0) return err('CART_EMPTY');
  if (payment.balance < cart.total) return err('INSUFFICIENT_FUNDS');
  // ...
  return ok(order);
};

// Caller branches on each case — this is where Result shines
const result = await workflow.run(async ({ step, deps }) => {
  return await step('checkout', () => deps.checkout(cart, payment));
});

if (!result.ok) {
  switch (result.error) {
    case 'CART_EMPTY':
      return res.status(400).json({ error: 'Cart is empty' });
    case 'INSUFFICIENT_FUNDS':
      return res.status(402).json({ error: 'Insufficient funds' });
    case 'ITEM_OUT_OF_STOCK':
      return res.status(409).json({ error: 'Item out of stock' });
  }
}
```

### Use `step.try` to convert throwing code at boundaries

Third-party libraries throw exceptions. Wrap them at the boundary with `step.try` so the exception becomes a typed error inside your workflow.

```typescript
// ✅ Convert throwing code into a typed Result at the boundary
const result = await workflow.run(async ({ step }) => {
  const data = await step.try(
    'parseInput',
    () => JSON.parse(rawInput),
    { error: 'INVALID_JSON' as const }
  );

  const token = await step.try(
    'verify',
    () => jwt.verify(data.token, secret),
    { error: 'INVALID_TOKEN' as const }
  );

  return token;
});
// result.error is: 'INVALID_JSON' | 'INVALID_TOKEN' | UnexpectedError
```

### Let `UnexpectedError` preserve diagnostics for you

`UnexpectedError` keeps the original exception in `cause`. You get full stack traces for debugging without cluttering your domain model with infrastructure concerns.

```typescript
// ✅ Log the real exception, act on the domain error
import { isUnexpectedError } from 'awaitly';

const result = await workflow.run(async ({ step, deps }) => {
  const user = await step('fetchUser', () => deps.fetchUser('123'));
  await step('sendWelcome', () => deps.sendEmail(user.email));
  return user;
});

if (!result.ok) {
  if (isUnexpectedError(result.error)) {
    // Infrastructure failure — log and return 500
    console.error('Unexpected failure:', result.error.cause); // Original Error + stack trace
    return res.status(500).json({ error: 'Internal error' });
  }

  // Domain error — handle normally
  switch (result.error) {
    case 'NOT_FOUND':
      return res.status(404).json({ error: 'User not found' });
    case 'EMAIL_FAILED':
      return res.status(502).json({ error: 'Email service unavailable' });
  }
}
```

## How awaitly keeps you safe

`run()`, `createWorkflow()`, and `saga()` all catch thrown exceptions automatically and wrap them as `UnexpectedError` with the original exception in `cause`. You never lose stack traces. You never need to model every possible failure. Your typed error union stays clean — only the domain errors you actually care about.

If you need to replace `UnexpectedError` with your own type, pass `catchUnexpected` to `run()` or `createWorkflow()`. See [Custom unexpected errors](/foundations/error-handling/#custom-unexpected-errors).

## Further reading

**awaitly docs:**
- [Errors and Retries](/foundations/error-handling/) — how error propagation, retries, and timeouts work
- [Tagged Errors](/foundations/tagged-errors/) — structured error types with exhaustive matching
- [awaitly vs try/catch](/comparison/awaitly-vs-try-catch/) — side-by-side comparison with traditional error handling

**External:**
- [Against Railway-Oriented Programming](https://fsharpforfunandprofit.com/posts/against-railway-oriented-programming/) — Scott Wlaschin on when Result types are the wrong tool
- [You're better off using Exceptions](https://eiriktsarpalis.wordpress.com/2017/02/19/youre-better-off-using-exceptions/) — Eirik Tsarpalis on Result types as a general-purpose error mechanism
