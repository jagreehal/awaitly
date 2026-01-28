---
title: API Reference
description: Complete API documentation
---

## Workflows

### createWorkflow

```typescript
createWorkflow(deps)                                    // Auto-inferred error types
createWorkflow(deps, { strict: true, catchUnexpected }) // Closed error union
createWorkflow(deps, { onEvent, createContext })        // Event stream + context
createWorkflow(deps, { cache })                         // Step caching
createWorkflow(deps, { resumeState })                   // Resume from saved state
createWorkflow(deps, { signal })                        // Workflow cancellation

// Callback signatures:
workflow(async (step, deps, ctx) => { ... })           // ctx is WorkflowContext
workflow(args, async (step, deps, args, ctx) => { ... }) // With typed args
```

### step

```typescript
step(result)                        // Unwrap Result or exit early
step(result, { name, key })         // With tracing/caching options
step(() => result)                  // Lazy form (for caching/resume)
step(() => result, { name, key })   // Lazy with options
```

### step.try

```typescript
step.try(fn, { error })             // Static error type
step.try(fn, { onError })           // Dynamic error from caught value
step.try(fn, { error, name, key })  // With tracing options
```

### step.sleep

```typescript
step.sleep(duration, options?)       // Pause execution for duration
// duration: string ("5s", "100ms") | Duration object
// options: { name?, key?, ttl?, description?, signal? }
```

### Low-level run

```typescript
run(fn)                             // One-off workflow
run(fn, { onError })                // With error callback
run(fn, { onEvent, context })       // With event stream
run.strict(fn, { catchUnexpected }) // Closed error union
```

## Results

### Constructors

```typescript
ok(value)                           // Create success
err(error)                          // Create error
err(error, { cause })               // Create error with cause
```

### Type guards

```typescript
isOk(result)                        // result is { ok: true, value }
isErr(result)                       // result is { ok: false, error }
isUnexpectedError(error)            // error is UnexpectedError
isWorkflowCancelled(error)          // error is WorkflowCancelledError
```

## Unwrap

```typescript
unwrap(result)                      // Value or throw UnwrapError
unwrapOr(result, defaultValue)      // Value or default
unwrapOrElse(result, fn)            // Value or compute from error
```

## Wrap

```typescript
from(fn)                            // Sync throwing → Result
from(fn, onError)                   // With error mapper
fromPromise(promise)                // Promise → Result
fromPromise(promise, onError)       // With error mapper
tryAsync(fn)                        // Async fn → Result
tryAsync(fn, onError)               // With error mapper
fromNullable(value, onNull)         // Nullable → Result
```

## Transform

```typescript
map(result, fn)                     // Transform value
mapError(result, fn)                // Transform error
mapTry(result, fn, onError)         // Transform value, catch throws
mapErrorTry(result, fn, onError)    // Transform error, catch throws
andThen(result, fn)                 // Chain (flatMap)
match(result, { ok, err })          // Pattern match
tap(result, fn)                     // Side effect on success
tapError(result, fn)                // Side effect on error
```

## Function Composition

### bindDeps

Partial application utility for the `fn(args, deps)` pattern. Transforms a function from `fn(args, deps) => out` into a curried form: `(deps) => (args) => out`.

Use at composition boundaries to bind dependencies once, then call with arguments. Keep core implementations in the explicit `fn(args, deps)` form for testing.

```typescript
import { bindDeps } from 'awaitly/bind-deps';

// Core function: explicit fn(args, deps) for testing
const notify = (args: { name: string }, deps: { send: SendFn }) =>
  deps.send(args.name);

// At composition boundary: bind deps once
const notifySlack = bindDeps(notify)(slackDeps);
const notifyEmail = bindDeps(notify)(emailDeps);

// Call sites are clean
await notifySlack({ name: 'Alice' });
await notifyEmail({ name: 'Bob' });
```

**Type inference**: All types (Args, Deps, Out) are preserved and inferred automatically.

**Works with**:
- Sync functions returning primitives or objects
- Async functions returning promises
- Functions returning `Result<T, E>` or `AsyncResult<T, E>`
- Complex object types for both args and deps

### pipe

Left-to-right function composition. Pipe a value through a series of functions.

```typescript
import { pipe } from 'awaitly/functional';

pipe(value, fn1, fn2, fn3)           // Transform value through functions
pipe(result, R.map(fn), R.flatMap(fn)) // With Result combinators
```

### flow

Compose functions left-to-right, returning a new function.

```typescript
import { flow } from 'awaitly/functional';

flow(fn1, fn2, fn3)                  // Returns composed function
const transform = flow(double, addOne);
```

### compose

Compose functions right-to-left (opposite of flow).

```typescript
import { compose } from 'awaitly/functional';

compose(fn1, fn2, fn3)                // Returns composed function (right-to-left)
```

### identity

Identity function - returns its argument unchanged.

```typescript
import { identity } from 'awaitly/functional';

identity(value)                       // Returns value unchanged
```

### Result Combinators (Sync)

```typescript
import { map, flatMap, bimap, mapError, tap, tapError, match, recover, recoverWith, getOrElse, getOrElseLazy } from 'awaitly/functional';

map(result, fn)                      // Transform success value
flatMap(result, fn)                  // Transform and flatten (chain)
bimap(result, onOk, onErr)           // Transform both value and error
mapError(result, fn)                 // Transform error value
tap(result, fn)                      // Side effect on success
tapError(result, fn)                 // Side effect on error
match(result, { ok, err })           // Pattern match
recover(result, fn)                  // Recover with fallback value
recoverWith(result, fn)              // Recover with Result
getOrElse(result, defaultValue)      // Get value or default
getOrElseLazy(result, fn)            // Get value or compute default lazily
```

### Result Combinators (Async)

```typescript
import { mapAsync, flatMapAsync, tapAsync, tapErrorAsync } from 'awaitly/functional';

mapAsync(result, fn)                  // Transform success value asynchronously
flatMapAsync(result, fn)              // Async flatMap
tapAsync(result, fn)                  // Async side effect on success
tapErrorAsync(result, fn)            // Async side effect on error
```

### Collection Utilities

```typescript
import { all, allAsync, allSettled, allSettledAsync, any, anyAsync, race, traverse, traverseAsync, traverseParallel } from 'awaitly/functional';

all(results)                         // All succeed (sync, short-circuits)
allAsync(results)                    // All succeed (async, parallel, fails fast)
allSettled(results)                  // Collect all (sync, separates ok/err)
allSettledAsync(results)             // Collect all (async, separates ok/err)
any(results)                         // First success (sync)
anyAsync(results)                    // First success (async, returns immediately)
race(results)                        // First to complete wins
traverse(items, fn)                  // Sequence through function (stops on error)
traverseAsync(items, fn)             // Async sequence
traverseParallel(items, fn)          // Parallel execution, fails fast
```

### R namespace (Pipeable)

Curried Result combinators for use in `pipe()`.

```typescript
import { R } from 'awaitly/functional';

R.map(fn)                            // Curried map
R.flatMap(fn)                        // Curried flatMap
R.bimap(onOk, onErr)                 // Curried bimap
R.mapError(fn)                       // Curried mapError
R.tap(fn)                            // Curried tap
R.tapError(fn)                       // Curried tapError
R.match({ ok, err })                 // Curried match
R.recover(fn)                        // Curried recover
R.recoverWith(fn)                    // Curried recoverWith
R.getOrElse(defaultValue)            // Curried getOrElse
R.getOrElseLazy(fn)                  // Curried getOrElseLazy
```

## Batch Operations

```typescript
all(results)                        // All succeed (sync, short-circuits)
allAsync(results)                   // All succeed (async, short-circuits)
any(results)                        // First success (sync)
anyAsync(results)                   // First success (async)
allSettled(results)                 // Collect all errors (sync)
allSettledAsync(results)            // Collect all errors (async)
partition(results)                  // Split into { values, errors }
zip(a, b)                           // Combine two Results into tuple
zipAsync(a, b)                      // Combine two async Results into tuple
```

## Batch Processing

```typescript
processInBatches(items, fn, config)         // Process with bounded concurrency
processInBatches(items, fn, config, hooks)  // With progress/checkpoint hooks

// Config
{ batchSize: 20, concurrency: 3, batchDelayMs: 50 }

// Hooks
{ onProgress: (p) => {}, afterBatch: async () => ok(undefined) }

// Presets
batchPresets.conservative  // batchSize: 20, concurrency: 3
batchPresets.balanced      // batchSize: 50, concurrency: 5
batchPresets.aggressive    // batchSize: 100, concurrency: 10
```

## Resource Management

```typescript
withScope(async (scope) => { ... }) // RAII-style resource cleanup
createResource(acquire, release)    // Create reusable resource
createResourceScope()               // Manual scope control
isResourceCleanupError(error)       // Check for cleanup failure
```

## Human-in-the-Loop (HITL)

### Creating approval steps

```typescript
createApprovalStep<T>(options)      // Create approval-gated step function
// options: { key, checkApproval, pendingReason?, rejectedReason? }
```

### Checking approval status

```typescript
isPendingApproval(error)            // error is PendingApproval
isApprovalRejected(error)           // error is ApprovalRejected
pendingApproval(stepKey, options?)  // Create PendingApproval error
```

### Managing approval state

```typescript
createApprovalStateCollector()      // Collect full resume state + pending approvals
injectApproval(state, { stepKey, value })  // Add approval to resume state
clearStep(state, stepKey)           // Remove step from resume state (immutable)
hasPendingApproval(state, stepKey)  // Check if step is pending
getPendingApprovals(state)          // Get all pending step keys
```

## Circuit Breaker

```typescript
createCircuitBreaker(name, config)  // Create circuit breaker instance
isCircuitOpenError(error)           // Check if error is circuit open
circuitBreakerPresets.critical      // Preset configurations
circuitBreakerPresets.lenient
```

## Saga / Compensation

```typescript
createSagaWorkflow(deps, options)   // Create saga with auto-inferred errors
runSaga(fn, options)                // Low-level saga execution
isSagaCompensationError(error)      // Check for compensation failure
```

## Rate Limiting

```typescript
createRateLimiter(name, config)     // Token bucket rate limiter
createConcurrencyLimiter(name, cfg) // Concurrent execution limiter
createCombinedLimiter(name, config) // Rate + concurrency combined
rateLimiterPresets.api              // Preset configurations
isRateLimitExceededError(error)     // Check if rate limited
isQueueFullError(error)             // Check if queue full
```

## Singleflight (Request Coalescing)

```typescript
singleflight(operation, options)    // Wrap function with deduplication
createSingleflightGroup()           // Low-level group API

// Options
{ key: (...args) => string, ttl?: number }

// Group methods
group.execute(key, operation)       // Execute or join in-flight request
group.isInflight(key)               // Check if request is pending
group.size()                        // Get number of in-flight requests
group.clear()                       // Clear tracking
```

## Conditional Execution

```typescript
when(condition, operation, opts)           // Run if true
unless(condition, operation, opts)         // Run if false
whenOr(cond, op, default, opts)            // Run if true, else default
unlessOr(cond, op, default, opts)          // Run if false, else default
createConditionalHelpers(ctx)              // Factory for bound helpers
```

## Webhook / Event Triggers

```typescript
createWebhookHandler(workflow, fn, config) // Create HTTP handler
createSimpleHandler(config)                // Simple endpoint handler
createEventHandler(workflow, fn, config)   // Queue event handler
createResultMapper(mappings, options)      // Map errors to HTTP codes
createExpressHandler(handler)              // Express middleware
validationError(message, field, details)   // Create validation error
requireFields(fields)                      // Field validator
```

## Policy Middleware

```typescript
mergePolicies(...policies)          // Combine policies
createPolicyApplier(...policies)    // Create policy applier
withPolicy(policy, options)         // Apply single policy
withPolicies(policies, name)        // Apply multiple policies
createPolicyRegistry()              // Create policy registry
stepOptions()                       // Fluent builder
retryPolicies.standard              // Retry presets
timeoutPolicies.api                 // Timeout presets
servicePolicies.httpApi             // Combined presets
```

## Streaming

### Setup

```typescript
import { createWorkflow } from 'awaitly/workflow';
import { createMemoryStreamStore, createFileStreamStore } from 'awaitly/streaming';

createMemoryStreamStore()                    // In-memory store
createFileStreamStore({ directory, fs })     // File-based store
createWorkflow(deps, { streamStore })        // Enable streaming
```

### Step methods

```typescript
step.getWritable<T>(options?)       // Create stream writer
step.getReadable<T>(options?)       // Create stream reader
step.streamForEach(source, fn, opts) // Batch process stream

// Options
{ namespace?: string, highWaterMark?: number }  // Writer options
{ namespace?: string, startIndex?: number }     // Reader options
{ name?, checkpointInterval?, concurrency? }    // streamForEach options
```

### StreamWriter

```typescript
writer.write(value)                 // Write item → AsyncResult<void, StreamWriteError>
writer.close()                      // Close stream → AsyncResult<void, StreamCloseError>
writer.abort(reason)                // Abort with error
writer.writable                     // Whether writable
writer.position                     // Items written
writer.namespace                    // Stream namespace
```

### StreamReader

```typescript
reader.read()                       // Read next → AsyncResult<T, StreamReadError | StreamEndedMarker>
reader.close()                      // Stop reading
reader.readable                     // Whether more data may exist
reader.position                     // Current position
reader.namespace                    // Stream namespace
```

### External access

```typescript
import { getStreamReader } from 'awaitly/streaming';

getStreamReader<T>({                // Create reader outside workflow
  store,
  workflowId,
  namespace?,
  startIndex?,
  pollInterval?,
  pollTimeout?,
})
```

### Transformers

```typescript
import { toAsyncIterable, map, filter, chunk, ... } from 'awaitly/streaming';

toAsyncIterable(reader)             // Convert to for-await-of
map(source, fn)                     // Transform items
mapAsync(source, fn)                // Async transform
filter(source, predicate)           // Filter items
flatMap(source, fn)                 // Transform to multiple
flatMapAsync(source, fn)            // Async flatMap
chunk(source, size)                 // Batch into arrays
take(source, count)                 // Limit items
skip(source, count)                 // Skip items
takeWhile(source, predicate)        // Take while true
skipWhile(source, predicate)        // Skip while true
collect(source)                     // Collect to array
reduce(source, fn, initial)         // Fold to single value
pipe(source, ...transforms)         // Compose transforms (up to 4 typed)
```

### Type guards

```typescript
isStreamEnded(error)                // error is StreamEndedMarker
isStreamWriteError(error)           // error is StreamWriteError
isStreamReadError(error)            // error is StreamReadError
isStreamStoreError(error)           // error is StreamStoreError
isStreamBackpressureError(error)    // error is StreamBackpressureError
```

## Persistence

```typescript
createMemoryCache(options)          // In-memory cache
createFileCache(options)            // File-based cache
createKVCache(options)              // Key-value store cache
createStatePersistence(store, prefix)      // State persistence
createHydratingCache(memory, persist, id)  // Hydrating cache
stringifyState(state, meta)         // JSON stringify
parseState(json)                    // JSON parse
createResumeStateCollector()        // Collect step events for resume state
```

## Versioning

```typescript
migrateState(state, target, migrations)    // Apply migrations
createVersionedStateLoader(config)         // Create loader with migrations
createVersionedState(state, version)       // Wrap state with version
parseVersionedState(json)                  // Parse from JSON
stringifyVersionedState(state)             // Serialize to JSON
createKeyRenameMigration(renames)          // Migration helper
createKeyRemoveMigration(keys)             // Migration helper
createValueTransformMigration(transforms)  // Migration helper
composeMigrations(migrations)              // Combine migrations
```

## Devtools

```typescript
createDevtools(options)             // Create devtools instance
createVisualizer(options)           // Create visualizer
renderDiff(diff)                    // Render run diff
quickVisualize(events)              // Quick visualization
createConsoleLogger(options)        // Console event logger
```

## Testing

```typescript
createWorkflowHarness(deps, options)       // Create test harness
createMockFn<T, E>()                       // Create mock function
createTestClock(startTime)                 // Deterministic clock
createSnapshot(invocations, result)        // Create snapshot
compareSnapshots(snapshot1, snapshot2)     // Compare snapshots
okOutcome(value)                           // Helper for ok outcome
errOutcome(error)                          // Helper for err outcome
```

## OpenTelemetry (Autotel)

```typescript
createAutotelAdapter(config)        // Create metrics adapter
createAutotelEventHandler(options)  // Event handler for debug
withAutotelTracing(trace, options)  // Wrap with tracing
```

## Static Analysis

```typescript
analyzeWorkflow(filePath)           // Analyze workflow file
analyzeWorkflowSource(source)       // Analyze source string
loadTreeSitter()                    // Pre-load tree-sitter WASM
clearTreeSitterCache()              // Clear WASM cache
getWasmCachePath()                  // Get WASM cache location

// Type guards
isStaticStepNode(node)              // node is StaticStepNode
isStaticSequenceNode(node)          // node is StaticSequenceNode
isStaticParallelNode(node)          // node is StaticParallelNode
isStaticRaceNode(node)              // node is StaticRaceNode
isStaticConditionalNode(node)       // node is StaticConditionalNode
isStaticLoopNode(node)              // node is StaticLoopNode
isStaticWorkflowRefNode(node)       // node is StaticWorkflowRefNode
hasStaticChildren(node)             // node has children
getStaticChildren(node)             // Get children array
```

## Types

### Core Result types

```typescript
Result<T, E, C>                     // { ok: true, value: T } | { ok: false, error: E, cause?: C }
AsyncResult<T, E, C>                // Promise<Result<T, E, C>>
UnexpectedError                     // { type: 'UNEXPECTED_ERROR', cause: unknown }
```

### Workflow types

```typescript
Workflow<E, Deps, C>                // Non-strict workflow return type
WorkflowStrict<E, U, Deps, C>       // Strict workflow return type
WorkflowOptions<E, C>               // Options for createWorkflow
WorkflowContext<C>                  // Context: { workflowId, onEvent?, context?, signal? }
StepOptions                         // { name?: string, key?: string }
WorkflowEvent<E, C>                 // Union of all event types
WorkflowCancelledError              // { type: 'WORKFLOW_CANCELLED', reason?, lastStepKey? }
```

### Type extraction utilities

```typescript
ErrorOf<Fn>                         // Extract error type from function
CauseOf<Fn>                         // Extract cause type from function
Errors<[Fn1, Fn2, ...]>             // Union of error types from functions
ErrorsOfDeps<Deps>                  // Extract errors from deps object
ExtractValue<Result>                // Extract value type from Result
ExtractError<Result>                // Extract error type from Result
```

### Cache & Resume types

```typescript
StepCache                           // Cache interface (get/set/has/delete/clear)
ResumeState                         // { steps: Map<string, ResumeStateEntry> }
ResumeStateEntry                    // { result: Result, meta?: StepFailureMeta }
```

### HITL types

```typescript
PendingApproval                     // { type: 'PENDING_APPROVAL', stepKey, reason? }
ApprovalRejected                    // { type: 'APPROVAL_REJECTED', stepKey, reason? }
ApprovalStore                       // Approval storage interface
WorkflowStateStore                  // State storage interface
```

### Circuit Breaker types

```typescript
CircuitState                        // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
CircuitBreakerConfig                // Configuration options
CircuitBreakerStats                 // Runtime statistics
CircuitOpenError                    // Error when circuit is open
```

### Saga types

```typescript
SagaContext<E>                      // Context with step() and tryStep()
SagaStepOptions<T>                  // Step options with compensate
SagaCompensationError               // Error with compensation details
```

### Rate Limiter types

```typescript
RateLimiterConfig                   // Rate limiter configuration
ConcurrencyLimiterConfig            // Concurrency limiter config
RateLimitExceededError              // Error when rate exceeded
QueueFullError                      // Error when queue full
```

### Resource types

```typescript
Resource<T>                         // Resource with value and release
ResourceScope                       // Scope for tracking resources
ResourceCleanupError                // Error during cleanup
```

### Testing types

```typescript
WorkflowHarness<E, Deps>            // Test harness interface
MockFunction<T, E>                  // Mock function interface
ScriptedOutcome<T, E>               // Scripted step outcome
WorkflowSnapshot                    // Snapshot for comparison
```

### Streaming types

```typescript
StreamWriter<T>                     // Writable stream interface
StreamReader<T>                     // Readable stream interface
StreamStore                         // Storage backend interface
StreamItem<T>                       // Item with value, position, timestamp
StreamMetadata                      // Stream info (length, closed, timestamps)
StreamOptions                       // Writer options (namespace, highWaterMark)
StreamReadOptions                   // Reader options (namespace, startIndex)
StreamForEachOptions                // Batch processing options
StreamForEachResult<R>              // Batch processing result
StreamWriteError                    // Write failure error
StreamReadError                     // Read failure error
StreamCloseError                    // Close failure error
StreamStoreError                    // Storage error
StreamEndedMarker                   // End of stream marker
StreamBackpressureError             // Backpressure error
BackpressureController              // Backpressure control interface
```

### Static Analysis types

```typescript
StaticWorkflowIR                    // Analysis result
StaticWorkflowNode                  // Workflow root node
StaticFlowNode                      // Union of all node types
StaticStepNode                      // Step call node
StaticSequenceNode                  // Sequential execution
StaticParallelNode                  // Parallel execution
StaticRaceNode                      // Race execution
StaticConditionalNode               // if/else or conditional helpers
StaticLoopNode                      // Loop (for/while)
StaticWorkflowRefNode               // Reference to another workflow
StaticUnknownNode                   // Unanalyzable code
AnalysisWarning                     // Analysis warning
AnalysisStats                       // Step/conditional/parallel counts
AnalyzerOptions                     // Analyzer configuration
```

## Export Index (Complete)

This section is a mechanically-complete index of all public exports (grouped by entrypoint).
It exists to ensure the reference stays exhaustive even as the API grows.

```text
[awaitly] (118)
- Duration
- DurationType
- PROMISE_REJECTED
- STEP_TIMEOUT_MARKER
- TaggedError
- UNEXPECTED_ERROR
- UnwrapError
- all
- allAsync
- allSettled
- allSettledAsync
- andThen
- any
- anyAsync
- bimap
- createResumeStateCollector
- createWorkflow
- days
- err
- from
- fromNullable
- fromPromise
- getStepTimeoutMeta
- hours
- hydrate
- isDuration
- isErr
- isOk
- isPromiseRejectedError
- isSerializedResult
- isStepComplete
- isStepTimeoutError
- isUnexpectedError
- isWorkflowCancelled
- map
- mapError
- mapErrorTry
- mapTry
- match
- matchError
- millis
- minutes
- ok
- orElse
- orElseAsync
- partition
- pendingApproval
- recover
- recoverAsync
- run
- seconds
- tap
- tapError
- toDays
- toHours
- toMillis
- toMinutes
- toSeconds
- tryAsync
- type AnyResultFn
- type AsyncResult
- type BackoffStrategy
- type CauseOf
- type CausesOfDeps
- type EmptyInputError
- type Err
- type ErrorByTag
- type ErrorOf
- type Errors
- type ErrorsOfDeps
- type ExecutionOptions
- type ExecutionOptionsStrict
- type ExtractCause
- type ExtractError
- type ExtractValue
- type MatchErrorHandlers
- type MaybeAsyncResult
- type Ok
- type PromiseRejectedError
- type PromiseRejectionCause
- type PropsOf
- type Result
- type ResumeState
- type ResumeStateEntry
- type RetryOptions
- type RunOptions
- type RunOptionsWithCatch
- type RunOptionsWithoutCatch
- type RunStep
- type ScopeType
- type SettledError
- type StepCache
- type StepOptions
- type StepTimeoutError
- type StepTimeoutMarkerMeta
- type TagOf
- type TaggedErrorBase
- type TaggedErrorConstructor
- type TaggedErrorCreateOptions
- type TaggedErrorOptions
- type TimeoutOptions
- type UnexpectedCause
- type UnexpectedError
- type UnexpectedStepFailureCause
- type Workflow
- type WorkflowCancelledError
- type WorkflowContext
- type WorkflowEvent
- type WorkflowFn
- type WorkflowFnWithArgs
- type WorkflowOptions
- type WorkflowOptionsStrict
- type WorkflowStrict
- unwrap
- unwrapOr
- unwrapOrElse
- zip
- zipAsync

[awaitly/adapters] (10)
- fromCallback
- fromEvent
- isEventEmitterLike
- isEventTimeoutError
- isInvalidEmitterError
- type EventConfig
- type EventEmitterLike
- type EventTimeoutError
- type InvalidEmitterError
- type NodeCallback

[awaitly/batch] (8)
- BatchConfig
- BatchOptions
- BatchProcessingError
- BatchProgress
- InvalidBatchConfigError
- batchPresets
- isBatchProcessingError
- isInvalidBatchConfigError

[awaitly/bind-deps] (1)
- bindDeps

[awaitly/cache] (14)
- cached
- cachedFunction
- cachedWithTTL
- createCache
- createCache
- once
- type Cache
- type CacheConfig
- type CacheEntry
- type CacheOptions
- type CacheStats
- type CachedFunctionOptions
- type DurationInput
- type MemoizedFunction
- type OnceFunction

[awaitly/circuit-breaker] (8)
- CircuitOpenError
- circuitBreakerPresets
- createCircuitBreaker
- isCircuitOpenError
- type CircuitBreaker
- type CircuitBreakerConfig
- type CircuitBreakerStats
- type CircuitState

[awaitly/conditional] (7)
- createConditionalHelpers
- type ConditionalContext
- type ConditionalOptions
- unless
- unlessOr
- when
- whenOr

[awaitly/core] (74)
- Match
- TaggedError
- UnwrapError
- all
- allAsync
- allSettled
- allSettledAsync
- andThen
- any
- anyAsync
- bimap
- err
- exhaustive
- from
- fromNullable
- fromPromise
- hydrate
- isErr
- isOk
- isOneOf
- isSerializedResult
- isTag
- isUnexpectedError
- map
- mapError
- mapErrorTry
- mapTry
- match
- matchError
- matchOrElse
- matchTag
- matchTags
- matchValue
- ok
- orElse
- orElseAsync
- orElseValue
- partition
- recover
- recoverAsync
- tap
- tapError
- tryAsync
- type AsyncResult
- type CauseOf
- type EmptyInputError
- type Err
- type ErrorByTag
- type ErrorOf
- type Errors
- type ExtractCause
- type ExtractError
- type ExtractValue
- type MatchErrorHandlers
- type Matcher
- type MaybeAsyncResult
- type Ok
- type PromiseRejectedError
- type PromiseRejectionCause
- type PropsOf
- type Result
- type SettledError
- type TagOf
- type Tagged
- type TaggedErrorBase
- type TaggedErrorConstructor
- type TaggedErrorCreateOptions
- type TaggedErrorOptions
- type UnexpectedCause
- type UnexpectedError
- type UnexpectedStepFailureCause
- unwrap
- unwrapOr
- unwrapOrElse

[awaitly/devtools] (10)
- createConsoleLogger
- createDevtools
- quickVisualize
- renderDiff
- type Devtools
- type DevtoolsOptions
- type RunDiff
- type StepDiff
- type TimelineEntry
- type WorkflowRun

[awaitly/durable] (17)
- createFileStatePersistence
- createMemoryStatePersistence
- durable
- isConcurrentExecution
- isPersistenceError
- isVersionMismatch
- isWorkflowCancelled
- type ConcurrentExecutionError
- type DurableOptions
- type DurableWorkflowEvent
- type FileStatePersistenceOptions
- type FileSystemInterface
- type MemoryStatePersistenceOptions
- type PersistenceError
- type StatePersistence
- type VersionMismatchError
- type WorkflowCancelledError

[awaitly/duration] (32)
- Duration
- DurationType
- add
- clamp
- days
- divide
- equals
- format
- greaterThan
- greaterThanOrEqual
- hours
- infinity
- isDuration
- isFinite
- isInfinite
- isZero
- lessThan
- lessThanOrEqual
- max
- millis
- min
- minutes
- multiply
- parse
- seconds
- subtract
- toDays
- toHours
- toMillis
- toMinutes
- toSeconds
- zero

[awaitly/errors] (21)
- CircuitBreakerOpenError
- CompensationError
- NetworkError
- NotFoundError
- RateLimitError
- RetryExhaustedError
- TimeoutError
- UnauthorizedError
- ValidationError
- isAwaitlyError
- isCircuitBreakerOpenError
- isCompensationError
- isNetworkError
- isNotFoundError
- isRateLimitError
- isRetryExhaustedError
- isTimeoutError
- isUnauthorizedError
- isValidationError
- makeError
- type AwaitlyError

[awaitly/fetch] (7)
- fetchArrayBuffer
- fetchBlob
- fetchJson
- fetchText
- type DefaultFetchError
- type FetchErrorMapper
- type FetchOptions

[awaitly/hitl] (33)
- clearStep
- createApprovalChecker
- createApprovalStateCollector
- createApprovalStep
- createApprovalWebhookHandler
- createHITLOrchestrator
- createMemoryApprovalStore
- createMemoryWorkflowStateStore
- gatedStep
- getPendingApprovals
- hasPendingApproval
- injectApproval
- isApprovalRejected
- isPendingApproval
- pendingApproval
- type ApprovalNeededContext
- type ApprovalRejected
- type ApprovalResolvedContext
- type ApprovalStatus
- type ApprovalStepOptions
- type ApprovalStore
- type ApprovalWebhookRequest
- type ApprovalWebhookResponse
- type GatedStepOptions
- type HITLExecutionResult
- type HITLOrchestrator
- type HITLOrchestratorOptions
- type HITLWorkflowFactoryOptions
- type NotificationChannel
- type PendingApproval
- type PollerOptions
- type SavedWorkflowState
- type WorkflowStateStore

[awaitly/match] (11)
- Match
- exhaustive
- isOneOf
- isTag
- matchOrElse
- matchTag
- matchTags
- matchValue
- orElseValue
- type Matcher
- type Tagged

[awaitly/otel] (7)
- createAutotelAdapter
- createAutotelEventHandler
- type AutotelAdapter
- type AutotelAdapterConfig
- type AutotelMetrics
- type AutotelTraceFn
- withAutotelTracing

[awaitly/persistence] (46)
- composeMigrations
- createFileCache
- createHydratingCache
- createKVCache
- createKeyRemoveMigration
- createKeyRenameMigration
- createMemoryCache
- createStatePersistence
- createValueTransformMigration
- createVersionedState
- createVersionedStateLoader
- deserializeCause
- deserializeEntry
- deserializeMeta
- deserializeResult
- deserializeState
- isMigrationError
- isVersionIncompatibleError
- migrateState
- parseState
- parseVersionedState
- serializeCause
- serializeEntry
- serializeMeta
- serializeResult
- serializeState
- stringifyState
- stringifyVersionedState
- type FileCacheOptions
- type FileSystemInterface
- type KVCacheOptions
- type KeyValueStore
- type MemoryCacheOptions
- type MigrationError
- type MigrationFn
- type Migrations
- type SerializedCause
- type SerializedEntry
- type SerializedMeta
- type SerializedResult
- type SerializedState
- type StatePersistence
- type Version
- type VersionIncompatibleError
- type VersionedState
- type VersionedWorkflowConfig

[awaitly/policies] (20)
- conditionalPolicy
- createPolicyApplier
- createPolicyBundle
- createPolicyRegistry
- envPolicy
- mergePolicies
- retryPolicies
- retryPolicy
- servicePolicies
- stepOptions
- timeoutPolicies
- timeoutPolicy
- type NamedPolicy
- type Policy
- type PolicyFactory
- type PolicyRegistry
- type StepOptionsBuilder
- type WithPoliciesOptions
- withPolicies
- withPolicy

[awaitly/ratelimit] (23)
- createCombinedLimiter
- createConcurrencyLimiter
- createCostBasedRateLimiter
- createFixedWindowLimiter
- createRateLimiter
- isQueueFullError
- isRateLimitExceededError
- rateLimiterPresets
- type CombinedLimiterConfig
- type ConcurrencyLimiter
- type ConcurrencyLimiterConfig
- type ConcurrencyLimiterStats
- type CostBasedRateLimiter
- type CostBasedRateLimiterConfig
- type CostBasedRateLimiterStats
- type FixedWindowLimiter
- type FixedWindowLimiterConfig
- type FixedWindowLimiterStats
- type QueueFullError
- type RateLimitExceededError
- type RateLimiter
- type RateLimiterConfig
- type RateLimiterStats

[awaitly/reliability] (61)
- CircuitOpenError
- circuitBreakerPresets
- conditionalPolicy
- createCircuitBreaker
- createCombinedLimiter
- createConcurrencyLimiter
- createCostBasedRateLimiter
- createFixedWindowLimiter
- createPolicyApplier
- createPolicyBundle
- createPolicyRegistry
- createRateLimiter
- createSagaWorkflow
- envPolicy
- isCircuitOpenError
- isQueueFullError
- isRateLimitExceededError
- isSagaCompensationError
- mergePolicies
- rateLimiterPresets
- retryPolicies
- retryPolicy
- runSaga
- servicePolicies
- stepOptions
- timeoutPolicies
- timeoutPolicy
- type CircuitBreaker
- type CircuitBreakerConfig
- type CircuitBreakerStats
- type CircuitState
- type CombinedLimiterConfig
- type CompensationAction
- type ConcurrencyLimiter
- type ConcurrencyLimiterConfig
- type ConcurrencyLimiterStats
- type CostBasedRateLimiter
- type CostBasedRateLimiterConfig
- type CostBasedRateLimiterStats
- type FixedWindowLimiter
- type FixedWindowLimiterConfig
- type FixedWindowLimiterStats
- type NamedPolicy
- type Policy
- type PolicyFactory
- type PolicyRegistry
- type QueueFullError
- type RateLimitExceededError
- type RateLimiter
- type RateLimiterConfig
- type RateLimiterStats
- type SagaCompensationError
- type SagaContext
- type SagaEvent
- type SagaResult
- type SagaStepOptions
- type SagaWorkflowOptions
- type StepOptionsBuilder
- type WithPoliciesOptions
- withPolicies
- withPolicy

[awaitly/resource] (5)
- Resource
- ResourceCleanupError
- ResourceScope
- createResourceScope
- isResourceCleanupError

[awaitly/retry] (44)
- Duration
- DurationType
- Schedule
- ScheduleDecision
- ScheduleState
- ScheduleType
- addDelay
- andThen
- days
- delays
- exponential
- fibonacci
- fixed
- forever
- hours
- intersect
- isDuration
- jittered
- linear
- map
- maxDelay
- millis
- minDelay
- minutes
- modifyDelay
- once
- recurs
- run
- seconds
- spaced
- stop
- tap
- toDays
- toHours
- toMillis
- toMinutes
- toSeconds
- union
- untilInput
- untilOutput
- upTo
- upToElapsed
- whileInput
- whileOutput

[awaitly/saga] (10)
- createSagaWorkflow
- isSagaCompensationError
- runSaga
- type CompensationAction
- type SagaCompensationError
- type SagaContext
- type SagaEvent
- type SagaResult
- type SagaStepOptions
- type SagaWorkflowOptions

[awaitly/singleflight] (3)
- createSingleflightGroup
- singleflight
- type SingleflightOptions

[awaitly/streaming] (66)
- AsyncTransformFn
- BackpressureCallback
- BackpressureController
- BackpressureOptions
- BackpressureState
- ExternalReaderOptions
- FileStreamStoreOptions
- FileSystemInterface
- FilterFn
- MemoryStreamStoreOptions
- STREAM_BACKPRESSURE_ERROR
- STREAM_CLOSE_ERROR
- STREAM_ENDED
- STREAM_READ_ERROR
- STREAM_STORE_ERROR
- STREAM_WRITE_ERROR
- StreamBackpressureError
- StreamCloseError
- StreamEndedMarker
- StreamError
- StreamForEachOptions
- StreamForEachResult
- StreamItem
- StreamMetadata
- StreamOptions
- StreamReadError
- StreamReadOptions
- StreamReader
- StreamStore
- StreamStoreError
- StreamWriteError
- StreamWriter
- TransformFn
- Unsubscribe
- chunk
- collect
- createBackpressureController
- createFileStreamStore
- createMemoryStreamStore
- createTestableMemoryStreamStore
- filter
- flatMap
- flatMapAsync
- getStreamReader
- isStreamBackpressureError
- isStreamEnded
- isStreamReadError
- isStreamStoreError
- isStreamWriteError
- map
- mapAsync
- pipe
- reduce
- shouldApplyBackpressure
- skip
- skipWhile
- streamBackpressureError
- streamCloseError
- streamEnded
- streamReadError
- streamStoreError
- streamWriteError
- take
- takeWhile
- toAsyncIterable
- type TestableMemoryStreamStore

[awaitly/tagged-error] (8)
- TaggedError
- type ErrorByTag
- type PropsOf
- type TagOf
- type TaggedErrorBase
- type TaggedErrorConstructor
- type TaggedErrorCreateOptions
- type TaggedErrorOptions

[awaitly/testing] (34)
- assertEventEmitted
- assertEventNotEmitted
- assertEventSequence
- compareSnapshots
- createMockFn
- createSagaHarness
- createSnapshot
- createTestClock
- createWorkflowHarness
- errOutcome
- expectErr
- expectOk
- formatEvent
- formatEvents
- formatResult
- okOutcome
- throwOutcome
- type AssertionResult
- type CompensationInvocation
- type EventAssertionOptions
- type MockFunction
- type MockSagaContext
- type MockStep
- type SagaHarness
- type SagaStepOptions
- type ScriptedOutcome
- type StepInvocation
- type TestHarnessOptions
- type WorkflowHarness
- type WorkflowSnapshot
- unwrapErr
- unwrapErrAsync
- unwrapOk
- unwrapOkAsync

[awaitly/visualize] (94)
- ActiveStepSnapshot
- BaseNode
- CollectableEvent
- ColorScheme
- DecisionBranch
- DecisionBranchEvent
- DecisionEndEvent
- DecisionEvent
- DecisionNode
- DecisionStartEvent
- EnhancedRenderOptions
- FlowNode
- FlowchartRenderOptions
- HTMLRenderOptions
- HTMLTheme
- HeatLevel
- HeatmapData
- HookExecution
- HookLog
- HookState
- IRSnapshot
- LayoutDirection
- LiveVisualizerOptions
- LoggerOutput
- LoggerRenderOptions
- MermaidRenderOptions
- NodePerformance
- OutputFormat
- ParallelNode
- RaceNode
- RenderOptions
- Renderer
- ScopeEndEvent
- ScopeEvent
- ScopeStartEvent
- ScopeType
- SequenceNode
- ServerMessage
- StepLog
- StepNode
- StepSkippedEvent
- StepState
- StreamNode
- TimeTravelState
- VisualizerOptions
- VisualizingWorkflowOptions
- WebVisualizerMessage
- WorkflowHooks
- WorkflowIR
- WorkflowNode
- WorkflowSummary
- WorkflowVisualizer
- asciiRenderer
- combineEventHandlers
- createDevServer
- createEventCollector
- createIRBuilder
- createLiveVisualizer
- createParallelDetector
- createPerformanceAnalyzer
- createTimeTravelController
- createVisualizer
- createVisualizingWorkflow
- defaultColorScheme
- detectParallelGroups
- flowchartRenderer
- getHeatLevel
- hasChildren
- htmlRenderer
- isDecisionNode
- isParallelNode
- isRaceNode
- isSequenceNode
- isStepNode
- isStreamNode
- loggerRenderer
- mermaidRenderer
- renderToHTML
- trackDecision
- trackIf
- trackSwitch
- type DecisionTracker
- type DevServer
- type DevServerOptions
- type IRBuilderOptions
- type IfTracker
- type LiveVisualizer
- type ParallelDetectorOptions
- type PerformanceAnalyzer
- type SwitchTracker
- type TimeTravelController
- type TimeTravelOptions
- type WorkflowRun
- visualizeEvents

[awaitly/webhook] (28)
- composeValidators
- createEventHandler
- createExpressHandler
- createResultMapper
- createSimpleHandler
- createWebhookHandler
- defaultUnexpectedErrorMapper
- defaultValidationErrorMapper
- isValidationError
- requireFields
- sendWebhookResponse
- toWebhookRequest
- type ErrorMapping
- type ErrorResponseBody
- type EventHandler
- type EventMessage
- type EventProcessingResult
- type EventTriggerConfig
- type ExpressLikeRequest
- type ExpressLikeResponse
- type SimpleHandlerConfig
- type ValidationError
- type ValidationResult
- type WebhookHandler
- type WebhookHandlerConfig
- type WebhookRequest
- type WebhookResponse
- validationError

[awaitly/workflow] (50)
- Duration
- DurationType
- STEP_TIMEOUT_MARKER
- UNEXPECTED_ERROR
- createResumeStateCollector
- createWorkflow
- days
- getStepTimeoutMeta
- hours
- isDuration
- isStepComplete
- isStepTimeoutError
- isWorkflowCancelled
- millis
- minutes
- run
- seconds
- toDays
- toHours
- toMillis
- toMinutes
- toSeconds
- type AnyResultFn
- type BackoffStrategy
- type CausesOfDeps
- type ErrorsOfDeps
- type ExecutionOptions
- type ExecutionOptionsStrict
- type ResumeState
- type ResumeStateEntry
- type RetryOptions
- type RunOptions
- type RunOptionsWithCatch
- type RunOptionsWithoutCatch
- type RunStep
- type ScopeType
- type StepCache
- type StepOptions
- type StepTimeoutError
- type StepTimeoutMarkerMeta
- type TimeoutOptions
- type Workflow
- type WorkflowCancelledError
- type WorkflowContext
- type WorkflowEvent
- type WorkflowFn
- type WorkflowFnWithArgs
- type WorkflowOptions
- type WorkflowOptionsStrict
- type WorkflowStrict

```

