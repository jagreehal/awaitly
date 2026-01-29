---
title: Functional Utilities
description: Effect-inspired functional utilities for Result types with pipe-based composition
---

import { Aside } from '@astrojs/starlight/components';

The `awaitly/functional` module provides Effect-inspired functional utilities for Result types. It includes pipe-based composition, Result combinators, and collection utilities with automatic error short-circuiting.

## Introduction

Functional utilities enable declarative composition of Result-returning operations. Instead of nested conditionals or method chaining, you can use `pipe()` to compose operations left-to-right with automatic error propagation.

```typescript
import { pipe, R } from 'awaitly/functional';
import { ok, err } from 'awaitly';

// Transform and chain operations
const result = pipe(
  ok(5),
  R.map(x => x * 2),           // 10
  R.flatMap(x => x > 0 ? ok(x) : err('NEGATIVE')),
  R.tap(x => console.log(x)),  // Side effect: logs 10
  R.map(x => x + 1)            // 11
);
```

<Aside type="tip" title="Why functional utilities?">
Functional utilities provide a clean alternative to method chaining. They work better with tree-shaking, enable point-free style, and integrate seamlessly with TypeScript's type inference.
</Aside>

## Function Composition

### pipe

Pipe a value through a series of functions left-to-right:

```typescript
import { pipe } from 'awaitly/functional';

const result = pipe(
  5,
  (x) => x * 2,      // 10
  (x) => x + 1       // 11
); // 11
```

With Result types:

```typescript
import { pipe, R } from 'awaitly/functional';
import { ok } from 'awaitly';

const result = pipe(
  ok(5),
  R.map(x => x * 2),
  R.map(x => x + 1)
); // ok(11)
```

### flow

Compose functions left-to-right, returning a new function:

```typescript
import { flow } from 'awaitly/functional';

const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;

const transform = flow(double, addOne);
transform(5); // 11
```

Useful for creating reusable transformations:

```typescript
import { flow, R } from 'awaitly/functional';
import { ok } from 'awaitly';

const processNumber = flow(
  R.map((x: number) => x * 2),
  R.map((x: number) => x + 1)
);

const result = processNumber(ok(5)); // ok(11)
```

### compose

Compose functions right-to-left (opposite of `flow`):

```typescript
import { compose } from 'awaitly/functional';

const double = (x: number) => x * 2;
const addOne = (x: number) => x + 1;

const transform = compose(addOne, double);
transform(5); // 11 (double first, then addOne)
```

### identity

Identity function - returns its argument unchanged:

```typescript
import { identity } from 'awaitly/functional';

identity(42); // 42
```

Useful as a placeholder in compositions or for default transformations.

## Result Combinators (Sync)

### map

Transform the success value:

```typescript
import { map } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const result = ok(5);
map(result, (x) => x * 2); // ok(10)

const error = err("not found");
map(error, (x) => x * 2); // err("not found") - unchanged
```

### flatMap

Transform and flatten (short-circuits on error):

```typescript
import { flatMap } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const divide = (a: number, b: number) =>
  b === 0 ? err("division by zero") : ok(a / b);

const result = ok(10);
flatMap(result, (x) => divide(x, 2)); // ok(5)
flatMap(result, (x) => divide(x, 0)); // err("division by zero")
```

### bimap

Transform both success and error values:

```typescript
import { bimap } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const result = ok(5);
bimap(result, (x) => x * 2, (e) => `Error: ${e}`); // ok(10)

const error = err("not found");
bimap(error, (x) => x * 2, (e) => `Error: ${e}`); // err("Error: not found")
```

### mapError

Transform the error value:

```typescript
import { mapError } from 'awaitly/functional';
import { err } from 'awaitly';

const error = err("not found");
mapError(error, (e) => ({ type: "ERROR", message: e }));
// err({ type: "ERROR", message: "not found" })
```

### tap

Side effect on success (returns original result):

```typescript
import { tap } from 'awaitly/functional';
import { ok } from 'awaitly';

const result = ok(5);
tap(result, (x) => console.log(`Value: ${x}`)); // logs "Value: 5", returns ok(5)
```

### tapError

Side effect on error (returns original result):

```typescript
import { tapError } from 'awaitly/functional';
import { err } from 'awaitly';

const error = err("not found");
tapError(error, (e) => console.log(`Error: ${e}`)); // logs "Error: not found", returns err
```

### match

Pattern match on Result:

```typescript
import { match } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const result = ok(5);
match(result, {
  ok: (x) => `Success: ${x}`,
  err: (e) => `Error: ${e}`
}); // "Success: 5"

const error = err("not found");
match(error, {
  ok: (x) => `Success: ${x}`,
  err: (e) => `Error: ${e}`
}); // "Error: not found"
```

### recover

Recover from error by providing fallback value:

```typescript
import { recover } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const error = err("not found");
recover(error, () => 0); // 0

const success = ok(5);
recover(success, () => 0); // 5
```

### recoverWith

Recover from error with another Result:

```typescript
import { recoverWith } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const error = err("not found");
recoverWith(error, (e) => ok(0)); // ok(0)
recoverWith(error, (e) => err("still failed")); // err("still failed")
```

### getOrElse

Get the value or a default:

```typescript
import { getOrElse } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const error = err("not found");
getOrElse(error, 0); // 0

const success = ok(5);
getOrElse(success, 0); // 5
```

### getOrElseLazy

Get the value or compute a default lazily:

```typescript
import { getOrElseLazy } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const error = err("not found");
getOrElseLazy(error, () => expensiveComputation()); // calls expensiveComputation()

const success = ok(5);
getOrElseLazy(success, () => expensiveComputation()); // 5, doesn't call expensiveComputation
```

## Result Combinators (Async)

### mapAsync

Transform success value asynchronously:

```typescript
import { mapAsync } from 'awaitly/functional';
import { ok } from 'awaitly';

const result = ok(5);
await mapAsync(result, async (x) => x * 2); // ok(10)
```

### flatMapAsync

Async flatMap:

```typescript
import { flatMapAsync } from 'awaitly/functional';
import { ok, type AsyncResult } from 'awaitly';

const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
  // ... fetch logic
};

const result = ok("user-123");
await flatMapAsync(result, fetchUser); // AsyncResult<User, "NOT_FOUND">
```

### tapAsync

Async side effect on success:

```typescript
import { tapAsync } from 'awaitly/functional';
import { ok } from 'awaitly';

const result = ok(5);
await tapAsync(result, async (x) => {
  await logToServer(x);
}); // ok(5)
```

### tapErrorAsync

Async side effect on error:

```typescript
import { tapErrorAsync } from 'awaitly/functional';
import { err } from 'awaitly';

const error = err("not found");
await tapErrorAsync(error, async (e) => {
  await logErrorToServer(e);
}); // err("not found")
```

## Collection Utilities

### all

Combine array of Results - fails fast on first error:

```typescript
import { all } from 'awaitly/functional';
import { ok, err } from 'awaitly';

all([ok(1), ok(2), ok(3)]); // ok([1, 2, 3])
all([ok(1), err("fail"), ok(3)]); // err("fail")
```

### allAsync

Combine array of AsyncResults - parallel execution, fails fast:

```typescript
import { allAsync } from 'awaitly/functional';
import { ok, type AsyncResult } from 'awaitly';

const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
  // ... fetch logic
};

await allAsync([
  fetchUser("1"),
  fetchUser("2"),
  fetchUser("3")
]); // AsyncResult<User[], "NOT_FOUND">
```

Returns immediately when any result fails, without waiting for pending promises.

### allSettled

Collect all results, separating successes and failures:

```typescript
import { allSettled } from 'awaitly/functional';
import { ok, err } from 'awaitly';

allSettled([ok(1), err("a"), ok(2), err("b")]);
// { ok: [1, 2], err: ["a", "b"] }
```

### allSettledAsync

Async version of allSettled:

```typescript
import { allSettledAsync } from 'awaitly/functional';

await allSettledAsync([
  fetchUser("1"),
  fetchUser("2"),
  fetchUser("3")
]); // { ok: [...users], err: [...errors] }
```

### any

Return first success, or all errors if all fail:

```typescript
import { any } from 'awaitly/functional';
import { ok, err } from 'awaitly';

any([err("a"), ok(1), err("b")]); // ok(1)
any([err("a"), err("b"), err("c")]); // err(["a", "b", "c"])
```

### anyAsync

Async version of any - returns first success immediately:

```typescript
import { anyAsync } from 'awaitly/functional';

await anyAsync([
  fetchFromCache(key),
  fetchFromDb(key),
  fetchFromApi(key)
]); // First successful result
```

### race

Race async results - first to complete wins:

```typescript
import { race } from 'awaitly/functional';

await race([
  fetchFromPrimaryServer(id),
  fetchFromBackupServer(id)
]); // Result from whichever server responds first
```

### traverse

Sequence an array through a Result-returning function. Stops on first error:

```typescript
import { traverse } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const validate = (x: number) =>
  x > 0 ? ok(x) : err("must be positive");

traverse([1, 2, 3], validate); // ok([1, 2, 3])
traverse([1, -2, 3], validate); // err("must be positive")
```

### traverseAsync

Async version of traverse:

```typescript
import { traverseAsync } from 'awaitly/functional';

await traverseAsync(userIds, async (id) => fetchUser(id));
```

### traverseParallel

Parallel traverse - executes all in parallel, fails fast:

```typescript
import { traverseParallel } from 'awaitly/functional';

await traverseParallel(userIds, fetchUser);
```

Returns immediately when any result fails, without waiting for pending operations.

## Pipeable Functions (R namespace)

The `R` namespace provides curried versions of all Result combinators for use in `pipe()`:

```typescript
import { pipe, R } from 'awaitly/functional';
import { ok } from 'awaitly';

const result = pipe(
  fetchUser(id),
  R.flatMap(user => fetchPosts(user.id)),
  R.map(posts => posts.filter(p => p.published)),
  R.tap(posts => console.log(`Found ${posts.length} posts`)),
  R.match({
    ok: posts => `Found ${posts.length} posts`,
    err: error => `Failed: ${error}`
  })
);
```

### Available R functions

- `R.map(fn)` - Transform value
- `R.flatMap(fn)` - Chain operations
- `R.bimap(onOk, onErr)` - Transform both value and error
- `R.mapError(fn)` - Transform error
- `R.tap(fn)` - Side effect on success
- `R.tapError(fn)` - Side effect on error
- `R.match(patterns)` - Pattern match
- `R.recover(fn)` - Recover with fallback value
- `R.recoverWith(fn)` - Recover with Result
- `R.getOrElse(defaultValue)` - Get value or default
- `R.getOrElseLazy(fn)` - Get value or compute default

## Real-World Examples

### API Request Pipeline

```typescript
import { pipe, R } from 'awaitly/functional';
import { ok, err, type AsyncResult } from 'awaitly';

type User = { id: string; name: string };
type Post = { id: string; userId: string; title: string };

const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
  // ... fetch logic
};

const fetchPosts = async (userId: string): AsyncResult<Post[], "FETCH_ERROR"> => {
  // ... fetch logic
};

const result = await pipe(
  fetchUser("123"),
  R.flatMapAsync(user => fetchPosts(user.id)),
  R.map(posts => posts.filter(p => p.title.length > 10)),
  R.tapAsync(async posts => {
    await logAnalytics({ postCount: posts.length });
  }),
  R.map(posts => ({ count: posts.length, posts }))
);
```

### Validation Pipeline

```typescript
import { pipe, R, traverse } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const validateEmail = (email: string) =>
  email.includes("@") ? ok(email) : err("INVALID_EMAIL");

const validateAge = (age: number) =>
  age >= 18 ? ok(age) : err("UNDERAGE");

const validateUser = (user: { email: string; age: number }) =>
  pipe(
    ok(user),
    R.flatMap(u => validateEmail(u.email)),
    R.flatMap(() => validateAge(user.age)),
    R.map(() => user)
  );

const validateUsers = (users: Array<{ email: string; age: number }>) =>
  traverse(users, validateUser);
```

### Error Recovery Chain

```typescript
import { pipe, R } from 'awaitly/functional';
import { ok, err } from 'awaitly';

const fetchFromPrimary = (): AsyncResult<Data, "PRIMARY_ERROR"> => {
  // ... fetch logic
};

const fetchFromFallback = (): AsyncResult<Data, "FALLBACK_ERROR"> => {
  // ... fetch logic
};

const result = await pipe(
  fetchFromPrimary(),
  R.recoverWith(() => fetchFromFallback()),
  R.mapError(e => ({ type: "FETCH_FAILED", source: e })),
  R.tapError(e => console.error("Fetch failed:", e))
);
```

## Comparison with Method Chaining

Functional utilities provide an alternative to method chaining:

```typescript
// Method chaining (not available in awaitly)
// result.map(x => x * 2).flatMap(x => ok(x + 1))

// Functional style
import { pipe, R } from 'awaitly/functional';

pipe(
  result,
  R.map(x => x * 2),
  R.flatMap(x => ok(x + 1))
)
```

<Aside type="tip" title="Why not methods?">
awaitly uses standalone functions instead of methods for better tree-shaking, functional composition, and TypeScript inference. The `R` namespace provides curried versions that work seamlessly with `pipe()`.
</Aside>

## Type Safety

All functional utilities preserve TypeScript types:

```typescript
import { pipe, R } from 'awaitly/functional';
import { ok, err, type Result } from 'awaitly';

const result: Result<number, "NOT_FOUND" | "INVALID"> = ok(5);

const transformed = pipe(
  result,
  R.map(x => x * 2),              // Result<number, "NOT_FOUND" | "INVALID">
  R.flatMap(x => x > 0 ? ok(x) : err("INVALID" as const))
  // Result<number, "NOT_FOUND" | "INVALID">
);
```

TypeScript infers error unions automatically across compositions.

## Best Practices

1. **Use `pipe()` for linear compositions** - Clean left-to-right flow
2. **Use `R` namespace in pipes** - Curried functions work seamlessly
3. **Use `flow()` for reusable transformations** - Create composable functions
4. **Prefer `getOrElseLazy()` over `getOrElse()`** - Avoid unnecessary computation
5. **Use `allAsync()` for parallel operations** - Automatic error short-circuiting
6. **Use `traverse()` for sequential validation** - Stops on first error

## Related

- [Result Types/../foundations/result-types/) - Understanding Result types
- [Workflows and Steps/../foundations/workflows-and-steps/) - Using Results in workflows
- [API Reference/../reference/api/) - Complete functional utilities API
