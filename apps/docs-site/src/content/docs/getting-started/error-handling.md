---
title: Handling Errors
description: Getting errors into the type system, and acting on them at the boundary
---

[What TypeScript gives you back](getting-started/types/) covered the error union and
where it comes from. This page is about the two practical jobs left: getting
*throwing* code into the union, and acting on the union at your application edge.

## Bringing throwing code in

Most existing code throws. `step.try` turns a throw into a typed error:

```typescript
const result = await workflow.run(async ({ step }) => {
  const data = await step.try(
    'fetchData',
    async () => {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    { error: 'FETCH_FAILED' as const }
  );
  return data;
});
// result.error now includes 'FETCH_FAILED' instead of UnexpectedError
```

Without `step.try`, that throw would still be caught — it would just arrive as an
opaque `UnexpectedError` rather than something you can `switch` on.

## Keeping error detail

When an operation already returns a rich error object, `step.fromResult` lets you
reshape it as it enters the workflow:

```typescript
type ApiError = { code: string; message: string };
const callApi = async (): AsyncResult<Data, ApiError> =>
  err({ code: 'RATE_LIMITED', message: 'Too many requests' });

const result = await workflow.run(async ({ step }) => {
  return step.fromResult('callApi', () => callApi(), {
    onError: (e) => ({ type: 'API_ERROR' as const, code: e.code, message: e.message }),
  });
});
```

## Acting on it at the boundary

One `if`, then one `switch`. This is the only place in your app that deals with failure:

```typescript
import { isUnexpectedError } from 'awaitly';

if (result.ok) {
  return res.status(200).json(result.value);
}

if (isUnexpectedError(result.error)) {
  logger.error({ cause: result.error.cause }, 'unhandled exception');
  return res.status(500).json({ error: 'Internal error' });
}

switch (result.error) {
  case 'NOT_FOUND':     return res.status(404).json({ error: 'User not found' });
  case 'UNAUTHORIZED':  return res.status(401).json({ error: 'Please log in' });
  case 'FETCH_ERROR':   return res.status(502).json({ error: 'Upstream failed' });
}
```

Handle `UnexpectedError` first and the remaining `switch` is over your own domain
errors only — which is what makes an exhaustiveness check meaningful.

## Choosing an error shape

| Situation | Shape |
|---|---|
| A handful of distinct states | String literals: `'NOT_FOUND' \| 'UNAUTHORIZED'` |
| The error carries data | Object: `{ type: 'NOT_FOUND', id: string }` |
| Shared across a codebase or API | [Tagged Errors](foundations/tagged-errors/) |

Start with string literals. Move to objects when you find yourself needing the `id`
that failed, and to `TaggedError` when the same error crosses module boundaries.

## Need help?

TypeScript not narrowing the way you expect? See [Troubleshooting](guides/troubleshooting/).

## Next

You now know everything needed to use awaitly day to day.
[Foundations](foundations/) goes deeper on each piece — Result combinators, step
options, control flow, retries, persistence, and streaming.

[Continue to Foundations →](foundations/)
