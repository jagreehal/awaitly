# awaitly

## 1.4.0

### Minor Changes

- 07409b1: Rename state collection APIs for clarity: `createStepCollector` → `createResumeStateCollector`, `getState()` → `getResumeState()`, and `createHITLCollector` → `createApprovalStateCollector`. These names better reflect that the collectors are specifically for building resume state for workflow persistence and replay.

## 1.3.0

### Minor Changes

- 3141905: Moved `run()` function from `awaitly/workflow` to main `awaitly` entry point for better ergonomics. The `run()` function provides clean do-notation style composition for Result-returning operations, making it a core feature alongside `ok`, `err`, and other Result primitives.

  **What changed:**

  - `run()` is now available directly from `awaitly` (no need to import from `awaitly/workflow`)
  - Related types (`RunStep`, `RunOptions`, `StepTimeoutError`, etc.) are also exported from main entry
  - Documentation updated to reflect new import paths

  **Migration:**

  ```typescript
  // Before
  import { run } from "awaitly/workflow";

  // After (recommended)
  import { run } from "awaitly";

  // Still works (backward compatible)
  import { run } from "awaitly/workflow";
  ```

  This change makes the most common composition pattern more discoverable and reduces import complexity for users who primarily use `run()` for composing Result-returning operations.

## 1.2.0

### Minor Changes

- 0039fe2: Split workflow functionality into separate entry point (`awaitly/workflow`) for better tree-shaking and bundle size optimization. The main `awaitly` package now exports core Result types plus `run()` for ergonomic composition, while workflow orchestration features (`createWorkflow`, `Duration`, `createStepCollector`, etc.) are available via `awaitly/workflow`. This allows users who only need Result types to import a smaller bundle (~5 KB gzipped) without the full workflow engine overhead.

  **What's available where:**

  ```typescript
  // Main entry - Result types + run() for composition
  import { ok, err, map, andThen, run } from "awaitly";

  // Workflow entry - orchestration engine
  import {
    createWorkflow,
    Duration,
    createStepCollector,
  } from "awaitly/workflow";
  ```

  The `run()` function is included in the main entry because composing 2+ Result-returning operations is a common use case, and `run()` provides much cleaner do-notation style compared to nested `andThen` chains.

## 1.1.0

### Minor Changes

- 795bfb6: Enhanced HITL orchestrator with production-ready approval workflows. Added `execute()` and `resume()` methods for workflow orchestration, `grantApproval()`, `rejectApproval()`, and `editApproval()` for approval management, and improved workflow state persistence. Enhanced testing harness with expanded mocking capabilities. Added workflow hooks (`shouldRun`, `onBeforeStart`, `onAfterStep`) for distributed locking, rate limiting, and checkpointing. Improved core workflow engine with better HITL collector support and event tracking.

## 1.0.0

### Initial Release

A TypeScript-first workflow orchestration library with type-safe error handling, visualization, and production-ready features.

#### Core Features

- **Result Type** (`ok`, `err`, `Result<T, E, C>`): Type-safe error handling with `Ok<T>` and `Err<E, C>` types, type guards (`isOk`, `isErr`), and comprehensive utilities (`map`, `andThen`, `match`, `all`, `allSettled`, `from`, `fromPromise`)

- **Workflow Engine** (`createWorkflow`, `run`): Build complex async workflows with typed steps, automatic error aggregation, and context propagation

- **Step API**:
  - `step()` - Execute async operations with automatic error capture
  - `step.try()` - Try/catch with custom error mapping
  - `step.fromResult()` - Map typed Result errors with preserved types
  - Retry support (fixed, linear, exponential backoff with jitter)
  - Timeout support with AbortSignal integration

#### Advanced Workflow Features

- **Circuit Breaker** (`createCircuitBreaker`): Prevent cascading failures with configurable failure thresholds and recovery
- **Saga/Compensation** (`createSagaWorkflow`, `runSaga`): Define compensating actions for automatic rollback on downstream failures
- **Rate Limiting** (`createRateLimiter`, `createConcurrencyLimiter`): Control throughput with token bucket and concurrency limiters
- **Workflow Versioning** (`migrateState`, `createVersionedStateLoader`): Handle schema migrations when resuming persisted workflows
- **Conditional Execution** (`when`, `unless`, `whenOr`, `unlessOr`): Declarative guards for conditional step execution
- **Webhook Adapters** (`createWebhookHandler`, `createEventHandler`): Expose workflows as HTTP endpoints or queue consumers
- **Policy Middleware** (`withPolicy`, `servicePolicies`): Reusable bundles of retry/timeout options

#### Persistence & Resume

- **Step Collector** (`createStepCollector`): Capture and restore workflow state for save/resume patterns
- **Persistence Adapters** (`createMemoryCache`, `createFileCache`, `createKVCache`): Pluggable storage for step cache and resume state
- Database integration patterns (PostgreSQL, DynamoDB, Redis)

#### Visualization & Debugging

- **Visualizer** (`createVisualizer`): Multiple output formats:
  - ASCII diagrams
  - Mermaid flowcharts with retry loops, error paths, and timeout edges
  - Interactive HTML with WebSocket support
  - JSON export (`renderAs('json')`, `renderAs('logger')`)
- **Decision Tracking**: `trackDecision`, `trackIf`, `trackSwitch` for visualizing conditional logic
- **Devtools** (`createDevtools`): Debugging, timeline rendering, and run diffing

#### Utilities

- **Batch Processing** (`processInBatches`): Process items in batches with bounded concurrency, progress tracking, and checkpoint hooks. Includes preset configurations (conservative, balanced, aggressive)

- **Resource Management** (`withScope`, `createResourceScope`, `createResource`): RAII-style resource cleanup with automatic guarantees and LIFO cleanup order

- **Match API** (`Match`): Exhaustive pattern matching for discriminated unions

  - `Match.value()`, `Match.tag()`, `Match.tags()`, `Match.when()` for pattern matching
  - `Match.exhaustive`, `Match.orElse()`, `Match.orElseValue()` for completion
  - `Match.is()`, `Match.isOneOf()` for type guards

- **Schedule API** (`Schedule`): Composable scheduling primitives for retry and polling strategies

  - Base schedules: `forever()`, `recurs(n)`, `once()`, `stop()`
  - Delay-based: `spaced()`, `exponential()`, `linear()`, `fibonacci()`
  - Combinators: `upTo(n)`, `maxDelay()`, `jittered()`, `andThen()`, `union()`, `intersect()`

- **Duration API** (`Duration`): Type-safe duration handling

  - Constructors: `millis()`, `seconds()`, `minutes()`, `hours()`, `days()`
  - Operations: `add()`, `subtract()`, `multiply()`, `divide()`
  - Formatting: `format()`, `parse()`

- **TaggedError**: Factory function for structured error types with exhaustive pattern matching
  - `TaggedError.match()` for exhaustive handling
  - `TaggedError.matchPartial()` for partial matching with fallback
  - `TaggedError.isTaggedError()` type guard

#### Production Features

- **HITL Orchestration** (`createHITLOrchestrator`): Human-in-the-loop approval workflows with polling and webhooks
- **Testing Harness** (`createWorkflowHarness`, `createMockFn`): Deterministic testing with scripted step outcomes
- **OpenTelemetry** (`createAutotelAdapter`): First-class metrics and tracing integration
- **Workflow Hooks**: `shouldRun`, `onBeforeStart`, `onAfterStep` for distributed locking, rate limiting, checkpointing, and more

#### Entry Points

- `awaitly` - Core Result type and `run()` for composition
- `awaitly/workflow` - Workflow engine (`createWorkflow`, `Duration`, step collector)
- `awaitly/match` - Pattern matching utilities
- `awaitly/retry` - Schedule API for retry strategies
- `awaitly/batch` - Batch processing utilities
- `awaitly/resource` - Resource management utilities
