---
title: API Reference
description: Complete API documentation (generated from TypeDoc)
---

This page is generated from the awaitly package JSDoc and TypeScript types. For workflow and step options, see [Options reference](#options-reference) below.

## Entry points

The package has exactly four entry points. All imports are **named imports** (tree-shake friendly); there is no namespace object:

```typescript
// The front door: Result primitives, run() + step engine, per-dep policies,
// TaggedError, pre-built errors, pattern matching, durations, reliability
import { ok, err, run, map, type AsyncResult } from 'awaitly';

// The size guarantee: Result primitives only (minifies under ~10KB)
import { ok, err, map, andThen, type AsyncResult } from 'awaitly/result';

// The production tier: createWorkflow, durable execution, persistence,
// human-in-the-loop, sagas, streaming, webhooks
import { createWorkflow } from 'awaitly/workflow';

// Test utilities
import { createWorkflowHarness } from 'awaitly/testing';
```

## Results

### Constructors

### err

```typescript
err(error: E, options?: unknown): Err<E, C>
```

### ok

```typescript
ok(): Ok<void>
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

```typescript
from(fn: () => T): Err<unknown, unknown> | Ok<T>
```

### fromNullable

```typescript
fromNullable(value: T | unknown | undefined, onNull: () => E): Result<T, E>
```

### fromPromise

```typescript
fromPromise(promise: Promise<T>): Promise<Err<unknown, unknown> | Ok<T>>
```

### tryAsync

```typescript
tryAsync(fn: () => Promise<T>): AsyncResult<T, unknown>
```

## Transform

### andThen

```typescript
andThen(r: Ok<T>, fn: (value: T) => Ok<U>): Ok<U>
```

### map

```typescript
map(r: Ok<T>, fn: (value: T) => U): Ok<U>
```

### mapError

```typescript
mapError(r: Result<T, E, C>, fn: (error: E, cause?: C) => F): Result<T, F, C>
```

### mapErrorTry

```typescript
mapErrorTry(r: Result<T, E, C>, fn: (error: E) => F, onError: (thrown: unknown) => G): Result<T, F | G, unknown>
```

### mapTry

```typescript
mapTry(r: Result<T, E, C>, fn: (value: T) => U, onError: (thrown: unknown) => F): Result<U, E | F, unknown>
```

### match

Exhaustively matches on a tagged error, requiring handlers for all variants.

TypeScript will error if any variant in the error union is not handled.

When to use: You want compile-time enforcement that every tagged variant is handled.

```typescript
match(handlers: unknown): (r: Result<T, E, C>) => R
```

### orElse

```typescript
orElse(r: Result<T, E, C>, fn: (error: E, cause?: C) => Result<T, E2, C2>): Result<T, E2, C | C2>
```

### recover

```typescript
recover(r: Result<T, E, C>, fn: (error: E, cause?: C) => T): Ok<T>
```

### recoverAsync

```typescript
recoverAsync(r: Result<T, E, C> | Promise<Result<T, E, C>>, fn: (error: E, cause?: C) => T | Promise<T>): Promise<Ok<T>>
```

### tap

```typescript
tap(r: Result<T, E, C>, fn: (value: T) => void): Result<T, E, C>
```

### tapError

```typescript
tapError(r: Result<T, E, C>, fn: (error: E, cause?: C) => void): Result<T, E, C>
```

## Policies

### fallback

Recover from a dependency's failure. The handler receives the failure
(the typed Result error, or  wrapping a throw) plus the
original arguments, and its result becomes the outcome. The base
function's errors are consumed; only the handler's errors remain in the
union —  has no typed errors at all.

```typescript
fallback(fn: F, onFailure: FB): (args: Parameters<F>) => AsyncResult<DepValueOfReturn<ReturnType<F>> | DepValueOfReturn<ReturnType<FB>>, ErrorOf<FB>>
```

### retry

Retry a dependency. The error union is unchanged: if all attempts fail,
the last failure propagates exactly as it would have without the policy
(typed err for Result functions, throw for plain functions).

```typescript
retry(fn: F, options: RetryPolicyOptions): PolicyFn<F, ErrorOf<F>>
```

### timeout

Bound a dependency's execution time. On timeout, resolves to
 — adding  to the error union. The
underlying operation is not cancelled (no AbortSignal is threaded);
its eventual result is discarded.

```typescript
timeout(fn: F, after: PolicyDelay): PolicyFn<F, TimeoutError | ErrorOf<F>>
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

**Compensation (`step` / `step.try` inside any workflow)** — pass `{ compensate }` on any step. If a later step or the user callback fails, every step that recorded a `compensate` runs in reverse:

| Option | Type | Purpose |
|--------|------|---------|
| `compensate` | `(value: T) => void \| Promise<void>` | Rollback action; receives the value the step returned |

When at least one compensation throws, the workflow result is a `SagaCompensationError` carrying the original error and per-step compensation failures.
