# Advanced Usage

For core concepts (`createWorkflow`, `step`, `step.try`), see the [README](../README.md).

## Documentation Index

| Module | Description | Dedicated Doc |
|--------|-------------|---------------|
| **Duration** | Type-safe time units | [duration.md](./duration.md) |
| **Circuit Breaker** | Prevent cascading failures | [circuit-breaker.md](./circuit-breaker.md) |
| **Rate Limiter** | Control throughput | [rate-limiter.md](./rate-limiter.md) |
| **Saga** | Multi-step transactions with rollback | [saga.md](./saga.md) |
| **Persistence** | Save and restore workflow state | [persistence.md](./persistence.md) |
| **HITL** | Human-in-the-loop approvals | [hitl.md](./hitl.md) |
| **Testing** | Deterministic workflow testing | [testing.md](./testing.md) |
| **Devtools** | Debug and visualize workflows | [devtools.md](./devtools.md) |
| **OpenTelemetry** | Observability integration | [otel.md](./otel.md) |
| **Conditional** | Conditional step execution | [conditional.md](./conditional.md) |
| **Visualization** | ASCII & Mermaid rendering | [visualization.md](./visualization.md) |
| **Match** | Pattern matching | [match.md](./match.md) |
| **Policies** | Retry/timeout policies | [policies.md](./policies.md) |
| **Tagged Errors** | Error factory pattern | [tagged-error.md](./tagged-error.md) |
| **Schedule** | Retry scheduling/backoff | [schedule.md](./schedule.md) |
| **Resource Management** | RAII-style cleanup | [resource-management.md](./resource-management.md) |

This page provides quick reference for common patterns. For detailed API documentation, see the linked pages above.

## Batch operations

```typescript
import { all, allSettled, any, partition } from 'awaitly';

// All must succeed (short-circuits on first error)
const combined = all([ok(1), ok(2), ok(3)]); // ok([1, 2, 3])

// Collect ALL errors (great for form validation)
const validated = allSettled([
  validateEmail(email),
  validatePassword(password),
]);
// If any fail: err(['INVALID_EMAIL', 'WEAK_PASSWORD'])

// First success wins
const first = any([err('A'), ok('success'), err('B')]); // ok('success')

// Split successes and failures
const { values, errors } = partition(results);
```

Async versions: `allAsync`, `allSettledAsync`, `anyAsync`.

## Named Parallel Operations

Use `step.parallel()` with a named object for cleaner parallel execution with typed results:

```typescript
const result = await workflow(async (step, { fetchUser, fetchPosts, fetchComments }) => {
  // Named object form - each key gets its typed result
  const { user, posts, comments } = await step.parallel({
    user: () => fetchUser(id),
    posts: () => fetchPosts(id),
    comments: () => fetchComments(id),
  }, { name: 'Fetch user data' });

  // user: User, posts: Post[], comments: Comment[] - all typed!
  return { user, posts, comments };
});
```

Benefits:
- **Named results**: Destructure by name instead of array index
- **Type inference**: Each key preserves its specific type
- **Scope events**: Emits `scope_start`/`scope_end` for visualization
- **Fail-fast**: Short-circuits on first error (like `allAsync`)

## Dynamic error mapping

Use `{ onError }` instead of `{ error }` to create errors from the caught value:

```typescript
const result = await workflow(async (step) => {
  const data = await step.try(
    () => fetchExternalApi(),
    { onError: (e) => ({ type: 'API_ERROR' as const, message: String(e) }) }
  );

  // Or extract specific error info
  const parsed = await step.try(
    () => schema.parse(data),
    { onError: (e) => ({ type: 'VALIDATION_ERROR' as const, issues: e.issues }) }
  );

  return parsed;
});
```

## Type utilities

```typescript
import { type ErrorOf, type Errors, type ErrorsOfDeps } from 'awaitly';

// Extract error type from a function
type UserError = ErrorOf<typeof fetchUser>; // 'NOT_FOUND'

// Combine errors from multiple functions
type AppError = Errors<[typeof fetchUser, typeof fetchPosts]>;
// 'NOT_FOUND' | 'FETCH_ERROR'

// Extract from a deps object (same as createWorkflow uses)
type WorkflowErrors = ErrorsOfDeps<{ fetchUser: typeof fetchUser }>;
```

## Wrapping existing code

```typescript
import { from, fromPromise, tryAsync, fromNullable } from 'awaitly';

// Sync throwing function
const parsed = from(
  () => JSON.parse(input),
  (cause) => ({ type: 'PARSE_ERROR' as const, cause })
);

// Existing promise (remember: fetch needs r.ok check!)
const result = await fromPromise(
  fetch('/api').then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }),
  () => 'FETCH_FAILED' as const
);

// Nullable → Result
const element = fromNullable(
  document.getElementById('app'),
  () => 'NOT_FOUND' as const
);
```

## Transformers

```typescript
import { map, mapError, match, andThen, tap } from 'awaitly';

const doubled = map(ok(21), n => n * 2); // ok(42)

const mapped = mapError(err('not_found'), e => e.toUpperCase()); // err('NOT_FOUND')

const message = match(result, {
  ok: (user) => `Hello ${user.name}`,
  err: (error) => `Error: ${error}`,
});

// Chain results (flatMap)
const userPosts = andThen(fetchUser('1'), user => fetchPosts(user.id));

// Side effects without changing result
const logged = tap(result, user => console.log('Got user:', user.name));
```

## Human-in-the-loop (HITL)

Build workflows that pause for human approval:

```typescript
import {
  createWorkflow,
  createApprovalStep,
  createHITLCollector,
  isPendingApproval,
  injectApproval,
} from 'awaitly';

// 1. Create an approval step
const requireManagerApproval = createApprovalStep<{ approvedBy: string }>({
  key: 'manager-approval',
  checkApproval: async () => {
    const approval = await db.getApproval('manager-approval');
    if (!approval) return { status: 'pending' };
    if (approval.rejected) return { status: 'rejected', reason: approval.reason };
    return { status: 'approved', value: { approvedBy: approval.manager } };
  },
  pendingReason: 'Waiting for manager approval',
});

// 2. Use in workflow with collector
const collector = createHITLCollector();
const workflow = createWorkflow(
  { fetchData, requireManagerApproval },
  { onEvent: collector.handleEvent }
);

const result = await workflow(async (step) => {
  const data = await step(() => fetchData('123'), { key: 'data' });
  const approval = await step(requireManagerApproval, { key: 'manager-approval' });
  return { data, approvedBy: approval.approvedBy };
});

// 3. Handle pending state
if (!result.ok && isPendingApproval(result.error)) {
  // Save state for later resume
  await saveToDatabase(collector.getState());
  console.log(`Workflow paused: ${result.error.reason}`);
}

// 4. Resume after approval granted
const savedState = await loadFromDatabase();
const resumeState = injectApproval(savedState, {
  stepKey: 'manager-approval',
  value: { approvedBy: 'alice@example.com' }
});

const workflow2 = createWorkflow(
  { fetchData, requireManagerApproval },
  { resumeState }
);
// Re-run same workflow body -- cached steps skip, approval injected
```

### HITL utilities

```typescript
// Check approval state
hasPendingApproval(state, 'approval-key')  // boolean
getPendingApprovals(state)                  // string[]

// Modify state
clearStep(state, 'step-key')               // Remove step from state
injectApproval(state, { stepKey, value })  // Add approval result
```

## Interop with neverthrow

```typescript
import { Result as NTResult } from 'neverthrow';
import { ok, err, type Result } from 'awaitly';

function fromNeverthrow<T, E>(ntResult: NTResult<T, E>): Result<T, E> {
  return ntResult.isOk() ? ok(ntResult.value) : err(ntResult.error);
}

// Use in workflow
const result = await workflow(async (step) => {
  const validated = await step(fromNeverthrow(validateInput(data)));
  return validated;
});
```

## Low-level: run()

`createWorkflow` is built on `run()`. Use it for one-off workflows:

```typescript
import { run } from 'awaitly';

const result = await run(async (step) => {
  const user = await step(fetchUser(id));
  return user;
});
```

### run.strict()

For closed error unions without `UnexpectedError`:

```typescript
import { run } from 'awaitly';

type AppError = 'NOT_FOUND' | 'UNAUTHORIZED' | 'UNEXPECTED';

const result = await run.strict<User, AppError>(
  async (step) => {
    return await step(fetchUser(id));
  },
  { catchUnexpected: () => 'UNEXPECTED' as const }
);

// result.error: 'NOT_FOUND' | 'UNAUTHORIZED' | 'UNEXPECTED' (exactly)
```

Prefer `createWorkflow` for automatic error type inference.

## Workflow Hooks

`createWorkflow` supports hooks for distributed systems integration:

```typescript
const workflow = createWorkflow({ processOrder }, {
  // Called first - check if workflow should run (concurrency control)
  shouldRun: async (workflowId, context) => {
    const lock = await acquireDistributedLock(workflowId);
    return lock.acquired; // false skips workflow execution
  },

  // Called after shouldRun - additional pre-flight checks
  onBeforeStart: async (workflowId, context) => {
    await extendMessageVisibility(context.messageId);
    return true; // false skips workflow execution
  },

  // Called after each keyed step completes - for checkpointing
  onAfterStep: async (stepKey, result, workflowId, context) => {
    await checkpointStep(workflowId, stepKey, result);
  },
});
```

### Hook execution order

1. `shouldRun` - Return `false` to skip (e.g., rate limiting, duplicate detection)
2. `onBeforeStart` - Return `false` to skip (e.g., distributed locking)
3. Workflow executes, calling `onAfterStep` after each keyed step
4. `onEvent` receives all workflow events

### Use cases

| Hook | Use Case |
|------|----------|
| `shouldRun` | Distributed locking, rate limiting, duplicate detection |
| `onBeforeStart` | Queue message visibility, acquire resources |
| `onAfterStep` | Checkpoint to external store, extend message visibility |

#### `shouldRun` - Concurrency Control

Use for early gating before workflow execution starts:

**Distributed locking** - Prevent duplicate execution across instances:
```typescript
shouldRun: async (workflowId) => {
  const lock = await redis.set(`lock:${workflowId}`, '1', 'EX', 3600, 'NX');
  return lock === 'OK'; // false = another instance is running
}
```

**Rate limiting** - Skip if too many workflows are running:
```typescript
shouldRun: async () => {
  const count = await getActiveWorkflowCount();
  return count < MAX_CONCURRENT_WORKFLOWS;
}
```

**Duplicate detection** - Skip if already processed:
```typescript
shouldRun: async (workflowId) => {
  const exists = await db.workflows.findUnique({ where: { id: workflowId } });
  return !exists; // Skip if already processed
}
```

#### `onBeforeStart` - Pre-flight Setup

Use for setup operations that must happen before execution:

**Queue message visibility** - Extend visibility timeout (SQS, RabbitMQ):
```typescript
onBeforeStart: async (workflowId, ctx) => {
  await sqs.changeMessageVisibility({
    ReceiptHandle: ctx.messageHandle,
    VisibilityTimeout: 300 // 5 minutes
  });
  return true;
}
```

**Resource acquisition** - Acquire database connections, file locks:
```typescript
onBeforeStart: async (workflowId) => {
  const connection = await acquireDbConnection();
  if (!connection) return false; // Skip if no resources available
  return true;
}
```

**Pre-flight validation** - Check prerequisites before starting:
```typescript
onBeforeStart: async (workflowId, ctx) => {
  const order = await db.orders.findUnique({ where: { id: ctx.orderId } });
  return order?.status === 'PENDING'; // Only process pending orders
}
```

#### `onAfterStep` - Checkpointing & Observability

Use for incremental persistence and monitoring after each step:

**Incremental checkpointing** - Save progress after each step:
```typescript
onAfterStep: async (stepKey, result, workflowId, ctx) => {
  // Save progress even if workflow crashes later
  await db.checkpoints.upsert({
    where: { workflowId_stepKey: { workflowId, stepKey } },
    update: { result: JSON.stringify(result), updatedAt: new Date() },
    create: { workflowId, stepKey, result: JSON.stringify(result) }
  });
}
```

**Queue message visibility extension** - Keep message alive during long workflows:
```typescript
onAfterStep: async (stepKey, result, workflowId, ctx) => {
  // Extend visibility every step to prevent timeout
  await sqs.changeMessageVisibility({
    ReceiptHandle: ctx.messageHandle,
    VisibilityTimeout: 300
  });
}
```

**Progress notifications** - Send updates to users/operators:
```typescript
onAfterStep: async (stepKey, result, workflowId, ctx) => {
  if (result.ok) {
    await notifyUser(ctx.userId, {
      workflowId,
      step: stepKey,
      status: 'completed',
      progress: calculateProgress(stepKey)
    });
  }
}
```

**Metrics & monitoring** - Track step performance:
```typescript
onAfterStep: async (stepKey, result, workflowId, ctx) => {
  await metrics.record({
    workflowId,
    stepKey,
    success: result.ok,
    duration: Date.now() - ctx.stepStartTime
  });
}
```

**Dead letter queue management** - Handle persistent failures:
```typescript
onAfterStep: async (stepKey, result, workflowId, ctx) => {
  if (!result.ok && ctx.retryCount >= MAX_RETRIES) {
    await sendToDeadLetterQueue(workflowId, stepKey, result);
  }
}
```

**Workflow state snapshots** - Create resumable checkpoints:
```typescript
onAfterStep: async (stepKey, result, workflowId, ctx) => {
  // Create snapshot for crash recovery
  const snapshot = await createSnapshot(workflowId, stepKey, result);
  await db.snapshots.create({ data: snapshot });
}
```

**Stream/event publishing** - Emit step completion events:
```typescript
onAfterStep: async (stepKey, result, workflowId, ctx) => {
  await eventStream.publish({
    type: 'step_completed',
    workflowId,
    stepKey,
    success: result.ok,
    timestamp: Date.now()
  });
}
```

**Important notes:**
- `onAfterStep` is called for both success and error results
- Only called for steps with a `key` option
- Works even without a cache (useful for checkpointing-only scenarios)
- Called after each step completes, not for cached steps

### With context

Combine hooks with `createContext` for request-scoped data:

```typescript
type Context = { messageId: string; traceId: string };

const workflow = createWorkflow<Deps, Context>({ processOrder }, {
  createContext: () => ({
    messageId: getCurrentMessageId(),
    traceId: generateTraceId(),
  }),
  onAfterStep: async (stepKey, result, workflowId, ctx) => {
    console.log(`[${ctx.traceId}] Step ${stepKey} completed`);
  },
});
```

## Circuit Breaker

Prevent cascading failures by tracking step failure rates and short-circuiting calls when a threshold is exceeded:

```typescript
import { ok } from 'awaitly';
import {
  createCircuitBreaker,
  isCircuitOpenError,
  circuitBreakerPresets,
} from 'awaitly/circuit-breaker';

// Create a circuit breaker with custom config (name is required)
const breaker = createCircuitBreaker('external-api', {
  failureThreshold: 5,      // Open after 5 failures
  resetTimeout: 30000,      // Try again after 30 seconds
  halfOpenMax: 3,           // Allow 3 test requests in half-open state
  windowSize: 60000,        // Count failures within this window (1 minute)
});

// Or use a preset
const criticalBreaker = createCircuitBreaker('critical-service', circuitBreakerPresets.critical);
const lenientBreaker = createCircuitBreaker('lenient-service', circuitBreakerPresets.lenient);

// Option 1: execute() throws CircuitOpenError if circuit is open
try {
  const data = await breaker.execute(async () => {
    return await fetchFromExternalApi();
  });
  console.log('Got data:', data);
} catch (error) {
  if (isCircuitOpenError(error)) {
    console.log(`Circuit is open, retry after ${error.retryAfterMs}ms`);
  } else {
    console.log('Operation failed:', error);
  }
}

// Option 2: executeResult() returns a Result instead of throwing
const result = await breaker.executeResult(async () => {
  // Your Result-returning operation
  return ok(await fetchFromExternalApi());
});

if (!result.ok) {
  if (isCircuitOpenError(result.error)) {
    console.log('Circuit is open, try again later');
  }
}

// Check circuit state (no arguments needed)
const stats = breaker.getStats();
console.log(stats.state);        // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
console.log(stats.failureCount);
console.log(stats.successCount);
console.log(stats.halfOpenSuccesses);
```

## Saga / Compensation Pattern

Define compensating actions for steps that need rollback on downstream failures:

```typescript
import { createSagaWorkflow, isSagaCompensationError } from 'awaitly/saga';

// Create saga with deps (like createWorkflow) - error types inferred automatically
const checkoutSaga = createSagaWorkflow(
  { reserveInventory, chargeCard, sendConfirmation },
  { onEvent: (event) => console.log(event) }
);

const result = await checkoutSaga(async (saga, deps) => {
  // Reserve inventory with compensation
  const reservation = await saga.step(
    () => deps.reserveInventory(items),
    {
      name: 'reserve-inventory',
      compensate: (res) => releaseInventory(res.reservationId),
    }
  );

  // Charge card with compensation
  const payment = await saga.step(
    () => deps.chargeCard(amount),
    {
      name: 'charge-card',
      compensate: (p) => refundPayment(p.transactionId),
    }
  );

  // If sendConfirmation fails, compensations run in reverse order:
  // 1. refundPayment(payment.transactionId)
  // 2. releaseInventory(reservation.reservationId)
  await saga.step(
    () => deps.sendConfirmation(email),
    { name: 'send-confirmation' }
  );

  return { reservation, payment };
});

// Check for compensation errors
if (!result.ok && isSagaCompensationError(result.error)) {
  console.log('Saga failed, compensations may have partially succeeded');
  console.log(result.error.compensationErrors);
}
```

### Low-level runSaga

For explicit error typing without deps-based inference:

```typescript
import { runSaga } from 'awaitly/saga';

const result = await runSaga<CheckoutResult, CheckoutError>(async (saga) => {
  const reservation = await saga.step(
    () => reserveInventory(items),
    { compensate: (res) => releaseInventory(res.id) }
  );

  // tryStep for catching throws
  const payment = await saga.tryStep(
    () => externalPaymentApi.charge(amount),
    {
      error: 'PAYMENT_FAILED' as const,
      compensate: (p) => externalPaymentApi.refund(p.txId),
    }
  );

  return { reservation, payment };
});
```

## Rate Limiting / Concurrency Control

Control throughput for steps that hit rate-limited APIs:

```typescript
import {
  createRateLimiter,
  createConcurrencyLimiter,
  createCombinedLimiter,
  rateLimiterPresets,
} from 'awaitly/ratelimit';

// Token bucket rate limiter (requires name and config)
const rateLimiter = createRateLimiter('api-calls', {
  maxPerSecond: 10,        // Maximum operations per second
  burstCapacity: 20,       // Allow brief spikes (default: maxPerSecond * 2)
  strategy: 'wait',        // 'wait' (default) or 'reject'
});

// Concurrency limiter
const concurrencyLimiter = createConcurrencyLimiter('db-pool', {
  maxConcurrent: 5,        // Max 5 concurrent operations
  maxQueueSize: 100,       // Queue up to 100 waiting requests
  strategy: 'queue',       // 'queue' (default) or 'reject'
});

// Use presets for common scenarios
const apiLimiter = createRateLimiter('external-api', rateLimiterPresets.api);
// rateLimiterPresets.api: { maxPerSecond: 10, burstCapacity: 20, strategy: 'wait' }
// rateLimiterPresets.external: { maxPerSecond: 5, burstCapacity: 10, strategy: 'wait' }
// rateLimiterPresets.database: for ConcurrencyLimiter - { maxConcurrent: 10, strategy: 'queue', maxQueueSize: 100 }

// Wrap operations with execute() method
const data = await rateLimiter.execute(async () => {
  return await callExternalApi();
});

// For Result-returning operations
const result = await rateLimiter.executeResult(async () => {
  return ok(await callExternalApi());
});

// Use with batch operations
const results = await concurrencyLimiter.executeAll(
  ids.map(id => async () => fetchItem(id))
);

// Combined limiter (both rate and concurrency)
const combined = createCombinedLimiter('api', {
  rate: { maxPerSecond: 10 },
  concurrency: { maxConcurrent: 3 },
});

const data = await combined.execute(async () => callApi());

// Get limiter statistics
const stats = rateLimiter.getStats();
console.log(stats.availableTokens);  // Current available tokens
console.log(stats.waitingCount);     // Requests waiting for tokens
```

## Workflow Versioning and Migration

Handle schema changes when resuming workflows persisted with older step shapes:

```typescript
import {
  createVersionedStateLoader,
  createVersionedState,
  parseVersionedState,
  stringifyVersionedState,
  migrateState,
  createKeyRenameMigration,
  createKeyRemoveMigration,
  createValueTransformMigration,
  composeMigrations,
} from 'awaitly/persistence';

// Define migrations from each version to the next
// Key is source version, migration transforms to version + 1
const migrations = {
  // Migrate from v1 to v2: rename keys
  1: createKeyRenameMigration({ 
    'user:fetch': 'user:load',
    'order:create': 'order:submit',
  }),
  
  // Migrate from v2 to v3: multiple transformations
  2: composeMigrations([
    createKeyRemoveMigration(['deprecated:step']),
    createValueTransformMigration({
      'user:load': (entry) => ({
        ...entry,
        result: entry.result.ok 
          ? { ok: true, value: { ...entry.result.value, newField: 'default' } }
          : entry.result,
      }),
    }),
  ]),
};

// Create a versioned state loader
const loader = createVersionedStateLoader({
  version: 3,               // Current workflow version
  migrations,
  strictVersioning: true,   // Fail if state is from newer version
});

// Load state from storage and parse it
const json = await db.loadWorkflowState(runId);
const versionedState = parseVersionedState(json);

// Migrate to current version
const result = await loader(versionedState);
if (!result.ok) {
  // Handle migration error or version incompatibility
  console.error(result.error);
}

// Use migrated state with workflow
const workflow = createWorkflow(deps, { resumeState: result.value });

// When saving state, create versioned state
import { createStepCollector } from 'awaitly';

const collector = createStepCollector();
// ... run workflow with collector ...

const versionedState = createVersionedState(collector.getState(), 3);
const serialized = stringifyVersionedState(versionedState);
await db.saveWorkflowState(runId, serialized);
```

## Conditional Step Execution

Declarative guards for steps that should only run under certain conditions:

```typescript
import { when, unless, whenOr, unlessOr, createConditionalHelpers } from 'awaitly/conditional';

const result = await workflow(async (step) => {
  const user = await step(() => fetchUser(id), { key: 'user' });

  // Only runs if condition is true, returns undefined if skipped
  const premium = await when(
    user.isPremium,
    () => step(() => fetchPremiumData(user.id), { key: 'premium' }),
    { name: 'check-premium', reason: 'User is not premium' }
  );

  // Skips if condition is true, returns undefined if skipped
  const trial = await unless(
    user.isPremium,
    () => step(() => fetchTrialLimits(user.id), { key: 'trial' }),
    { name: 'check-trial', reason: 'User is premium' }
  );

  // With default value instead of undefined
  const limits = await whenOr(
    user.isPremium,
    () => step(() => fetchPremiumLimits(user.id), { key: 'premium-limits' }),
    { maxRequests: 100, maxStorage: 1000 }, // default for non-premium
    { name: 'check-premium-limits', reason: 'Using default limits' }
  );

  return { user, premium, trial, limits };
});
```

### With Event Emission

Use `createConditionalHelpers` with `run()` or `createWorkflow` to emit `step_skipped` events for visualization and debugging. **Context is automatically included in skipped events when provided**, maintaining correlation with other workflow events.

**Note**: Both `run()` and `createWorkflow` support conditional helpers with event emission. With `createWorkflow`, use the `ctx` parameter (always provided) to access `workflowId`, `onEvent`, and `context` for conditional helpers.

```typescript
// With run() - full support for conditional helpers with context
type RequestContext = { requestId: string; userId: string };

const requestContext: RequestContext = { requestId: 'req-123', userId: 'user-456' };

// Define workflowId and onEvent before calling run()
const workflowId = 'my-workflow-id';
const onEvent = (event: WorkflowEvent<unknown, RequestContext>) => {
  console.log('Event:', event.type, 'Context:', event.context);
};

const result = await run(async (step) => {
  // Pass workflowId, onEvent, and context to conditional helpers
  const ctx = { 
    workflowId,      // Captured from outer scope
    onEvent,         // Captured from outer scope
    context: requestContext  // Context automatically added to step_skipped events
  };
  const { when, whenOr } = createConditionalHelpers(ctx);

  const user = await step(fetchUser(id));

  // Emits step_skipped event with context when condition is false
  const premium = await when(
    user.isPremium,
    () => step(() => fetchPremiumData(user.id)),
    { name: 'premium-data', reason: 'User is not premium' }
  );

  return { user, premium };
}, { onEvent, workflowId, context: requestContext });
```

```typescript
// With createWorkflow - use WorkflowContext parameter for conditional helpers
// The callback receives a third parameter `ctx` (always provided) with workflowId, onEvent, and context

const workflow = createWorkflow({ fetchUser }, {
  createContext: () => ({ requestId: 'req-123', userId: 'user-456' }),
  onEvent: (event, ctx) => {
    // All workflow events automatically include context, including step_skipped from conditional helpers
    console.log('Event context:', event.context);
  }
});

// Use conditional helpers with ctx parameter (ctx is always provided)
await workflow(async (step, deps, ctx) => {
  const user = await step(fetchUser(id));
  
  // ctx can be passed directly to createConditionalHelpers (same shape)
  const { when } = createConditionalHelpers(ctx);
  
  // Emits step_skipped event with context when condition is false
  const premium = await when(
    user.isPremium,
    () => step(() => fetchPremiumData(user.id)),
    { name: 'premium-data', reason: 'User is not premium' }
  );
  
  return { user, premium };
});
```

**Important Notes**:
- **With `run()`**: Full support for conditional helpers with event emission and context correlation. Capture `workflowId`, `onEvent`, and `context` from options before calling `run()`, then pass them to `createConditionalHelpers`.
- **With `createWorkflow`**: The `ctx` parameter (third parameter) is always provided in your callback. It contains `workflowId`, `onEvent`, and `context`. Pass these to `createConditionalHelpers` for full event emission support.
- **Backward Compatibility**: Existing code that doesn't use the `ctx` parameter continues to work (TypeScript allows unused parameters). You can ignore `ctx` if you don't need conditional helpers with event emission.

## Webhook / Event Trigger Adapters

Expose workflows as HTTP endpoints or event consumers:

```typescript
import {
  createWebhookHandler,
  createSimpleHandler,
  createResultMapper,
  createExpressHandler,
  validationError,
  requireFields,
} from 'awaitly/webhook';

// Create a webhook handler for a workflow
const handler = createWebhookHandler(
  checkoutWorkflow,
  async (step, deps, input: CheckoutInput) => {
    const charge = await step(() => deps.chargeCard(input.amount));
    await step(() => deps.sendEmail(input.email, charge.receiptUrl));
    return { chargeId: charge.id };
  },
  {
    validateInput: (req) => {
      const validation = requireFields(['amount', 'email'])(req.body);
      if (!validation.ok) return validation;
      return ok({ amount: req.body.amount, email: req.body.email });
    },
    mapResult: createResultMapper([
      { error: 'CARD_DECLINED', status: 402, message: 'Payment failed' },
      { error: 'INVALID_EMAIL', status: 400, message: 'Invalid email address' },
    ]),
  }
);

// Use with Express
import express from 'express';
const app = express();
app.post('/checkout', createExpressHandler(handler));

// Or manually
app.post('/checkout', async (req, res) => {
  const response = await handler({
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body,
    query: req.query,
    params: req.params,
  });
  res.status(response.status).json(response.body);
});
```

### Event Triggers (for message queues)

```typescript
import { createEventHandler } from 'awaitly/webhook';

const handler = createEventHandler(
  checkoutWorkflow,
  async (step, deps, payload: CheckoutPayload) => {
    const charge = await step(() => deps.chargeCard(payload.amount));
    return { chargeId: charge.id };
  },
  {
    validatePayload: (event) => {
      if (!event.payload.amount) {
        return err(validationError('Missing amount'));
      }
      return ok(event.payload);
    },
    mapResult: (result) => ({
      success: result.ok,
      ack: result.ok || !isRetryableError(result.error),
      error: result.ok ? undefined : { type: String(result.error) },
    }),
  }
);

// Use with SQS, RabbitMQ, etc.
queue.consume(async (message) => {
  const result = await handler({
    id: message.id,
    type: message.type,
    payload: message.body,
  });
  if (result.ack) await message.ack();
  else await message.nack();
});
```

## Policy-Driven Step Middleware

Reusable bundles of `StepOptions` (retry, timeout, cache keys) that can be composed and applied per-workflow or per-step:

```typescript
import {
  mergePolicies,
  createPolicyApplier,
  withPolicy,
  withPolicies,
  retryPolicies,
  timeoutPolicies,
  servicePolicies,
  createPolicyRegistry,
  stepOptions,
} from 'awaitly/policies';

// Use pre-built service policies
const user = await step(
  () => fetchUser(id),
  withPolicy(servicePolicies.httpApi, { name: 'fetch-user' })
);

// Combine multiple policies
const data = await step(
  () => fetchData(),
  withPolicies([timeoutPolicies.api, retryPolicies.standard], 'fetch-data')
);

// Create a policy applier for consistent defaults
const applyPolicy = createPolicyApplier(
  timeoutPolicies.api,
  retryPolicies.transient
);

const result = await step(
  () => callApi(),
  applyPolicy({ name: 'api-call', key: 'cache:api' })
);

// Use the fluent builder API
const options = stepOptions()
  .name('fetch-user')
  .key('user:123')
  .timeout(5000)
  .retries(3)
  .build();

// Create a policy registry for organization-wide policies
const registry = createPolicyRegistry();
registry.register('api', servicePolicies.httpApi);
registry.register('db', servicePolicies.database);
registry.register('cache', servicePolicies.cache);

const user = await step(
  () => fetchUser(id),
  registry.apply('api', { name: 'fetch-user' })
);
```

### Available Presets

```typescript
// Retry policies
retryPolicies.none           // No retry
retryPolicies.transient      // 3 attempts, fast backoff
retryPolicies.standard       // 3 attempts, moderate backoff
retryPolicies.aggressive     // 5 attempts, longer backoff
retryPolicies.fixed(3, 1000) // 3 attempts, 1s fixed delay
retryPolicies.linear(3, 100) // 3 attempts, linear backoff

// Timeout policies
timeoutPolicies.fast         // 1 second
timeoutPolicies.api          // 5 seconds
timeoutPolicies.extended     // 30 seconds
timeoutPolicies.long         // 2 minutes
timeoutPolicies.ms(3000)     // Custom milliseconds

// Service policies (combined retry + timeout)
servicePolicies.httpApi      // 5s timeout, 3 retries
servicePolicies.database     // 30s timeout, 2 retries
servicePolicies.cache        // 1s timeout, no retry
servicePolicies.messageQueue // 30s timeout, 5 retries
servicePolicies.fileSystem   // 2min timeout, 3 retries
servicePolicies.rateLimited  // 10s timeout, 5 linear retries
```

## Save & Resume Workflows

Persist workflow state to a database and resume later from exactly where you left off. Perfect for crash recovery, long-running workflows, or pausing for approvals.

### Quick Start: Collect, Save, Resume

The easiest way to save and resume workflows is using `createStepCollector()`:

```typescript
import { createWorkflow, createStepCollector } from 'awaitly';
import { stringifyState, parseState } from 'awaitly/persistence';

// 1. Collect state during execution
const collector = createStepCollector();
const workflow = createWorkflow({ fetchUser, fetchPosts }, {
  onEvent: collector.handleEvent, // Automatically collects step_complete events
});

await workflow(async (step) => {
  // Only steps with keys are saved
  const user = await step(() => fetchUser("1"), { key: "user:1" });
  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
  return { user, posts };
});

// 2. Get collected state
const state = collector.getState();

// 3. Save to database
const json = stringifyState(state, { workflowId: "123", timestamp: Date.now() });
await db.workflowStates.create({ id: "123", state: json });

// 4. Resume later
const saved = await db.workflowStates.findUnique({ where: { id: "123" } });
const savedState = parseState(saved.state);

const resumed = createWorkflow({ fetchUser, fetchPosts }, {
  resumeState: savedState, // Pre-populates cache from saved state
});

// Cached steps skip execution automatically
await resumed(async (step) => {
  const user = await step(() => fetchUser("1"), { key: "user:1" }); // ✅ Cache hit
  const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` }); // ✅ Cache hit
  return { user, posts };
});
```

### Why Use `createStepCollector()`?

- **Automatic filtering**: Only collects `step_complete` events (ignores other events)
- **Metadata preservation**: Captures both result and meta for proper error replay
- **Type-safe**: Returns properly typed `ResumeState`
- **Convenient API**: Simple `handleEvent` → `getState` pattern

### Manual Collection (Advanced)

If you need custom filtering or processing, you can collect events manually:

```typescript
import { createWorkflow, isStepComplete, type ResumeStateEntry } from 'awaitly';

const savedSteps = new Map<string, ResumeStateEntry>();
const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    if (isStepComplete(event)) {
      // Custom filtering or processing
      if (event.stepKey.startsWith('important:')) {
        savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
      }
    }
  },
});
```

## Pluggable Persistence Adapters

First-class adapters for `StepCache` and `ResumeState` with JSON-safe serialization:

```typescript
import {
  createMemoryCache,
  createFileCache,
  createKVCache,
  createStatePersistence,
  createHydratingCache,
  stringifyState,
  parseState,
} from 'awaitly/persistence';

// In-memory cache with TTL and LRU eviction
const cache = createMemoryCache({ 
  maxSize: 1000,    // Max entries
  ttl: 60000,       // 1 minute TTL
});

const workflow = createWorkflow(deps, { cache });

// File-based persistence
import * as fs from 'fs/promises';

const fileCache = createFileCache({
  directory: './workflow-cache',
  fs: {
    readFile: (path) => fs.readFile(path, 'utf-8'),
    writeFile: (path, data) => fs.writeFile(path, data, 'utf-8'),
    unlink: fs.unlink,
    exists: async (path) => fs.access(path).then(() => true).catch(() => false),
    readdir: fs.readdir,
    mkdir: fs.mkdir,
  },
});

await fileCache.init();

// Redis/DynamoDB adapter
const kvCache = createKVCache({
  store: {
    get: (key) => redis.get(key),
    set: (key, value, opts) => redis.set(key, value, { EX: opts?.ttl }),
    delete: (key) => redis.del(key).then(n => n > 0),
    exists: (key) => redis.exists(key).then(n => n > 0),
    keys: (pattern) => redis.keys(pattern),
  },
  prefix: 'myapp:workflow:',
  ttl: 3600, // 1 hour
});

// State persistence for workflow resumption
const persistence = createStatePersistence({
  get: (key) => redis.get(key),
  set: (key, value) => redis.set(key, value),
  delete: (key) => redis.del(key).then(n => n > 0),
  exists: (key) => redis.exists(key).then(n => n > 0),
  keys: (pattern) => redis.keys(pattern),
}, 'workflow:state:');

// Save workflow state
const collector = createStepCollector();
const workflow = createWorkflow(deps, { onEvent: collector.handleEvent });
await workflow(async (step) => { /* ... */ });

await persistence.save('run-123', collector.getState(), { userId: 'user-1' });

// Load and resume
const loaded = await persistence.load('run-123');
const allRuns = await persistence.list();

// Hydrating cache (loads from persistent storage on first access)
const hydratingCache = createHydratingCache(
  createMemoryCache(),
  persistence,
  'run-123'
);
await hydratingCache.hydrate();
```

### JSON-safe Serialization

```typescript
import {
  serializeResult,
  deserializeResult,
  serializeState,
  deserializeState,
  stringifyState,
  parseState,
} from 'awaitly/persistence';

// Serialize Results with Error causes preserved
const serialized = serializeResult(result);
const restored = deserializeResult(serialized);

// Serialize entire workflow state
const json = stringifyState(resumeState, { userId: 'user-1' });
const state = parseState(json);
```

### Database Integration Patterns

**PostgreSQL/MySQL with Prisma:**

```typescript
// Save
const state = collector.getState();
const json = stringifyState(state, { workflowId: runId });
await prisma.workflowState.upsert({
  where: { runId },
  update: { state: json, updatedAt: new Date() },
  create: { runId, state: json },
});

// Load
const saved = await prisma.workflowState.findUnique({ where: { runId } });
const savedState = parseState(saved.state);
```

**DynamoDB:**

```typescript
const persistence = createStatePersistence({
  get: async (key) => {
    const result = await dynamodb.get({ TableName: 'workflows', Key: { id: key } });
    return result.Item?.state || null;
  },
  set: async (key, value) => {
    await dynamodb.put({ TableName: 'workflows', Item: { id: key, state: value } });
  },
  delete: async (key) => {
    await dynamodb.delete({ TableName: 'workflows', Key: { id: key } });
    return true;
  },
  exists: async (key) => {
    const result = await dynamodb.get({ TableName: 'workflows', Key: { id: key } });
    return !!result.Item;
  },
  keys: async (pattern) => {
    // Implement pattern matching for your use case
    const result = await dynamodb.scan({ TableName: 'workflows' });
    return result.Items?.map(item => item.id) || [];
  },
}, 'workflow:state:');
```

## Devtools

Developer tools for workflow debugging, visualization, and analysis:

```typescript
import {
  createDevtools,
  renderDiff,
  createConsoleLogger,
  quickVisualize,
} from 'awaitly/devtools';

// Create devtools instance
const devtools = createDevtools({
  workflowName: 'checkout',
  logEvents: true,
  maxHistory: 10,
});

// Use with workflow
const workflow = createWorkflow(deps, {
  onEvent: devtools.handleEvent,
});

await workflow(async (step) => {
  const user = await step(() => fetchUser(id), { name: 'fetch-user' });
  const charge = await step(() => chargeCard(100), { name: 'charge-card' });
  return { user, charge };
});

// Render visualizations
console.log(devtools.render());           // ASCII visualization
console.log(devtools.renderMermaid());    // Mermaid diagram
console.log(devtools.renderTimeline());   // Timeline view

// Get timeline data
const timeline = devtools.getTimeline();
// [{ name: 'fetch-user', startMs: 0, endMs: 50, status: 'success' }, ...]

// Compare runs
const diff = devtools.diffWithPrevious();
if (diff) {
  console.log(renderDiff(diff));
}

// Export/import runs
const json = devtools.exportRun();
devtools.importRun(json);

// Simple console logging
const workflow2 = createWorkflow(deps, {
  onEvent: createConsoleLogger({ prefix: '[checkout]', colors: true }),
});
```

### Timeline Output Example

```
Timeline:
────────────────────────────────────────────────────────────────
fetch-user           |██████                                  | 50ms
charge-card          |      ████████████                      | 120ms
send-email           |                  ████                  | 30ms
────────────────────────────────────────────────────────────────
```

## HITL Orchestration Helpers

Production-ready helpers for human-in-the-loop approval workflows:

```typescript
import {
  createHITLOrchestrator,
  createMemoryApprovalStore,
  createMemoryWorkflowStateStore,
  createApprovalWebhookHandler,
  createApprovalChecker,
} from 'awaitly/hitl';

// Create orchestrator with stores
const orchestrator = createHITLOrchestrator({
  approvalStore: createMemoryApprovalStore(),
  workflowStateStore: createMemoryWorkflowStateStore(),
  defaultExpirationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
});

// Execute workflow that may pause for approval
// IMPORTANT: The factory must pass onEvent to createWorkflow for HITL tracking!
const result = await orchestrator.execute(
  'order-approval',
  ({ resumeState, onEvent }) => createWorkflow(deps, { resumeState, onEvent }),
  async (step, deps, input) => {
    const order = await step(() => deps.createOrder(input));
    const approval = await step(
      () => deps.requireApproval(order.id),
      { key: `approval:${order.id}` }
    );
    await step(() => deps.processOrder(order.id));
    return { orderId: order.id };
  },
  { items: [...], total: 500 }
);

if (result.status === 'paused') {
  console.log(`Workflow paused, waiting for: ${result.pendingApprovals}`);
  console.log(`Run ID: ${result.runId}`);
}

// Grant approval (with optional auto-resume)
const { resumedWorkflows } = await orchestrator.grantApproval(
  `approval:${orderId}`,
  { approvedBy: 'manager@example.com' },
  { autoResume: true }
);

// Or poll for approval
const status = await orchestrator.pollApproval(`approval:${orderId}`, {
  intervalMs: 1000,
  timeoutMs: 60000,
});

// Resume manually
const resumed = await orchestrator.resume(
  runId,
  (resumeState) => createWorkflow(deps, { resumeState }),
  workflowFn
);
```

### Webhook Handler for Approvals

```typescript
import { createApprovalWebhookHandler } from 'awaitly/hitl';
import express from 'express';

const handleApproval = createApprovalWebhookHandler(approvalStore);

const app = express();
app.post('/api/approvals', async (req, res) => {
  const result = await handleApproval({
    key: req.body.key,
    action: req.body.action,  // 'approve' | 'reject' | 'cancel'
    value: req.body.value,
    reason: req.body.reason,
    actorId: req.user.id,
  });
  res.json(result);
});
```

## Deterministic Workflow Testing Harness

Test workflows with scripted step outcomes:

```typescript
import {
  createWorkflowHarness,
  createMockFn,
  createTestClock,
  createSnapshot,
  compareSnapshots,
  okOutcome,
  errOutcome,
} from 'awaitly/testing';

// Create test harness
const harness = createWorkflowHarness(
  { fetchUser, chargeCard },
  { clock: createTestClock().now }
);

// Script step outcomes
harness.script([
  okOutcome({ id: '1', name: 'Alice' }),
  okOutcome({ transactionId: 'tx_123' }),
]);

// Or script specific steps by name
harness.scriptStep('fetch-user', okOutcome({ id: '1', name: 'Alice' }));
harness.scriptStep('charge-card', errOutcome('CARD_DECLINED'));

// Run workflow
const result = await harness.run(async (step, { fetchUser, chargeCard }) => {
  const user = await step(() => fetchUser('1'), 'fetch-user');
  const charge = await step(() => chargeCard(100), 'charge-card');
  return { user, charge };
});

// Assert results
expect(result.ok).toBe(false);
expect(harness.assertSteps(['fetch-user', 'charge-card']).passed).toBe(true);
expect(harness.assertStepCalled('fetch-user').passed).toBe(true);
expect(harness.assertStepNotCalled('refund').passed).toBe(true);

// Get invocation details
const invocations = harness.getInvocations();
console.log(invocations[0].name);      // 'fetch-user'
console.log(invocations[0].durationMs); // 0 (deterministic clock)
console.log(invocations[0].result);     // { ok: true, value: { id: '1', name: 'Alice' } }

// Reset for next test
harness.reset();
```

### Mock Functions

```typescript
import { createMockFn } from 'awaitly/testing'; import { ok, err } from 'awaitly';

const fetchUser = createMockFn<User, 'NOT_FOUND'>();

// Set default return
fetchUser.returns(ok({ id: '1', name: 'Alice' }));

// Or queue return values
fetchUser.returnsOnce(ok({ id: '1', name: 'Alice' }));
fetchUser.returnsOnce(err('NOT_FOUND'));

// Check calls
console.log(fetchUser.getCallCount());  // 2
console.log(fetchUser.getCalls());      // [[arg1], [arg2]]

fetchUser.reset();
```

### Snapshot Testing

```typescript
import { createSnapshot, compareSnapshots } from 'awaitly/testing';

// Create snapshot from a run (events are optional, from external sources)
const snapshot1 = createSnapshot(
  harness.getInvocations(),
  result
);

// Run again and compare
harness.reset();
harness.script([...newOutcomes]); // script() resets state automatically
const result2 = await harness.run(workflowFn);
const snapshot2 = createSnapshot(harness.getInvocations(), result2);

const { equal, differences } = compareSnapshots(snapshot1, snapshot2);
if (!equal) {
  console.log('Differences:', differences);
}
```

## OpenTelemetry Integration (Autotel)

First-class OpenTelemetry metrics from the event stream:

```typescript
import { createAutotelAdapter, createAutotelEventHandler, withAutotelTracing } from 'awaitly/otel';

// Create an adapter that tracks metrics
const autotel = createAutotelAdapter({
  serviceName: 'checkout-service',
  createStepSpans: true,        // Create spans for each step
  recordMetrics: true,          // Record step metrics
  recordRetryEvents: true,      // Record retry events
  markErrorsOnSpan: true,       // Mark errors on spans
  defaultAttributes: {          // Custom attributes for all spans
    environment: 'production',
  },
});

// Use adapter's handleEvent directly with workflow
const workflow = createWorkflow(deps, {
  onEvent: autotel.handleEvent,
});

// Access collected metrics
const metrics = autotel.getMetrics();
console.log(metrics.stepDurations);  // Array of { name, durationMs, success }
console.log(metrics.retryCount);     // Total retry count
console.log(metrics.errorCount);     // Total error count
console.log(metrics.cacheHits);      // Cache hit count
console.log(metrics.cacheMisses);    // Cache miss count

// Or use the simpler event handler for debug logging
const workflow2 = createWorkflow(deps, {
  onEvent: createAutotelEventHandler({ 
    serviceName: 'checkout',
    includeStepDetails: true,
  }),
});
// Set AUTOTEL_DEBUG=true to see console output

// Wrap with autotel tracing for actual OpenTelemetry spans
import { trace } from 'autotel';

const traced = withAutotelTracing(trace, { serviceName: 'checkout' });

const result = await traced('process-order', async () => {
  return workflow(async (step) => {
    // ... workflow logic
  });
}, { orderId: '123' }); // Optional attributes
```
