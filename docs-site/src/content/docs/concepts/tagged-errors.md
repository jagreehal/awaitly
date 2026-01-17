---
title: Tagged Errors
description: Rich error types with exhaustive pattern matching
---

String literal errors like `'NOT_FOUND'` work for simple cases. When you need errors with contextual data, use `TaggedError`.

## When to use what

| Use case | Recommendation |
|----------|---------------|
| Simple distinct states | String literals: `'NOT_FOUND' \| 'UNAUTHORIZED'` |
| Errors with context | TaggedError: `NotFoundError { id, resource }` |
| Multiple variants to handle | TaggedError with `match()` |
| API responses | TaggedError for structured data |

## Creating tagged errors

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

## Pattern matching with match()

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

## Type helpers

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

## Real-world example

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

[Learn about Retries & Timeouts →](/workflow/guides/retries-timeouts/)
