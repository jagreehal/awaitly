# awaitly vs Workflow DevKit: In-Depth Comparison

This document provides a comprehensive comparison between **awaitly** and **Vercel's Workflow DevKit** (useworkflow.dev), analyzing their capabilities, design philosophies, and feature parity.

## Executive Summary

**awaitly** is a more comprehensive, flexible, and type-safe workflow orchestration library that can achieve everything Workflow DevKit does, plus significantly more. While Workflow DevKit focuses on a specific "workflow function" + "step function" model with sandboxing, awaitly provides a more general-purpose approach with superior type safety, composability, and feature richness.

---

## Core Architecture Comparison

### Workflow DevKit

**Two-Function Model:**
- **Workflow Functions** (`"use workflow"`): Sandboxed orchestration layer
  - Limited Node.js runtime access
  - Must be deterministic
  - Runs in isolated environment
  - Uses event sourcing for replay
  
- **Step Functions** (`"use step"`): Full runtime access
  - Complete Node.js and npm access
  - Automatic retry (3 attempts default)
  - Results persisted for replay

**Key Constraint:** Workflow functions are sandboxed and cannot use arbitrary npm packages or Node.js APIs. This is intentional to ensure determinism for replay.

### awaitly

**Unified Step Model:**
- **`createWorkflow()`**: Creates a workflow with automatic error type inference
- **`step()`**: Executes operations with full runtime access
- **No sandboxing**: All code runs in normal Node.js environment
- **Determinism through design**: Achieved via Result types, explicit state management, and resume state

**Key Advantage:** No artificial runtime restrictions. You can use any npm package, any Node.js API, anywhere in your workflow code.

---

## Feature-by-Feature Comparison

### 1. Workflow Definition & Execution

#### Workflow DevKit

```typescript
export async function processOrderWorkflow(orderId: string) {
  "use workflow";
  
  const order = await fetchOrder(orderId);
  const payment = await chargePayment(order);
  return { orderId, status: "completed" };
}

async function fetchOrder(orderId: string) {
  "use step";
  // Full Node.js access
  return await db.orders.find(orderId);
}
```

**Characteristics:**
- Requires `"use workflow"` directive
- Step functions must be separate functions with `"use step"` directive
- Workflow function cannot use arbitrary npm packages
- Step functions can be called outside workflows (runs as normal function)

#### awaitly

```typescript
const processOrder = createWorkflow(
  { fetchOrder, chargePayment },
  { /* options */ }
);

const result = await processOrder(async (step, { fetchOrder, chargePayment }) => {
  const order = await step(() => fetchOrder(orderId));
  const payment = await step(() => chargePayment(order));
  return { orderId, status: "completed" };
});
```

**Characteristics:**
- No directives needed
- Steps can be inline or extracted functions
- Full Node.js access everywhere
- Automatic error type inference from dependencies
- Type-safe error handling

**Verdict:** awaitly is more flexible and type-safe. Workflow DevKit's sandboxing is a constraint that awaitly doesn't need.

---

### 2. Suspension and Resumption

#### Workflow DevKit

**Automatic Suspension:**
- Waiting on a step function → workflow suspends
- Using `sleep()` → workflow suspends
- Awaiting `createWebhook()` → workflow suspends

**Resumption:**
- Automatic via event log replay
- State stored via event sourcing
- No compute resources used while suspended

```typescript
import { sleep, createWebhook } from "workflow";

export async function documentReviewProcess(userId: string) {
  "use workflow";
  
  await sleep("1 month"); // Suspends without consuming resources
  
  const webhook = createWebhook();
  await sendHumanApprovalEmail("Click this link", webhook.url);
  const data = await webhook; // Suspends until URL is resumed
}
```

#### awaitly

**Explicit State Management:**
- Steps with `key` option are cached
- Resume state collected via `createResumeStateCollector()`
- Manual persistence via `durable.run()` or custom persistence
- State can be saved/loaded from any storage backend

```typescript
// Collect state during execution
const collector = createResumeStateCollector();
const workflow = createWorkflow({ fetchOrder }, {
  onEvent: collector.handleEvent,
});

await workflow(async (step) => {
  const order = await step(() => fetchOrder(orderId), { key: "order:123" });
  // ... more steps
});

// Save state
const state = collector.getResumeState();
await db.saveWorkflowState(workflowId, state);

// Resume later
const savedState = await db.loadWorkflowState(workflowId);
const workflow2 = createWorkflow({ fetchOrder }, {
  resumeState: savedState,
});
```

**With Durable Execution:**
```typescript
import { durable } from "awaitly/durable";

const result = await durable.run(
  { fetchOrder, chargePayment },
  async (step, { fetchOrder, chargePayment }) => {
    const order = await step(() => fetchOrder(orderId), { key: "order:123" });
    const payment = await step(() => chargePayment(order), { key: "payment:123" });
    return payment;
  },
  {
    id: "order-123",
    store: myStateStore, // Automatic checkpointing after each keyed step
    version: 1,
  }
);
```

**Verdict:** awaitly provides more control and flexibility. Workflow DevKit's automatic suspension is convenient but less flexible. awaitly's explicit state management allows for custom persistence strategies, versioning, and more sophisticated resume logic.

---

### 3. Error Handling & Retries

#### Workflow DevKit

**Default Behavior:**
- Steps automatically retry 3 times on error
- Errors propagate to workflow function
- Workflow function can use try/catch

**Limitations:**
- Fixed 3 retry attempts (configurable per step)
- No composable retry strategies
- Limited error type information

```typescript
async function chargePayment(order: Order) {
  "use step";
  // Automatically retries 3 times on error
  const charge = await stripe.charges.create({...});
  return { chargeId: charge.id };
}
```

#### awaitly

**Comprehensive Error Handling:**
- **Result types**: Type-safe error handling without try/catch
- **Automatic error inference**: Error types extracted from function signatures
- **Composable retry strategies**: Using `Schedule` module
- **Flexible retry options**: Per-step configuration

```typescript
// Type-safe error handling
const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND" | "NETWORK_ERROR"> => {
  // ...
};

const workflow = createWorkflow({ fetchUser, fetchPosts });
// Error type automatically inferred: "NOT_FOUND" | "NETWORK_ERROR" | UnexpectedError

// Composable retry with Schedule
import { Schedule, Duration } from "awaitly";

const retryStrategy = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.jittered(0.2))
  .pipe(Schedule.upTo(5))
  .pipe(Schedule.maxDelay(Duration.seconds(30)));

await workflow(async (step) => {
  const user = await step.retry(
    () => fetchUser("1"),
    { schedule: retryStrategy, key: "user:1" }
  );
});
```

**Verdict:** awaitly's error handling is significantly more powerful with type safety, composable retry strategies, and explicit error types. Workflow DevKit's automatic retries are simpler but less flexible.

---

### 4. Scheduling & Delays

#### Workflow DevKit

**Built-in `sleep()`:**
```typescript
import { sleep } from "workflow";

await sleep("1 month"); // Suspends workflow
```

**Characteristics:**
- Simple string-based duration parsing
- Workflow suspends during sleep
- No compute resources used

#### awaitly

**Composable Schedule Module:**
```typescript
import { Schedule, Duration } from "awaitly";

// Simple delay
await new Promise(resolve => setTimeout(resolve, Duration.toMillis(Duration.minutes(5))));

// Composable schedules for retries/polling
const pollStrategy = Schedule.exponential(Duration.millis(100))
  .pipe(Schedule.jittered(0.2))
  .pipe(Schedule.upTo(5))
  .pipe(Schedule.andThen(Schedule.spaced(Duration.minutes(1)))); // Then poll every minute

// Use with step.retry
await step.retry(() => checkStatus(), { schedule: pollStrategy });
```

**With Durable Execution:**
- Sleep can be implemented by saving state and resuming later
- Or use external scheduling (cron, queue systems) to trigger resume

**Verdict:** Workflow DevKit's `sleep()` is simpler for basic delays, but awaitly's Schedule module is far more powerful for complex retry/polling strategies. awaitly can achieve the same suspension effect through durable execution.

---

### 5. Webhooks & External Triggers

#### Workflow DevKit

**Built-in Webhooks:**
```typescript
import { createWebhook } from "workflow";

export async function approvalWorkflow() {
  "use workflow";
  
  const webhook = createWebhook();
  await sendEmail("Click here", webhook.url);
  const data = await webhook; // Suspends until webhook is called
  return data;
}
```

**Characteristics:**
- Automatic webhook URL generation
- Workflow suspends until webhook is called
- Integrated with workflow runtime

#### awaitly

**Webhook Adapters:**
```typescript
import { createWebhookHandler } from "awaitly/webhook";

// Create HTTP handler for any framework
const handler = createWebhookHandler({
  validateInput: (req) => {
    // Validate request
    return ok({ orderId: req.body.orderId });
  },
  mapResult: (result, req) => {
    // Map workflow result to HTTP response
    return { status: result.ok ? 200 : 400, body: result };
  },
}, workflow);

// Use with Express, Hono, Fastify, etc.
app.post("/api/process", handler);
```

**For Workflow Resumption:**
```typescript
// Workflow pauses on approval step
const result = await workflow(async (step) => {
  const approval = await step(requireApproval, { key: "approval:123" });
  // Returns PendingApproval error if not approved
});

// External webhook handler receives approval
app.post("/api/approve/:stepKey", async (req, res) => {
  const state = await loadWorkflowState(workflowId);
  const updatedState = injectApproval(state, {
    stepKey: req.params.stepKey,
    value: { approvedBy: req.user.id },
  });
  
  // Resume workflow
  await resumeWorkflow(workflowId, updatedState);
});
```

**Verdict:** Workflow DevKit's webhook integration is more seamless for simple cases, but awaitly's approach is more flexible and framework-agnostic. awaitly can achieve the same functionality with more control.

---

### 6. Human-in-the-Loop (HITL)

#### Workflow DevKit

**Basic Support:**
- Use `createWebhook()` for approval flows
- Manual state management required
- No built-in approval tracking

#### awaitly

**Comprehensive HITL Support:**

```typescript
import { createApprovalStep, injectApproval } from "awaitly/workflow";
import { createHITLOrchestrator } from "awaitly/hitl";

// Create approval step
const requireManagerApproval = createApprovalStep<{ approvedBy: string }>({
  key: "manager-approval",
  checkApproval: async () => {
    const approval = await db.getApproval("manager-approval");
    if (!approval) return { status: "pending" };
    if (approval.rejected) return { status: "rejected", reason: approval.reason };
    return { status: "approved", value: { approvedBy: approval.approvedBy } };
  },
});

// Use in workflow
const workflow = createWorkflow({ requireManagerApproval });
const result = await workflow(async (step) => {
  const approval = await step(requireManagerApproval, { key: "manager-approval" });
  // Workflow pauses if pending
});

// Production-ready orchestrator
const orchestrator = createHITLOrchestrator({
  workflowFactory: (options) => createWorkflow({ requireApproval }, options),
  approvalStore: myApprovalStore,
  notificationChannel: slackChannel, // Or email, UI, etc.
});

// Poll for approvals and resume workflows
await orchestrator.pollAndResume();
```

**Features:**
- `createApprovalStep()`: Standardized approval steps
- `gatedStep()`: Pre-execution approval (AI SDK style)
- `createApprovalStateCollector()`: Track pending approvals
- `injectApproval()`: Resume with approval
- `createHITLOrchestrator()`: Production-ready polling/resume system
- Notification channels (Slack, email, etc.)
- Approval editing support

**Verdict:** awaitly has significantly more comprehensive HITL support with production-ready tooling. Workflow DevKit requires manual implementation.

---

### 7. Serialization & Pass-by-Value

#### Workflow DevKit

**Automatic Serialization:**
- Uses custom serialization system (devalue)
- Supports JSON types + extended types (Date, Map, Set, URL, etc.)
- Request/Response objects supported
- ReadableStream/WritableStream supported
- **Pass-by-value semantics**: Mutations in steps don't affect workflow

```typescript
export async function updateUserWorkflow(userId: string) {
  "use workflow";
  let user = { id: userId, name: "John" };
  user = await updateUserStep(user); // Must reassign - pass-by-value
}

async function updateUserStep(user: User) {
  "use step";
  user.name = "Jane"; // Mutation lost unless returned
  return user; // Must return modified data
}
```

**Characteristics:**
- Automatic serialization for all step inputs/outputs
- Built-in fetch in workflow context (wrapped as step)
- Streaming support for AI/file processing

#### awaitly

**Flexible Serialization:**
- No automatic serialization (runs in normal Node.js)
- Use standard JSON serialization for persistence
- Custom serialization via `StatePersistence` interface
- Full control over what gets serialized

```typescript
// Normal JavaScript - no serialization constraints
const workflow = createWorkflow({ updateUser });
await workflow(async (step) => {
  let user = { id: "123", name: "John" };
  user = await step(() => updateUser(user)); // Standard JavaScript behavior
  // Can mutate if needed (though not recommended for resume state)
});
```

**For State Persistence:**
```typescript
// Custom serialization via StatePersistence
const store = createFileStatePersistence("./workflows", {
  serialize: (state) => JSON.stringify(state, customReplacer),
  deserialize: (data) => JSON.parse(data, customReviver),
});
```

**Verdict:** Workflow DevKit's automatic serialization is convenient but constraining. awaitly gives you full control - use standard JavaScript semantics, and only serialize what you need for persistence. More flexible, but requires explicit serialization for state persistence.

---

### 8. Idempotency

#### Workflow DevKit

**Step ID as Idempotency Key:**
```typescript
import { getStepMetadata } from "workflow";

async function chargeUser(userId: string, amount: number) {
  "use step";
  const { stepId } = getStepMetadata();
  
  await stripe.charges.create({
    amount,
    customer: userId,
  }, {
    idempotencyKey: stepId, // Stable across retries
  });
}
```

**Characteristics:**
- `stepId` is stable across retries
- Globally unique per step
- Built-in metadata access

#### awaitly

**Step Keys for Idempotency:**
```typescript
// Use step key as idempotency key
await workflow(async (step) => {
  const charge = await step(
    () => chargeUser(userId, amount),
    { key: `charge:${userId}:${amount}` } // Stable key
  );
});

// In chargeUser function, use the key
async function chargeUser(userId: string, amount: number) {
  // The key is available in step options or can be passed explicitly
  const idempotencyKey = `charge:${userId}:${amount}`;
  
  await stripe.charges.create({
    amount,
    customer: userId,
  }, {
    idempotencyKey,
  });
}
```

**With Step Caching:**
```typescript
// Steps with keys are automatically cached (idempotent)
await workflow(async (step) => {
  // First call executes
  const user1 = await step(() => fetchUser("1"), { key: "user:1" });
  // Second call uses cache (idempotent)
  const user2 = await step(() => fetchUser("1"), { key: "user:1" });
  // user1 === user2 (same result, no duplicate API call)
});
```

**Verdict:** Both support idempotency well. Workflow DevKit's `getStepMetadata().stepId` is convenient, but awaitly's explicit step keys provide more control and enable automatic caching/idempotency.

---

### 9. State Persistence & Durability

#### Workflow DevKit

**Event Sourcing:**
- All step results stored in event log
- Automatic replay from event log
- Built into runtime

**Characteristics:**
- Opaque persistence mechanism
- Automatic state management
- Less control over storage backend

#### awaitly

**Flexible Persistence:**

```typescript
import { durable } from "awaitly/durable";
import { createFileStatePersistence } from "awaitly/persistence";

const store = createFileStatePersistence("./workflows");

const result = await durable.run(
  { fetchOrder, chargePayment },
  async (step, deps) => {
    const order = await step(() => deps.fetchOrder(id), { key: "order:123" });
    const payment = await step(() => deps.chargePayment(order), { key: "payment:123" });
    return payment;
  },
  {
    id: "order-123",
    store,
    version: 1, // Version checking
    allowConcurrent: false, // Concurrency control
  }
);
```

**Features:**
- **Multiple storage backends**: File, memory, database, Redis, S3, etc.
- **Version checking**: Reject resume if workflow logic changed
- **Concurrency control**: Prevent duplicate executions
- **Manual control**: Save/load state anywhere in your code
- **Metadata support**: Attach custom metadata to workflow state
- **Automatic checkpointing**: After each keyed step

**Storage Options:**
- `createMemoryStatePersistence()`: In-memory (testing)
- `createFileStatePersistence()`: File system
- Custom implementations for any backend

**Verdict:** awaitly provides significantly more flexibility and control over state persistence. You can use any storage backend, implement custom serialization, and have full control over when/how state is saved.

---

### 10. Type Safety

#### Workflow DevKit

**Limited Type Safety:**
- Step functions have full TypeScript support
- Workflow functions have limited type inference
- Error types not automatically inferred
- Pass-by-value semantics (serialization requirement)

```typescript
// Error types must be manually tracked
export async function processOrderWorkflow(orderId: string) {
  "use workflow";
  const order = await fetchOrder(orderId); // What errors can this return?
  // TypeScript doesn't know
}
```

#### awaitly

**Comprehensive Type Safety:**

```typescript
// Error types automatically inferred
const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => {
  // ...
};

const fetchPosts = async (userId: string): AsyncResult<Post[], "FETCH_ERROR"> => {
  // ...
};

const workflow = createWorkflow({ fetchUser, fetchPosts });
// Error type: "NOT_FOUND" | "FETCH_ERROR" | UnexpectedError

const result = await workflow(async (step) => {
  const user = await step(fetchUser("1")); // TypeScript knows this can return "NOT_FOUND"
  const posts = await step(fetchPosts(user.id)); // TypeScript knows this can return "FETCH_ERROR"
  return { user, posts };
});

// TypeScript forces you to handle all errors
if (!result.ok) {
  // result.error is: "NOT_FOUND" | "FETCH_ERROR" | UnexpectedError
  switch (result.error) {
    case "NOT_FOUND":
      // ...
    case "FETCH_ERROR":
      // ...
    // TypeScript ensures all cases are handled
  }
}
```

**Strict Mode:**
```typescript
const workflow = createWorkflow(
  { fetchUser, fetchPosts },
  {
    strict: true,
    catchUnexpected: () => "UNEXPECTED" as const,
  }
);
// Error type: "NOT_FOUND" | "FETCH_ERROR" | "UNEXPECTED" (closed union)
```

**Verdict:** awaitly's type safety is significantly superior. Automatic error type inference, strict mode for closed error unions, and Result types provide compile-time guarantees that Workflow DevKit cannot match.

---

### 11. Observability & Events

#### Workflow DevKit

**Built-in Observability:**
- Event log for all workflow/step events
- Integration with observability platforms
- Automatic event emission

#### awaitly

**Comprehensive Event System:**

```typescript
const workflow = createWorkflow({ fetchUser }, {
  onEvent: (event, ctx) => {
    switch (event.type) {
      case "workflow_start":
        console.log(`Workflow ${event.workflowId} started`);
        break;
      case "step_start":
        console.log(`Step ${event.name} started`);
        break;
      case "step_success":
        console.log(`Step ${event.name} completed in ${event.durationMs}ms`);
        break;
      case "step_error":
        console.error(`Step ${event.name} failed:`, event.error);
        break;
      case "step_complete":
        // Includes result, metadata, duration
        break;
      case "workflow_success":
      case "workflow_error":
      case "workflow_cancelled":
        // ...
    }
  },
  onError: (error, stepName, ctx) => {
    // Error logging
  },
});
```

**Event Types:**
- `workflow_start`, `workflow_success`, `workflow_error`, `workflow_cancelled`
- `step_start`, `step_success`, `step_error`, `step_complete`
- `step_cache_hit`, `step_cache_miss`
- `hook_should_run`, `hook_before_start`, `hook_after_step`
- `persist_success`, `persist_error` (durable execution)

**Verdict:** Both provide good observability. awaitly's event system is more comprehensive with more event types and better integration points.

---

### 12. Additional Features

#### Workflow DevKit

- Basic workflow/step model
- Automatic retries
- Sleep/delays
- Webhooks
- Event sourcing

#### awaitly

**Significantly More Features:**

1. **Circuit Breaker Pattern** (`awaitly/circuit-breaker`)
   ```typescript
   const breaker = createCircuitBreaker(fetchData, {
     failureThreshold: 5,
     resetTimeout: Duration.seconds(30),
   });
   ```

2. **Rate Limiting** (`awaitly/ratelimit`)
   ```typescript
   const limiter = createRateLimiter({ max: 100, window: Duration.minutes(1) });
   ```

3. **Saga Pattern** (`awaitly/saga`)
   ```typescript
   const saga = createSaga({
     steps: [reserveInventory, chargePayment, shipOrder],
     compensations: [releaseInventory, refundPayment, cancelShipment],
   });
   ```

4. **Single Flight** (`awaitly/singleflight`)
   ```typescript
   const flight = createSingleFlight();
   const result = await flight.do("key", () => expensiveOperation());
   ```

5. **Batch Operations** (`awaitly/batch`)
   ```typescript
   const batch = createBatch({ maxSize: 100, maxWait: Duration.seconds(5) });
   ```

6. **Conditional Helpers** (`awaitly/conditional`)
   ```typescript
   const result = await conditional(condition, {
     then: () => stepA(),
     else: () => stepB(),
   });
   ```

7. **Pattern Matching** (`awaitly/match`)
   ```typescript
   const result = match(value, {
     "NOT_FOUND": () => handleNotFound(),
     "NETWORK_ERROR": (err) => handleNetworkError(err),
     _: () => handleDefault(),
   });
   ```

8. **Tagged Errors** (`awaitly/tagged-error`)
   ```typescript
   class NotFoundError extends TaggedError<"NOT_FOUND"> {}
   ```

9. **Testing Utilities** (`awaitly/testing`)
   ```typescript
   const mockStep = createMockStep();
   ```

10. **Visualization** (`awaitly/visualize`)
    - Mermaid diagram generation
    - HTML visualizer
    - Logger renderer

**Verdict:** awaitly is a comprehensive workflow and reliability library with many additional patterns and utilities. Workflow DevKit is more focused on the core workflow execution model.

---

## Use Case Comparison

### When to Use Workflow DevKit

- Simple workflow orchestration needs
- Want automatic state management without thinking about it
- Prefer opinionated, less flexible approach
- Vercel deployment (tight integration)
- Don't need advanced features (circuit breakers, sagas, etc.)

### When to Use awaitly

- Need type-safe error handling
- Want control over state persistence backend
- Need advanced reliability patterns (circuit breakers, rate limiting, sagas)
- Building complex, production-grade workflows
- Want composable retry strategies
- Need human-in-the-loop workflows
- Want framework-agnostic webhook handlers
- Need visualization and debugging tools
- Want to use any npm package in workflows
- Need version checking and concurrency control

---

## Conclusion

**awaitly can do everything Workflow DevKit can do, plus significantly more:**

✅ **Feature Parity:**
- ✅ Workflow orchestration
- ✅ Step execution with retries
- ✅ State persistence and resume
- ✅ Suspension/resumption
- ✅ Webhooks (via webhook adapters)
- ✅ Human-in-the-loop (more comprehensive)
- ✅ Scheduling/delays (via Schedule module + durable execution)

✅ **Superior Features:**
- ✅ Type-safe error handling with automatic inference
- ✅ Composable retry strategies (Schedule module)
- ✅ Multiple persistence backends
- ✅ Version checking and concurrency control
- ✅ Circuit breakers, rate limiting, sagas
- ✅ No runtime restrictions (full Node.js access)
- ✅ Framework-agnostic webhook handlers
- ✅ Production-ready HITL orchestrator
- ✅ Visualization tools
- ✅ Testing utilities

**Workflow DevKit Advantages:**
- Simpler API for basic use cases
- Automatic suspension (no manual state management)
- Tight Vercel integration
- Less code for simple workflows

**awaitly Advantages:**
- More flexible and powerful
- Better type safety
- More features and patterns
- Production-ready tooling
- Framework-agnostic
- Full control over execution and persistence

---

## Migration Path

If you're using Workflow DevKit and want to migrate to awaitly:

1. **Replace workflow functions** with `createWorkflow()`
2. **Replace step functions** with `step()` calls
3. **Add explicit state management** using `createResumeStateCollector()` or `durable.run()`
4. **Replace `sleep()`** with durable execution + external scheduling, or use `Schedule` for retries
5. **Replace `createWebhook()`** with `createWebhookHandler()` + approval steps
6. **Gain type safety** - error types automatically inferred
7. **Add advanced features** as needed (circuit breakers, rate limiting, etc.)

The migration is straightforward, and you'll gain significant benefits in type safety, flexibility, and feature richness.

---

## Final Verdict

**awaitly is a more comprehensive, flexible, and type-safe solution** that can achieve everything Workflow DevKit does, plus much more. While Workflow DevKit is simpler for basic use cases, awaitly provides the tools and patterns needed for production-grade workflow orchestration with superior developer experience and type safety.

If you're building serious workflow systems, awaitly is the better choice.
