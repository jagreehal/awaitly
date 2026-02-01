---
title: Handling Errors
description: How errors flow through workflows and how to handle them
---

## Error types are inferred

When you create a workflow, TypeScript computes the error union from your dependencies:

```typescript
const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => { ... };
const fetchPosts = async (id: string): AsyncResult<Post[], 'FETCH_ERROR'> => { ... };
const sendEmail = async (to: string): AsyncResult<void, 'EMAIL_FAILED'> => { ... };

const workflow = createWorkflow({ fetchUser, fetchPosts, sendEmail });

const result = await workflow(async (step) => { ... });
// result.error is: 'NOT_FOUND' | 'FETCH_ERROR' | 'EMAIL_FAILED' | UnexpectedError
```

Add a new dependency? The error union updates automatically.

## UnexpectedError

If code throws an exception (not a returned error), it becomes an `UnexpectedError`:

```typescript
const badOperation = async (): AsyncResult<string, 'KNOWN_ERROR'> => {
  throw new Error('Something broke'); // Throws instead of returning err()
};

const workflow = createWorkflow({ badOperation });
const result = await workflow(async (step) => {
  return await step(badOperation());
});

if (!result.ok && result.error.type === 'UNEXPECTED') {
  console.log(result.error.cause); // The original Error object
}
```

## Wrapping throwing code

Use `step.try` to convert thrown exceptions into typed errors:

```typescript
const result = await workflow(async (step) => {
  const data = await step.try(
    async () => {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    { error: 'FETCH_FAILED' as const }
  );

  return data;
});
// result.error includes 'FETCH_FAILED'
```

## Preserving error details

If your function returns rich error objects, use `step.fromResult`:

```typescript
type ApiError = { code: string; message: string };

const callApi = async (): AsyncResult<Data, ApiError> => {
  return err({ code: 'RATE_LIMITED', message: 'Too many requests' });
};

const result = await workflow(async (step) => {
  const data = await step.fromResult(
    () => callApi(),
    {
      onError: (apiError) => ({
        type: 'API_ERROR' as const,
        code: apiError.code,
        message: apiError.message,
      }),
    }
  );
  return data;
});
```

## Handling specific errors

Use a switch statement for exhaustive handling:

```typescript
if (!result.ok) {
  switch (result.error) {
    case 'NOT_FOUND':
      return res.status(404).json({ error: 'User not found' });
    case 'UNAUTHORIZED':
      return res.status(401).json({ error: 'Please log in' });
    case 'FETCH_ERROR':
      return res.status(502).json({ error: 'Upstream service failed' });
    default:
      // UnexpectedError or unknown error
      console.error(result.error);
      return res.status(500).json({ error: 'Internal error' });
  }
}
```

TypeScript ensures you handle all known error cases.

## Strict mode

By default, thrown exceptions become `UnexpectedError`. Use strict mode to force explicit handling:

```typescript
const workflow = createWorkflow(
  { fetchUser, fetchPosts },
  {
    strict: true,
    catchUnexpected: (thrown) => ({
      type: 'UNEXPECTED' as const,
      message: String(thrown),
    }),
  }
);
```

## When to use string literals vs objects

| Use case | Recommendation |
|----------|---------------|
| Simple distinct states | String literals: `'NOT_FOUND' \| 'UNAUTHORIZED'` |
| Errors with context | Objects: `{ type: 'NOT_FOUND', id: string }` |
| API responses | [Tagged Errors](/foundations/tagged-errors/) for structured data |

## Need help?

Having issues with TypeScript narrowing or error handling? See [Troubleshooting/../guides/troubleshooting/).

## Next

[Learn about Results in depth →](/foundations/result-types/)
