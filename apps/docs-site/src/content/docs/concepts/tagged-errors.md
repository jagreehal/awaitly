---
title: Tagged Errors
description: Rich error types with exhaustive pattern matching
---

String literal errors like `'NOT_FOUND'` work for simple cases. When you need errors with contextual data, use `TaggedError`.

This guide progresses through: **deciding when to use TaggedError** → **creating them** → **pattern matching** → **advanced usage**.

## Decision tree: When to use what

```
Do you need data attached to the error?
├── No → Use string literals: 'NOT_FOUND' | 'UNAUTHORIZED'
└── Yes → Do you have 3+ error variants to handle?
    ├── No → Object literal: { type: 'NOT_FOUND', id: string }
    └── Yes → TaggedError with match()
```

| Use case | Recommendation |
|----------|---------------|
| Simple distinct states | String literals: `'NOT_FOUND' \| 'UNAUTHORIZED'` |
| Errors with context | TaggedError: `NotFoundError { id, resource }` |
| Multiple variants to handle | TaggedError with `match()` |
| API responses | TaggedError for structured data |

## When to migrate from string literals

**Start with string literals.** They're simpler and often sufficient:

```typescript
// Good for simple cases
const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND' | 'FORBIDDEN'> => {
  // ...
};
```

**Migrate to TaggedError when:**

1. **You need error context for debugging:**

```typescript
// ❌ Before: No context, hard to debug
return err('NOT_FOUND');

// ✅ After: Rich context
return err(new NotFoundError({ resource: 'User', id, searchedAt: 'users_table' }));
```

2. **You're handling 3+ error types with different logic:**

```typescript
// ❌ Before: Verbose switch/case
if (error === 'NOT_FOUND') { ... }
else if (error === 'FORBIDDEN') { ... }
else if (error === 'RATE_LIMITED') { ... }
else if (error === 'VALIDATION_FAILED') { ... }

// ✅ After: Exhaustive, type-safe match
TaggedError.match(error, {
  NotFoundError: (e) => { ... },
  ForbiddenError: (e) => { ... },
  RateLimitedError: (e) => { ... },
  ValidationError: (e) => { ... },
});
```

3. **You want TypeScript to catch missing error handlers:**

```typescript
// With TaggedError.match(), forgetting a handler is a compile error
TaggedError.match(error, {
  NotFoundError: (e) => { ... },
  // ForbiddenError: ... // TypeScript error: Missing handler!
});
```

## Migration example

**Before: String literals**

```typescript
type UserError = 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION_FAILED';

const fetchUser = async (id: string): AsyncResult<User, UserError> => {
  if (!session.valid) return err('FORBIDDEN');
  const user = await db.users.find(id);
  if (!user) return err('NOT_FOUND');
  return ok(user);
};

// Handling
if (!result.ok) {
  if (result.error === 'NOT_FOUND') {
    return res.status(404).json({ error: 'User not found' });
  }
  // No context about WHICH user wasn't found
}
```

**After: TaggedError**

```typescript
class UserNotFoundError extends TaggedError('UserNotFoundError')<{
  userId: string;
}> {}

class UserForbiddenError extends TaggedError('UserForbiddenError')<{
  userId: string;
  reason: 'session_expired' | 'insufficient_permissions';
}> {}

class UserValidationError extends TaggedError('UserValidationError')<{
  field: string;
  message: string;
}> {}

type UserError = UserNotFoundError | UserForbiddenError | UserValidationError;

const fetchUser = async (id: string): AsyncResult<User, UserError> => {
  if (!session.valid) {
    return err(new UserForbiddenError({ userId: id, reason: 'session_expired' }));
  }
  const user = await db.users.find(id);
  if (!user) {
    return err(new UserNotFoundError({ userId: id }));
  }
  return ok(user);
};

// Handling - exhaustive and with context
if (!result.ok) {
  const response = TaggedError.match(result.error, {
    UserNotFoundError: (e) => ({
      status: 404,
      body: { error: 'not_found', userId: e.userId },
    }),
    UserForbiddenError: (e) => ({
      status: 403,
      body: { error: 'forbidden', reason: e.reason },
    }),
    UserValidationError: (e) => ({
      status: 400,
      body: { error: 'validation', field: e.field, message: e.message },
    }),
  });
  return res.status(response.status).json(response.body);
}
```

---

## Creating tagged errors

**WHAT**: Define error classes that extend `TaggedError` with typed properties.

**WHY**: Each error type becomes a distinct class with typed data, enabling pattern matching and rich debugging context.

```typescript
import { TaggedError } from 'awaitly';

// Pattern 1: Props via generic
class NotFoundError extends TaggedError('NotFoundError')<{
  resource: string;
  id: string;
}> {}

// Pattern 2: Custom message
class ValidationError extends TaggedError('ValidationError', {
  message: (p: { field: string; reason: string }) =>
    `Validation failed for ${p.field}: ${p.reason}`,
}) {}

// Pattern 3: No props
class UnauthorizedError extends TaggedError('UnauthorizedError') {}
```

## Using tagged errors

```typescript
const fetchUser = async (id: string): AsyncResult<User, NotFoundError | UnauthorizedError> => {
  if (!session.isValid) {
    return err(new UnauthorizedError());
  }
  const user = await db.users.find(id);
  if (!user) {
    return err(new NotFoundError({ resource: 'User', id }));
  }
  return ok(user);
};
```

---

## Pattern matching with match()

**WHAT**: Use `TaggedError.match` to handle each error variant with exhaustive type checking.

**WHY**: TypeScript ensures you handle every error type - forget one and you get a compile error.

`TaggedError.match` forces exhaustive handling:

```typescript
const workflow = createWorkflow({ fetchUser, updateProfile });

const result = await workflow(async (step) => {
  const user = await step(fetchUser('123'));
  return await step(updateProfile(user.id, data));
});

if (!result.ok) {
  const response = TaggedError.match(result.error, {
    NotFoundError: (e) => ({
      status: 404,
      body: { error: 'not_found', resource: e.resource, id: e.id },
    }),
    UnauthorizedError: () => ({
      status: 401,
      body: { error: 'unauthorized' },
    }),
    ValidationError: (e) => ({
      status: 400,
      body: { error: 'validation', field: e.field, reason: e.reason },
    }),
  });

  return res.status(response.status).json(response.body);
}
```

Add a new error type? TypeScript errors until you handle it.

## Partial matching

Handle specific errors with a fallback:

```typescript
const message = TaggedError.matchPartial(
  result.error,
  {
    RateLimitError: (e) => `Please wait ${e.retryAfter} seconds`,
  },
  (e) => `Something went wrong: ${e.message}` // Fallback
);
```

---

## Type helpers

Extract type information from tagged errors for reuse:

```typescript
import { type TagOf, type ErrorByTag } from 'awaitly';

type AllErrors = NotFoundError | ValidationError | RateLimitError;

// Extract tag literals
type Tags = TagOf<AllErrors>;
// 'NotFoundError' | 'ValidationError' | 'RateLimitError'

// Extract specific variant
type NotFound = ErrorByTag<AllErrors, 'NotFoundError'>;
// NotFoundError
```

## Runtime checks

Tagged errors support `instanceof`:

```typescript
const error = new NotFoundError({ resource: 'User', id: '123' });

console.log(error instanceof TaggedError);  // true
console.log(error instanceof NotFoundError); // true
console.log(error._tag);                     // 'NotFoundError'
console.log(error.resource);                 // 'User'
console.log(error.message);                  // 'NotFoundError'
```

## Error chaining

Link to the original error via `ErrorOptions.cause`:

```typescript
try {
  await fetch('/api');
} catch (original) {
  throw new NetworkError(
    { url: '/api', statusCode: 500 },
    { cause: original } // Chain to original error
  );
}
```

---

## Real-world example

Here's a complete example showing TaggedError in a payment workflow:

```typescript
// Define error types
class PaymentDeclinedError extends TaggedError('PaymentDeclinedError', {
  message: (p: { reason: 'insufficient_funds' | 'card_expired' | 'fraud' }) =>
    `Payment declined: ${p.reason}`,
}) {}

class PaymentProviderError extends TaggedError('PaymentProviderError', {
  message: (p: { provider: string; statusCode: number }) =>
    `${p.provider} returned ${p.statusCode}`,
}) {}

// Use in workflow
const processPayment = async (
  amount: number
): AsyncResult<Receipt, PaymentDeclinedError | PaymentProviderError> => {
  const response = await paymentProvider.charge(amount);

  if (response.declined) {
    return err(new PaymentDeclinedError({ reason: response.declineReason }));
  }
  if (!response.ok) {
    return err(new PaymentProviderError({
      provider: 'Stripe',
      statusCode: response.status,
    }));
  }
  return ok(response.receipt);
};

// Handle errors
if (!result.ok) {
  TaggedError.match(result.error, {
    PaymentDeclinedError: (e) => {
      switch (e.reason) {
        case 'insufficient_funds':
          notifyUser('Please use a different card');
          break;
        case 'card_expired':
          notifyUser('Your card has expired');
          break;
        case 'fraud':
          alertFraudTeam(e);
          break;
      }
    },
    PaymentProviderError: (e) => {
      logToDatadog({ provider: e.provider, status: e.statusCode });
      retryWithBackup(e.provider);
    },
  });
}
```

## Reserved keys

These property names are reserved and cannot be used in props:

| Key | Reason |
|-----|--------|
| `_tag` | Discriminant for pattern matching |
| `name` | Error.name (stack traces) |
| `message` | Error.message (logs) |
| `stack` | Error.stack (stack trace) |

```typescript
// Don't do this
class BadExample extends TaggedError('BadExample')<{
  message: string; // Won't work - use 'details' instead
}> {}

// Do this
class GoodExample extends TaggedError('GoodExample')<{
  details: string;
}> {}
```

## Next

[Learn about Retries & Timeouts →](../../guides/retries-timeouts/)
