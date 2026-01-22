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
