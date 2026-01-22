---
title: Results
description: The Result type and how to work with it
---

A `Result<T, E>` represents either success (`ok`) or failure (`err`). It replaces try/catch with explicit typing.

## Creating Results

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

// Synchronous
const divide = (a: number, b: number): Result<number, 'DIVIDE_BY_ZERO'> =>
  b === 0 ? err('DIVIDE_BY_ZERO') : ok(a / b);

// Asynchronous
const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
  const user = await db.users.find(id);
  return user ? ok(user) : err('NOT_FOUND');
};
```

## Checking Results

```typescript
const result = divide(10, 2);

if (result.ok) {
  console.log(result.value); // 5 - TypeScript knows it's a number
} else {
  console.log(result.error); // TypeScript knows it's 'DIVIDE_BY_ZERO'
}
```

## Type guards

```typescript
import { isOk, isErr } from 'awaitly';

if (isOk(result)) {
  // result.value is accessible
}

if (isErr(result)) {
  // result.error is accessible
}
```

## Transforming Results

### map - transform the value

```typescript
import { map } from 'awaitly';

const result = ok(5);
const doubled = map(result, (n) => n * 2);
// ok(10)
```

### mapError - transform the error

```typescript
import { mapError } from 'awaitly';

const result = err('NOT_FOUND');
const mapped = mapError(result, (e) => ({ type: e, status: 404 }));
// err({ type: 'NOT_FOUND', status: 404 })
```

### andThen - chain operations

```typescript
import { andThen } from 'awaitly';

const result = ok(10);
const chained = andThen(result, (n) =>
  n > 0 ? ok(n * 2) : err('NEGATIVE')
);
// ok(20)
```

### match - pattern match

```typescript
import { match } from 'awaitly';

const message = match(
  result,
  (value) => `Success: ${value}`,
  (error) => `Error: ${error}`
);
```

## Unwrapping

### unwrap - get value or throw

```typescript
import { unwrap } from 'awaitly';

const value = unwrap(result); // Throws if err
```

### unwrapOr - get value or default

```typescript
import { unwrapOr } from 'awaitly';

const value = unwrapOr(result, 0); // Returns 0 if err
```

### unwrapOrElse - get value or compute default

```typescript
import { unwrapOrElse } from 'awaitly';

const value = unwrapOrElse(result, (error) => {
  console.log('Failed with:', error);
  return 0;
});
```

## Wrapping throwing code

### from - wrap sync function

```typescript
import { from } from 'awaitly';

const result = from(() => JSON.parse(jsonString));
// ok(parsed) or err(Error)
```

### fromPromise - wrap async function

```typescript
import { fromPromise } from 'awaitly';

const result = await fromPromise(fetch('/api/data'));
// ok(Response) or err(Error)
```

### tryAsync - wrap with custom error

```typescript
import { tryAsync } from 'awaitly';

const result = await tryAsync(
  () => fetch('/api/data').then(r => r.json()),
  (thrown) => ({ type: 'FETCH_FAILED' as const, cause: thrown })
);
```

## Batch operations

### all - fail fast

```typescript
import { all } from 'awaitly';

const results = [ok(1), ok(2), ok(3)];
const combined = all(results);
// ok([1, 2, 3])

const withError = [ok(1), err('FAILED'), ok(3)];
const failed = all(withError);
// err('FAILED')
```

### allSettled - collect all

```typescript
import { allSettled } from 'awaitly';

const results = [ok(1), err('A'), ok(3), err('B')];
const settled = allSettled(results);
// ok([
//   { status: 'ok', value: 1 },
//   { status: 'err', error: 'A' },
//   { status: 'ok', value: 3 },
//   { status: 'err', error: 'B' },
// ])
```

### partition - separate successes and failures

```typescript
import { partition } from 'awaitly';

const results = [ok(1), err('A'), ok(3)];
const [successes, failures] = partition(results);
// successes: [1, 3]
// failures: ['A']
```

## Async versions

Most operations have async variants for working with promises:

```typescript
import { allAsync, anyAsync } from 'awaitly';

const results = await allAsync([
  fetchUser('1'),
  fetchPosts('1'),
  fetchComments('1'),
]);
```

## Next

[Learn about Steps →](../step/)
