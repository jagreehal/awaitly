# API Reference

## Workflows

### createWorkflow

```typescript
createWorkflow(deps)                                    // Auto-inferred error types
createWorkflow(deps, { strict: true, catchUnexpected }) // Closed error union
createWorkflow(deps, { onEvent, createContext })        // Event stream + context (context auto-included in events)
createWorkflow(deps, { cache })                         // Step caching
createWorkflow(deps, { resumeState })                   // Resume from saved state

// Callback signatures:
workflow(async (step, deps, ctx) => { ... })           // ctx is always provided (WorkflowContext)
workflow(args, async (step, deps, args, ctx) => { ... }) // With typed args, ctx is always provided
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

### step.fromResult

```typescript
step.fromResult(fn, { error })      // Map any Result error to static type
step.fromResult(fn, { onError })    // Map Result error dynamically
```

### step.retry

```typescript
step.retry(fn, { attempts, backoff }) // Basic retry
step.retry(fn, { attempts, timeout }) // Retry with per-attempt timeout
```

### step.withTimeout

```typescript
step.withTimeout(fn, { ms })        // Simple timeout
step.withTimeout(fn, { ms, signal }) // With AbortSignal propagation
```

### step.parallel / step.race / step.allSettled

```typescript
step.parallel(name, () => ...)      // Parallel group with scope events
step.parallel({ key: fn }, opts)    // Named object form
step.race(name, () => ...)          // Race group with scope events
step.allSettled(name, () => ...)    // allSettled group with scope events
```

### Low-level run

```typescript
run(fn)                             // One-off workflow
run(fn, { onError })                // With error callback (receives context as 3rd param)
run(fn, { onEvent, context })       // With event stream (context auto-included in events)
run.strict(fn, { catchUnexpected }) // Closed error union
```

### Event helpers

```typescript
isStepComplete(event)               // Type guard for step_complete events
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

## Batch

```typescript
all(results)                        // All succeed (sync, short-circuits)
allAsync(results)                   // All succeed (async, short-circuits)
any(results)                        // First success (sync)
anyAsync(results)                   // First success (async)
allSettled(results)                 // Collect all; error array if any fail (sync)
allSettledAsync(results)            // Collect all; error array if any fail (async)
partition(results)                  // Split into { values, errors }
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
createHITLCollector()               // Collect step events for resume
injectApproval(state, { stepKey, value })  // Add approval to resume state
clearStep(state, stepKey)           // Remove step from resume state
hasPendingApproval(state, stepKey)  // Check if step is pending
getPendingApprovals(state)          // Get all pending step keys
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
Workflow<E, Deps, C>                // Non-strict workflow return type (C is context type)
WorkflowStrict<E, U, Deps, C>       // Strict workflow return type (C is context type)
WorkflowOptions<E, C>               // Options for createWorkflow
WorkflowOptionsStrict<E, U, C>      // Options for strict createWorkflow
WorkflowContext<C>                  // Context object passed to callbacks: { workflowId, onEvent?, context? }
AnyResultFn                         // Constraint for Result-returning functions
```

**WorkflowContext**: The third parameter (`ctx`) in workflow callbacks is always provided and contains:
- `workflowId`: Unique ID for this workflow run (always present)
- `onEvent`: Event emitter function (present if `onEvent` option provided, for conditional helpers)
- `context`: Per-run context from `createContext` (present if `createContext` provided)

**Note**: 
- You can ignore the `ctx` parameter if you don't need it (TypeScript allows unused parameters).
- `WorkflowContext` has the same shape as `ConditionalContext`, so you can pass `ctx` directly to `createConditionalHelpers(ctx)` without destructuring.

### Event types

```typescript
WorkflowEvent<E, C>                 // Union of all event types (C defaults to unknown)
StepOptions                         // { name?: string, key?: string }
```

**Context in Events**: When you provide context via `createContext` or the `context` option, it's automatically included in every event's `context` field. This makes it easy to correlate events with request data, user IDs, or other contextual information.

```typescript
// Context is automatically added to all events
const workflow = createWorkflow({ fetchUser }, {
  createContext: () => ({ requestId: 'req-123', userId: 'user-456' }),
  onEvent: (event) => {
    // event.context is automatically available
    console.log(event.context?.requestId); // 'req-123'
    console.log(event.context?.userId);    // 'user-456'
  }
});
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
```

### Type extraction utilities

```typescript
ErrorOf<Fn>                         // Extract error type from function
CauseOf<Fn>                         // Extract cause type from function
Errors<[Fn1, Fn2, ...]>             // Union of error types from functions
ErrorsOfDeps<Deps>                  // Extract errors from deps object
CausesOfDeps<Deps>                  // Extract causes from deps object
ExtractValue<Result>                // Extract value type from Result
ExtractError<Result>                // Extract error type from Result
ExtractCause<Result>                // Extract cause type from Result
```

### Error types

```typescript
UnwrapError<E, C>                   // Error thrown by unwrap()
```

## Circuit Breaker

```typescript
createCircuitBreaker(name, config)  // Create circuit breaker instance
isCircuitOpenError(error)           // Check if error is circuit open
circuitBreakerPresets.critical      // Preset configurations
circuitBreakerPresets.lenient
```

### Types

```typescript
CircuitState                        // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
CircuitBreakerConfig                // Configuration options
CircuitBreakerStats                 // Runtime statistics
CircuitBreaker                      // Circuit breaker interface
CircuitOpenError                    // Error when circuit is open
```

## Saga / Compensation

```typescript
createSagaWorkflow(deps, options)   // Create saga with auto-inferred errors
runSaga(fn, options)                // Low-level saga execution
isSagaCompensationError(error)      // Check for compensation failure
```

### Types

```typescript
SagaContext<E>                      // Context with step() and tryStep()
SagaStepOptions<T>                  // Step options with compensate
SagaCompensationError               // Error with compensation details
SagaEvent                           // Saga lifecycle events
SagaResult<T, E>                    // Result type for sagas
CompensationAction<T>               // Compensation function type
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

### Types

```typescript
RateLimiterConfig                   // Rate limiter configuration
ConcurrencyLimiterConfig            // Concurrency limiter config
RateLimiter                         // Rate limiter interface
ConcurrencyLimiter                  // Concurrency limiter interface
RateLimitExceededError              // Error when rate exceeded
QueueFullError                      // Error when queue full
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

### Types

```typescript
Version                             // Version number type
VersionedState                      // State with version
MigrationFn                         // Migration function type
Migrations                          // Migration map type
MigrationError                      // Error during migration
VersionIncompatibleError            // Version mismatch error
```

## Conditional Execution

```typescript
when(condition, operation, opts, ctx)      // Run if true
unless(condition, operation, opts, ctx)    // Run if false
whenOr(cond, op, default, opts, ctx)       // Run if true, else default
unlessOr(cond, op, default, opts, ctx)     // Run if false, else default
createConditionalHelpers(ctx)              // Factory for bound helpers
```

### Types

```typescript
ConditionalOptions                  // { name?, key?, reason? }
ConditionalContext<C>               // { workflowId, onEvent?, context?: C }
```

**Context in Conditional Events**: When you provide `context` in `ConditionalContext`, it's automatically included in `step_skipped` events, maintaining correlation with other workflow events.

## Webhook / Event Triggers

```typescript
createWebhookHandler(workflow, fn, config) // Create HTTP handler
createSimpleHandler(config)                // Simple endpoint handler
createEventHandler(workflow, fn, config)   // Queue event handler
createResultMapper(mappings, options)      // Map errors to HTTP codes
createExpressHandler(handler)              // Express middleware
toWebhookRequest(req)                      // Convert Express request
sendWebhookResponse(res, response)         // Send Express response
validationError(message, field, details)   // Create validation error
requireFields(fields)                      // Field validator
composeValidators(...validators)           // Combine validators
```

### Types

```typescript
WebhookRequest<Body>                // Generic HTTP request
WebhookResponse<T>                  // Generic HTTP response
WebhookHandler<TBody>               // Handler function type
ValidationError                     // Validation error type
EventMessage<T>                     // Queue message type
EventProcessingResult               // Processing result type
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

### Types

```typescript
Policy                              // Policy type
PolicyFactory                       // Factory type
NamedPolicy                         // Named policy type
PolicyRegistry                      // Registry interface
StepOptionsBuilder                  // Fluent builder type
```

## Persistence

```typescript
createMemoryCache(options)          // In-memory cache
createFileCache(options)            // File-based cache
createKVCache(options)              // Key-value store cache
createStatePersistence(store, prefix)      // State persistence
createHydratingCache(memory, persist, id)  // Hydrating cache
serializeState(state)               // Serialize resume state
deserializeState(data)              // Deserialize resume state
stringifyState(state, meta)         // JSON stringify
parseState(json)                    // JSON parse
```

### Types

```typescript
SerializedState                     // JSON-safe state
MemoryCacheOptions                  // Memory cache config
FileCacheOptions                    // File cache config
KeyValueStore                       // KV store interface
StatePersistence                    // Persistence interface
```

## Devtools

```typescript
createDevtools(options)             // Create devtools instance
renderDiff(diff)                    // Render run diff
quickVisualize(events)              // Quick visualization
createConsoleLogger(options)        // Console event logger
```

### Types

```typescript
WorkflowRun                         // Captured run data
RunDiff                             // Diff between runs
StepDiff                            // Step-level diff
TimelineEntry                       // Timeline data
Devtools                            // Devtools interface
```

## HITL Orchestration

```typescript
createHITLOrchestrator(options)     // Create orchestrator
createMemoryApprovalStore()         // In-memory approval store
createMemoryWorkflowStateStore()    // In-memory state store
createApprovalWebhookHandler(store) // Webhook for approvals
createApprovalChecker(store, key)   // Approval status checker
```

### Types

```typescript
HITLOrchestrator                    // Orchestrator interface
ApprovalStore                       // Approval storage interface
WorkflowStateStore                  // State storage interface
HITLExecutionResult                 // Execution result type
ApprovalStatus                      // Approval status type
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
throwOutcome(error)                        // Helper for throw outcome
```

### Types

```typescript
WorkflowHarness<E, Deps>            // Test harness interface
MockStep<E>                         // Mock step function
MockFunction<T, E>                  // Mock function interface
ScriptedOutcome<T, E>               // Scripted step outcome
StepInvocation                      // Invocation record
AssertionResult                     // Assertion result
WorkflowSnapshot                    // Snapshot for comparison
```

## OpenTelemetry (Autotel)

```typescript
createAutotelAdapter(config)        // Create metrics adapter
createAutotelEventHandler(options)  // Event handler for debug
withAutotelTracing(trace, options)  // Wrap with tracing
```

### Types

```typescript
AutotelAdapterConfig                // Adapter configuration
AutotelMetrics                      // Collected metrics
AutotelAdapter                      // Adapter interface
AutotelTraceFn                      // Trace function type
```
