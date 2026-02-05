---
title: API Reference
description: Complete API documentation (generated from TypeDoc)
---

This page is generated from the awaitly package JSDoc and TypeScript types. For workflow and step options, see [Options reference](#options-reference) below.

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

When to use: Prefer functional-style checks or array filtering over .

```typescript
isErr(r: Result<T, E, C>): (value: Err<E, C>) => boolean
```

### isOk

Checks if a Result is successful.

When to use: Prefer functional-style checks or array filtering over .

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

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
from(fn: () => T): Err<unknown, unknown> | Ok<T>
```

### fromNullable

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
fromNullable(value: T | unknown | undefined, onNull: () => E): Result<T, E>
```

### fromPromise

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
fromPromise(promise: Promise<T>): Promise<Err<unknown, unknown> | Ok<T>>
```

### tryAsync

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
tryAsync(fn: () => Promise<T>): AsyncResult<T, unknown>
```

## Transform

### andThen

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
andThen(r: Ok<T>, fn: (value: T) => Ok<U>): Ok<U>
```

### map

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
map(r: Ok<T>, fn: (value: T) => U): Ok<U>
```

### mapError

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
mapError(r: Result<T, E, C>, fn: (error: E, cause?: C) => F): Result<T, F, C>
```

### mapErrorTry

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
mapErrorTry(r: Result<T, E, C>, fn: (error: E) => F, onError: (thrown: unknown) => G): Result<T, F | G, unknown>
```

### mapTry

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
mapTry(r: Result<T, E, C>, fn: (value: T) => U, onError: (thrown: unknown) => F): Result<U, E | F, unknown>
```

### match

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
match(r: Ok<T>, handlers: unknown): R
```

### orElse

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
orElse(r: Result<T, E, C>, fn: (error: E, cause?: C) => Result<T, E2, C2>): Result<T, E2, C | C2>
```

### TaggedError.match

Exhaustively matches on a tagged error, requiring handlers for all variants.

TypeScript will error if any variant in the error union is not handled.

When to use: You want compile-time enforcement that every tagged variant is handled.

```typescript
match(error: E, handlers: H): HandlersReturnType<H>
```

### tap

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
tap(r: Result<T, E, C>, fn: (value: T) => void): Result<T, E, C>
```

### tapError

awaitly

Result types for typed error handling without exceptions.
Optimized for serverless with minimal bundle size.

## Quick Start



## Entry Points

**Core (this package):**
-  - Result types, transformers, tagged errors (minimal ~2KB)
-  - run() function with step orchestration

**Workflow Engine:**
-  - createWorkflow, Duration, state management
-  - Human-in-the-loop approval flows

**Reliability:**
-  - Composable retry/backoff strategies
-  - Circuit breaker pattern
-  - Rate limiting
-  - Saga compensation pattern

**Utilities:**
-  - Type-safe time durations
-  - Pattern matching
-  - State persistence
-  - Durable execution with automatic checkpointing

```typescript
tapError(r: Result<T, E, C>, fn: (error: E, cause?: C) => void): Result<T, E, C>
```

## Options reference

Single place for all workflow and step option keys (for docs and static analysis).

**Workflow (createWorkflow / createSagaWorkflow)** — in second argument or on deps object:

| Option | Type | Purpose |
|--------|------|---------|
| `description` | `string?` | Short description for labels/tooltips and doc generation |
| `markdown` | `string?` | Full markdown documentation for static analysis and docs |
| `strict` | `boolean?` | Closed error union |
| `catchUnexpected` | `function?` | Map unexpected errors to typed union |
| `onEvent` | `function?` | Event stream callback |
| `createContext` | `function?` | Custom context factory |
| `cache` | `StepCache?` | Step caching backend |
| `resumeState` | `ResumeState?` | Resume from saved state |
| `signal` | `AbortSignal?` | Workflow cancellation |
| `streamStore` | `StreamStore?` | Streaming backend |
| `snapshot` | `WorkflowSnapshot?` | Resume from saved snapshot |
| `onUnknownSteps` | `'warn' | 'error' | 'ignore'?` | When snapshot has steps not in this run |
| `onDefinitionChange` | `'warn' | 'error' | 'ignore'?` | When snapshot definition hash differs |

**getSnapshot()** — options object:

| Option | Type | Purpose |
|--------|------|---------|
| `include` | `'all' | 'completed' | 'failed'?` | Which steps to include. Default: 'all' |
| `metadata` | `Record<string, JSONValue>?` | Custom metadata to merge into snapshot |
| `limit` | `number?` | Max number of steps to include |
| `sinceStepId` | `string?` | Incremental: only include steps after this step ID |
| `strict` | `boolean?` | Override workflow strict mode for this snapshot |

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
