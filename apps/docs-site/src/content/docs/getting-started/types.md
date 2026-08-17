---
title: What TypeScript Gives You Back
description: Every return type awaitly produces, and the rules that produce it
---

This is the page to read if you only read one. awaitly's value is not that it
avoids `try/catch`. It's that **the compiler knows every way your code can fail**,
without you writing that list down. This page states exactly what you get and why.

## The two shapes

Everything is one of these:

```typescript
type Ok<T>             = { ok: true;  value: T };
type Err<E, C = unknown> = { ok: false; error: E; cause?: C };

type Result<T, E = unknown>      = Ok<T> | Err<E>;
type AsyncResult<T, E = unknown> = Promise<Result<T, E>>;
```

`Result` takes two type parameters, not three. `cause` is always present at
runtime. It carries whatever was originally thrown, but its *type* is only
tracked on `Err`, where `err(error, { cause })` infers it. Once a value is
widened to a `Result`, which is what annotating a function's return type does,
`cause` reads as `unknown` and you narrow it yourself.

`AsyncResult<T, E>` is `Promise<Result<T, E>>`. Use it as the return type of any
async operation that can fail.

`ok` is a discriminant, so a single `if` narrows both branches:

```typescript
const result = await getUser('1');

if (result.ok) {
  result.value;  // User
  result.error;  // compile error — doesn't exist on this branch
} else {
  result.error;  // 'NOT_FOUND'
  result.value;  // compile error
}
```

## Rule 1: the error union comes from your deps

You never write the error type of a `run()` or a workflow. It is computed:

```typescript
const getUser  = async (id: string): AsyncResult<User, 'NOT_FOUND'> => { /* ... */ };
const getPosts = async (id: string): AsyncResult<Post[], 'FETCH_ERROR'> => { /* ... */ };
const notify   = async (to: string): AsyncResult<void, 'EMAIL_FAILED'> => { /* ... */ };

const result = await run({ getUser, getPosts, notify }, async (s) => { /* ... */ });
//    ^? Result<T, 'NOT_FOUND' | 'FETCH_ERROR' | 'EMAIL_FAILED' | UnexpectedError>
```

Each dep contributes its own `E`. The union is their sum. Add a dep and it widens;
remove one and it narrows, and every `switch` over `result.error` is re-checked.

This holds identically for `createWorkflow`:

```typescript
const wf = createWorkflow('loadUser', { getUser, getPosts });
const result = await wf.run(async ({ steps }) => { /* ... */ });
//    ^? Result<T, 'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError>
```

You see the **literal union** on hover, not an opaque alias like `ErrorsOf<Deps>`.
That's deliberate, so a typo like `result.error === 'NOT_FUOND'` is a compile error.

## Rule 2: inside the callback, values are unwrapped

The deps object you pass in comes back with the same keys and the same arguments,
but the Result is stripped off:

```typescript
//  declared: (id: string) => AsyncResult<User, 'NOT_FOUND'>
//  bound as: (id: string) => Promise<User>

await run({ getUser }, async (s) => {
  const user = await s.getUser('1');
  //    ^? User        — not Result<User, 'NOT_FOUND'>
});
```

The `'NOT_FOUND'` didn't vanish. It moved to the **outer** result type. That is the
trade the whole library makes: no error handling in the middle, all of it at the edge.

## Rule 3: `UnexpectedError` is always there (unless you remove it)

A dep that *returns* `err('X')` contributes `'X'`. A dep that *throws* contributes
`UnexpectedError`, because a throw is not in any signature:

```typescript
const result = await run({ getUser }, async (s) => { /* ... */ });
//    ^? Result<T, 'NOT_FOUND' | UnexpectedError>

if (!result.ok && isUnexpectedError(result.error)) {
  result.error.cause; // unknown — the original thrown value
}
```

To get a **closed** union with no `UnexpectedError`, map throws to your own type with
`catchUnexpected`. Note this is *not* available on the deps-first `run(deps, fn)` form , 
it lives on `createWorkflow` (at creation) and on `run.strict`:

```typescript
// On a workflow — deps still infer as normal
const wf = createWorkflow('loadUser', { getUser }, {
  catchUnexpected: (thrown) => ({ type: 'CRASHED', thrown }),
});
// result.error: 'NOT_FOUND' | { type: 'CRASHED'; thrown: unknown }
```

```typescript
// On a bare run, via run.strict
type Crash = { type: 'CRASHED'; thrown: unknown };

const result = await run.strict<User, 'NOT_FOUND' | Crash>(
  async ({ step }) => step('getUser', () => getUser('1')),
  { catchUnexpected: (thrown) => ({ type: 'CRASHED', thrown }) }
);
//    ^? Result<User, 'NOT_FOUND' | Crash>
```

With `run.strict` you supply `E` yourself, and it must cover **both** your step errors
and whatever `catchUnexpected` returns. It is the one place awaitly stops inferring
the union for you. That is the cost of closing it.

## Rule 4: plain functions are legal deps

A dep that doesn't return a Result still works. Its value passes through and it
contributes **nothing** to the error union, only `UnexpectedError` if it throws:

```typescript
const slugify = (s: string) => s.toLowerCase();          // no Result
const getUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => { /* ... */ };

const result = await run({ getUser, slugify }, async (s) => {
  const user = await s.getUser('1');
  return s.slugify(user.name);
});
//    ^? Result<string, 'NOT_FOUND' | UnexpectedError>
```

This is what makes incremental adoption work: wrap existing functions as-is, then
convert them to return Results one at a time and watch the union fill in.

## Naming the union

When you need the error type by name, for an HTTP mapper, a test helper, a shared
handler, derive it rather than retyping it:

```typescript
import { type ErrorsOf, type ErrorOf } from 'awaitly';

const deps = { getUser, getPosts, notify };

type AppError = ErrorsOf<typeof deps>;
//   ^? 'NOT_FOUND' | 'FETCH_ERROR' | 'EMAIL_FAILED'

type UserError = ErrorOf<typeof getUser>;
//   ^? 'NOT_FOUND'
```

Note `ErrorsOf` gives you the **declared** errors only. The runtime union adds
`UnexpectedError` on top; use `ErrorsOf<typeof deps> | UnexpectedError` if you're
annotating a handler for a non-strict run.

## Exhaustiveness

Because the union is literal, a `switch` can be made to fail the build when a new
error appears:

```typescript
function toResponse(error: AppError) {
  switch (error) {
    case 'NOT_FOUND':    return { status: 404 };
    case 'FETCH_ERROR':  return { status: 502 };
    case 'EMAIL_FAILED': return { status: 500 };
    default: {
      const _exhaustive: never = error; // adding a dep breaks compilation here
      return _exhaustive;
    }
  }
}
```

Add `notifySlack` to `deps` and this function stops compiling until you handle its
error. That is the guarantee, not that errors are typed, but that **forgetting one
is a build failure**.

## Cheat sheet

| You write | You get back |
|---|---|
| `AsyncResult<User, 'NOT_FOUND'>` | `Promise<{ok:true,value:User} \| {ok:false,error:'NOT_FOUND'}>` |
| `run({ a, b }, fn)` | `Result<T, ErrorOf<a> \| ErrorOf<b> \| UnexpectedError>` |
| `createWorkflow('n', { a, b })` then `.run(fn)` | same union as above |
| `run.strict(fn, { catchUnexpected })` | `Result<T, E>`, closed, no `UnexpectedError` |
| `s.getUser(id)` inside a callback | `Promise<User>`, unwrapped |
| a plain (non-Result) dep | value passes through, adds nothing to the union |
| a dep that throws | `UnexpectedError`, original in `.cause` |

## Next

[Handling errors at the boundary →](getting-started/error-handling/)
