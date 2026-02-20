---
title: API Reference
description: Complete API documentation (generated from TypeDoc)
---

This page is generated from the awaitly package JSDoc and TypeScript types. For workflow and step options, see [Options reference](#options-reference) below.

## Import styles

You can use **named exports** (tree-shake friendly) or the **Awaitly** namespace. For **minimal bundle** (Result types only, no namespace), use `awaitly/result`:

```typescript
// Minimal bundle: Result types only
import { ok, err, map, andThen, type AsyncResult } from 'awaitly/result';

// Full package: named exports
import { ok, err, pipe, map, type AsyncResult } from 'awaitly';

// Full package: Awaitly namespace (Effect-style single object)
import { Awaitly } from 'awaitly';
Awaitly.ok(1); Awaitly.err('E'); Awaitly.pipe(2, (n) => n * 2);
```

## Results

### Constructors

### err

Creates a failed Result.

When to use: Return a typed failure without throwing so callers can handle it explicitly.

```typescript
err(error: E, options?: unknown): Err<E, C>
```

### ok

Creates a successful Result.

When to use: Wrap a successful value in a Result for consistent return types.

```typescript
ok(value: T): Ok<T>
```

### Type guards

### isErr

Checks if a Result is a failure.

When to use: Prefer functional-style checks or array filtering.

```typescript
isErr(r: Result<T, E, C>): (value: Err<E, C>) => boolean
```

### isOk

Checks if a Result is successful.

When to use: Prefer functional-style checks or array filtering.

```typescript
isOk(r: Result<T, E, C>): (value: Ok<T>) => boolean
```

### isUnexpectedError

Checks if an error is an UnexpectedError.

When to use: Distinguish unexpected failures from your typed error union.

```typescript
isUnexpectedError(e: unknown): (value: UnexpectedError) => boolean
```

## Unwrap

### unwrap

Extracts the value from an Ok result, or throws UnwrapError if it's an Err.

When to use: Only at boundaries or tests where a failure should be fatal.

```typescript
unwrap(r: Result<T, E, C>): T
```

### unwrapOr

Extracts the value from an Ok result, or returns a default value if it's an Err.

When to use: Provide a safe fallback without branching.

```typescript
unwrapOr(r: Result<T, E, C>, defaultValue: T): T
```

### unwrapOrElse

Extracts the value from an Ok result, or calls a function to get a default value if it's an Err.

When to use: Compute a fallback from the error (logging, metrics, or derived defaults).

```typescript
unwrapOrElse(r: Result<T, E, C>, fn: (error: E, cause?: C) => T): T
```

## Wrap

### from

Wraps a synchronous function that might throw into a Result.

When to use: Wrap sync code that might throw so exceptions become Err values.

```typescript
from(fn: () => T): Err<unknown, unknown> | Ok<T>
```

### fromNullable

Converts a nullable value into a Result.

When to use: Turn null/undefined into a typed error before continuing.

```typescript
fromNullable(value: T | unknown | undefined, onNull: () => E): Result<T, E>
```

### fromPromise

Wraps a Promise into a Result.

When to use: Wrap a Promise and keep the raw rejection as Err; use tryAsync to map errors.

```typescript
fromPromise(promise: Promise<T>): Promise<Err<unknown, unknown> | Ok<T>>
```

### tryAsync

Wraps an async function that might throw into an AsyncResult.

When to use: Wrap async work and map thrown/rejected values into your typed error union.

```typescript
tryAsync(fn: () => Promise<T>): AsyncResult<T, unknown>
```

## Transform

### andThen

Chain Result-returning functions.

When to use: Chain dependent operations that return Result without nested branching.

```typescript
andThen(r: Ok<T>, fn: (value: T) => Ok<U>): Ok<U>
```

### map

Transforms the value inside an Ok result.

When to use: Transform only the Ok value while leaving Err untouched.

```typescript
map(r: Ok<T>, fn: (value: T) => U): Ok<U>
```

### mapError

Transforms the error inside an Err result.

When to use: Retype or normalize errors while leaving Ok values unchanged.

```typescript
mapError(r: Result<T, E, C>, fn: (error: E, cause?: C) => F): Result<T, F, C>
```

### mapErrorTry

Transform error with a function that might throw.

When to use: Transform errors when the mapping might throw and you want that captured.

```typescript
mapErrorTry(r: Result<T, E, C>, fn: (error: E) => F, onError: (thrown: unknown) => G): Result<T, F | G, unknown>
```

### mapTry

Transform value with a function that might throw.

When to use: Transform Ok values with a function that might throw and capture the failure.

```typescript
mapTry(r: Result<T, E, C>, fn: (value: T) => U, onError: (thrown: unknown) => F): Result<U, E | F, unknown>
```

### match

Pattern match on a Result.

When to use: Handle both Ok and Err in a single expression that returns a value.

```typescript
match(r: Ok<T>, handlers: unknown): R
```

### orElse

Provide an alternative Result if the first is an Err.

When to use: Recover from Err by returning a fallback Result or retyping the error.

```typescript
orElse(r: Result<T, E, C>, fn: (error: E, cause?: C) => Result<T, E2, C2>): Result<T, E2, C | C2>
```

### tap

Execute a side effect on Ok values.

When to use: Add side effects (logging, metrics) on Ok without changing the Result.

```typescript
tap(r: Result<T, E, C>, fn: (value: T) => void): Result<T, E, C>
```

### tapError

Execute a side effect on Err values.

When to use: Add side effects (logging, metrics) on Err without changing the Result.

```typescript
tapError(r: Result<T, E, C>, fn: (error: E, cause?: C) => void): Result<T, E, C>
```

## Function Composition

### pipe

Pipe a value through a series of functions left-to-right.

```typescript
pipe(a: A): A
```

### flow

Compose functions left-to-right (returns a function).

```typescript
flow(ab: (a: A) => B): (a: A) => B
```

### compose

Compose functions right-to-left.

```typescript
compose(ab: (a: A) => B): (a: A) => B
```

### identity

Identity function - returns its argument unchanged.

```typescript
identity(a: A): A
```

### R

Curried Result combinators for use in pipe().

### recoverWith

Recover from error with another Result.

```typescript
recoverWith(result: Result<T, E1, C1>, fn: (error: E1) => Result<T, E2, C2>): Result<T, E2, C1 | C2>
```

### getOrElse

Get the value or a default.

```typescript
getOrElse(result: Result<T, E, C>, defaultValue: T): T
```

### getOrElseLazy

Get the value or compute a default lazily.

```typescript
getOrElseLazy(result: Result<T, E, C>, fn: () => T): T
```

### mapAsync

Transform success value asynchronously.

```typescript
mapAsync(result: Result<T, E, C> | AsyncResult<T, E, C>, fn: (value: T) => Promise<U>): AsyncResult<U, E, C>
```

### flatMapAsync

Async flatMap.

```typescript
flatMapAsync(result: Result<T, E1, C1> | AsyncResult<T, E1, C1>, fn: (value: T) => AsyncResult<U, E2, C2>): AsyncResult<U, E1 | E2, C1 | C2>
```

### tapAsync

Async tap - side effect on success.

```typescript
tapAsync(result: Result<T, E, C> | AsyncResult<T, E, C>, fn: (value: T) => Promise<void>): AsyncResult<T, E, C>
```

### tapErrorAsync

Async tapError - side effect on error.

```typescript
tapErrorAsync(result: Result<T, E, C> | AsyncResult<T, E, C>, fn: (error: E) => Promise<void>): AsyncResult<T, E, C>
```

### race

Race async results - first to complete wins.

Handles rejected promises by converting them to err() results
with type PROMISE_REJECTED.

```typescript
race(results: AsyncResult<T, E, C>[]): AsyncResult<T, PromiseRejectedError | E, PromiseRejectionCause | C>
```

### traverse

Sequence an array through a Result-returning function.
Stops on first error.

```typescript
traverse(items: T[], fn: (item: T, index: number) => Result<U, E, C>): Result<U[], E, C>
```

### traverseAsync

Async version of traverse.

```typescript
traverseAsync(items: T[], fn: (item: T, index: number) => AsyncResult<U, E, C>): AsyncResult<U[], E, C>
```

### traverseParallel

Parallel traverse - executes all in parallel, fails fast.

Returns immediately when any result fails, without waiting for
pending operations. Only returns all values if every result succeeds.

```typescript
traverseParallel(items: T[], fn: (item: T, index: number) => AsyncResult<U, E, C>): AsyncResult<U[], PromiseRejectedError | E, PromiseRejectionCause | C>
```

## Options reference

Single place for all workflow and step option keys (for docs and static analysis).

**Workflow** — The value returned by `createWorkflow` has a single method: **`workflow.run(name?, fn, config?)`**. Overloads: `run(fn)`, `run(fn, config)`, `run(name, fn)`, `run(name, fn, config)`. Options below can be passed at **creation** (`createWorkflow('name', deps, options)`) or per-run in **RunConfig** (`workflow.run(fn, config)`).

| Option | Type | Purpose |
|--------|------|---------|
| `description` | `string?` | Short description for labels/tooltips and doc generation |
| `markdown` | `string?` | Full markdown documentation for static analysis and docs |
| `strict` | `boolean?` | Closed error union |
| `catchUnexpected` | `function?` | Map unexpected errors to typed union |
| `onEvent` | `function?` | Event stream callback |
| `createContext` | `function?` | Custom context factory |
| `cache` | `StepCache?` | Step caching backend (creation-time only) |
| `resumeState` | `ResumeState?` | Resume from saved state |
| `deps` | `Partial<Deps>?` | Per-run override of creation-time deps (RunConfig only) |
| `signal` | `AbortSignal?` | Workflow cancellation |
| `streamStore` | `StreamStore?` | Streaming backend |
| `snapshot` | `WorkflowSnapshot?` | Restore from saved snapshot (RunConfig or creation) |
| `onUnknownSteps` | `'warn' | 'error' | 'ignore'?` | When snapshot has steps not in this run |
| `onDefinitionChange` | `'warn' | 'error' | 'ignore'?` | When snapshot definition hash differs |

**Persistence:** Use `createResumeStateCollector()`, pass `collector.handleEvent` to `onEvent`, then call `collector.getResumeState()` after a run to persist. Restore with `workflow.run(fn, { resumeState })` or creation-time `resumeState` (or `snapshot` where supported).

**Step (step, step.sleep, step.retry, step.withTimeout)** — in options object:

| Option | Type | Purpose |
|--------|------|---------|
| `name` | `string?` | Human-readable step name for tracing |
| `key` | `string?` | Cache key for resume/caching |
| `description` | `string?` | Short description for docs and static analysis |
| `markdown` | `string?` | Full markdown for step documentation |
| `ttl` | `number?` | Cache TTL (step.sleep and cached steps) |
| `retry` | `object?` | Retry config (step.retry) |
| `timeout` | `object?` | Timeout config (step.withTimeout) |
| `signal` | `AbortSignal?` | Step cancellation (e.g. step.sleep) |

**Saga step (saga.step / saga.tryStep)** — first argument is the step name (string). Optional third argument is an options object:

| Option | Type | Purpose |
|--------|------|---------|
| `description` | `string?` | Short description for docs and static analysis |
| `markdown` | `string?` | Full markdown for step documentation |
| `compensate` | `function?` | Compensation function on rollback |
