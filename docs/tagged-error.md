# TaggedError

Factory for creating tagged error classes with exhaustive pattern matching and `instanceof` support.

## The Problem: Error Union Explosion

You start with a clean workflow:

```typescript
type WorkflowError = UserNotFound | InsufficientFunds;
```

Then reality hits. Your `fetchUser` function uses an HTTP client that can fail in 15 different ways. Your payment service has its own error taxonomy. Suddenly:

```typescript
// ❌ What your workflow error type becomes
type WorkflowError =
  | UserNotFound
  | InsufficientFunds
  | ECONNRESET
  | ETIMEDOUT
  | ENOTFOUND
  | TLSHandshakeError
  | DNSLookupFailed
  | JsonParseError
  | SQLDeadlock
  | ConnectionPoolExhausted
  | HTTPError
  | TimeoutError
  | RetryExhausted      // ← even reliability primitives add variants!
  | CircuitBreakerOpen
  | ...;
```

Notice how even reliability mechanisms (retry exhaustion, circuit breakers) add variants if modeled as distinct errors--another reason to collapse. Policy errors are still "infrastructure noise" at the workflow layer unless business logic needs to distinguish them.

This union:

- **Changes constantly** - every dependency update can add/remove variants
- **Leaks implementation details** - callers shouldn't know you use PostgreSQL
- **Forces exhaustive handling of noise** - do you really need different logic for DNS vs TLS failures?

## The Solution: Error Layering

Layer your errors into **adapter** and **domain** tiers:

```text
┌─────────────────────────────────────────────────────────────┐
│  Workflow Layer                                             │
│  UserNotFound | InsufficientFunds | DependencyFailed        │
│  (small, stable, meaningful)                                │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │ collapses into
┌─────────────────────────────────────────────────────────────┐
│  Adapter Layer                                              │
│  HTTP errors, DB errors, parsing errors, timeouts...        │
│  (messy, unstable, implementation details)                  │
└─────────────────────────────────────────────────────────────┘
```

- **Domain errors** = business meaning (what went wrong for the user)
- **Adapter errors** = infrastructure collapsed into stable buckets + metadata

Your workflow sees a **stable, small union**. Low-level chaos stays contained in adapters.

## Basic Usage

```typescript
import { TaggedError } from 'awaitly';

// Pattern 1: Props via generic (message defaults to tag name)
class UserNotFound extends TaggedError("UserNotFound")<{
  userId: string;
}> {}

// Pattern 2: Props inferred from message callback
class InsufficientFunds extends TaggedError("InsufficientFunds", {
  message: (p: { required: number; available: number }) =>
    `Need ${p.required}, have ${p.available}`,
}) {}

// Create instances
const error = new UserNotFound({ userId: "123" });
error._tag;    // "UserNotFound"
error.userId;  // "123"
error.message; // "UserNotFound"

// instanceof works
error instanceof TaggedError;  // true
error instanceof Error;        // true
```

## Defining Your Error Layers

### Domain Errors (Business Rules)

These represent **what went wrong from a business perspective**. They're stable because business rules change slowly.

```typescript
// Domain errors - meaningful to your business logic
class UserNotFound extends TaggedError("UserNotFound")<{
  userId: string;
}> {}

class InsufficientFunds extends TaggedError("InsufficientFunds")<{
  required: number;
  available: number;
}> {}

class TransferLimitExceeded extends TaggedError("TransferLimitExceeded")<{
  limit: number;
  attempted: number;
}> {}

class AccountFrozen extends TaggedError("AccountFrozen")<{
  userId: string;
  reason: string;
}> {}

class TransferFailed extends TaggedError("TransferFailed")<{
  reason: string;
}> {}
```

### Adapter Errors (Infrastructure Boundary)

These **absorb infrastructure chaos** into stable categories. When your HTTP library adds a new error type, only the adapter changes.

```typescript
// Adapter error - collapses many low-level failures into one
class DependencyFailed extends TaggedError("DependencyFailed")<{
  service: "users" | "payments" | "notifications";
  operation: string;
  kind: "timeout" | "network" | "rate_limit" | "bad_response" | "unknown";
  retryable: boolean;
  retryAfterMs?: number;
  statusCode?: number;    // HTTP status if available
  cause?: unknown;        // preserve original for logging
}> {}
```

**What to include in `DependencyFailed`:**

- `service` (stable identifier: string union for apps, string for libraries)
- `operation` (stable identifier: the function/method name)
- `retryable` + optional `retryAfterMs` (for retry logic)
- `cause` (original error, internal only - never return to clients)
- Optional `statusCode` / `vendorCode` if it helps dashboards/alerting

Many adapters can share the same `DependencyFailed` type; you don't need one per dependency.

**Adapter helper function (recommended):**

Create a single factory function for consistent error creation across all adapters:

```typescript
// Classify raw errors into stable categories
function classifyError(e: unknown): DependencyFailed["kind"] {
  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("etimedout")) return "timeout";
    if (msg.includes("econnreset") || msg.includes("network")) return "network";
    if (msg.includes("rate") || msg.includes("429")) return "rate_limit";
  }
  if (e && typeof e === "object" && "status" in e) {
    const status = (e as { status: number }).status;
    if (status === 429) return "rate_limit";
    if (status >= 400 && status < 500) return "bad_response";
  }
  return "unknown";
}

// Single factory for all adapters
function dependencyFailed(
  service: DependencyFailed["service"],
  operation: string,
  e: unknown
): DependencyFailed {
  const kind = classifyError(e);
  return new DependencyFailed({
    service,
    operation,
    kind,
    retryable: kind === "timeout" || kind === "network" || kind === "rate_limit",
    retryAfterMs: kind === "rate_limit" ? extractRetryAfter(e) : undefined,
    statusCode: extractStatusCode(e),
    cause: e,
  });
}

// Usage in adapters becomes one-liners
async function fetchUser(userId: string): AsyncResult<User, UserNotFound | DependencyFailed> {
  try {
    const response = await httpClient.get(`/users/${userId}`);
    if (response.status === 404) return err(new UserNotFound({ userId }));
    return ok(response.data as User);
  } catch (e) {
    return err(dependencyFailed("users", "fetchUser", e));
  }
}
```

This keeps error classification logic in one place--update `classifyError()` when you add new error patterns.

**Catch-all for unexpected failures**

```typescript
class UnexpectedError extends TaggedError("UnexpectedError")<{
  context: string;
  cause?: unknown;
}> {}
```

**Choosing `service` type:**

- **String union** (recommended for applications): `service: "users" | "payments"` gives exhaustive matching and autocomplete. Add services as your app grows.
- **Plain string** (for libraries/frameworks): `service: string` when you can't know all consumers.

Examples below use both forms depending on context.

**Boundary mapping reference:**

| Infrastructure failure | Maps to |
| --- | --- |
| HTTP 404 | Domain error (e.g., `UserNotFound`) |
| HTTP 429 (rate limit) | `DependencyFailed { retryable: true, retryAfterMs }` |
| HTTP 5xx / network timeout | `DependencyFailed { retryable: true }` |
| Parse error / validation | `DependencyFailed { retryable: false }` |
| Unknown / unexpected | `UnexpectedError` |

### Your Workflow Union Stays Small

```typescript
// ✅ This is your entire error algebra
type TransferError =
  | UserNotFound
  | InsufficientFunds
  | TransferLimitExceeded
  | AccountFrozen
  | DependencyFailed
  | UnexpectedError;
```

Four domain concepts + one adapter bucket + one catch-all. **Stable over time.**

## Building Adapters

Adapters are where you **map library errors to your stable types**. This is the only place that knows about implementation details.

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

// Types the adapter exposes
type UserServiceError = UserNotFound | DependencyFailed;

// The adapter function
async function fetchUser(
  userId: string
): AsyncResult<User, UserServiceError> {
  try {
    const response = await httpClient.get(`/users/${userId}`);

    if (response.status === 404) {
      return err(new UserNotFound({ userId }));
    }

    // If decoding can fail, treat decode failures as DependencyFailed { retryable: false }
    // (or a domain InvalidResponse if you care about distinguishing validation errors)
    return ok(response.data as User);
  } catch (e) {
    // Collapse ALL HTTP failures into DependencyFailed
    return err(new DependencyFailed({
      service: "users",
      operation: "fetchUser",
      retryable: isRetryable(e),
      cause: e,
    }));
  }
}

// Prefer structured error fields from your HTTP client over string matching
function isRetryable(e: unknown): boolean {
  // Best: use typed error classes from your HTTP library
  if (e instanceof HttpError) {
    return e.status >= 500 || e.status === 429;
  }
  if (e instanceof NetworkError) {
    return true;  // ECONNRESET, ETIMEDOUT, etc.
  }
  // Fallback: string matching (last resort)
  if (e instanceof Error && e.message) {
    return /ECONNRESET|ETIMEDOUT|503/.test(e.message);
  }
  return false;
}
```

### Why This Matters

Tomorrow, your HTTP library releases v2 with 5 new error types. **Your change is isolated:**

```diff
// Only the adapter changes
function isRetryable(e: unknown): boolean {
+  if (e instanceof HTTPLibraryV2.RateLimitError) return true;
+  if (e instanceof HTTPLibraryV2.CircuitBreakerError) return false;
   // ... rest unchanged
}
```

Your workflow types? **Untouched.** Every call site? **Untouched.**

## Integration with Workflows

Use adapters as workflow dependencies:

```typescript
import { createWorkflow, ok, err, type AsyncResult } from 'awaitly';

const deps = {
  fetchUser,        // Returns AsyncResult<User, UserNotFound | DependencyFailed>
  fetchBalance,     // Returns AsyncResult<Balance, DependencyFailed>
  executeTransfer,  // Returns AsyncResult<TxId, TransferFailed | DependencyFailed>
};

const transferMoney = createWorkflow(deps);

// Signature: transferMoney(args, executor) or transferMoney(executor)
// When called with args: executor(step, deps, args) => Result<Output, Error>
// When called without args: executor(step, deps) => Result<Output, Error>

const result = await transferMoney(
  { fromId: "alice", toId: "bob", amount: 100 },
  async (step, { fetchUser, fetchBalance, executeTransfer }, args) => {
    // Domain validation
    const sender = await step(fetchUser(args.fromId));
    const recipient = await step(fetchUser(args.toId));
    const balance = await step(fetchBalance(args.fromId));

    // Business rule
    if (balance.available < args.amount) {
      return err(new InsufficientFunds({
        required: args.amount,
        available: balance.available,
      }));
    }

    // Execute
    const txId = await step(executeTransfer(sender, recipient, args.amount));
    return ok({ txId, amount: args.amount });
  }
);

// Error type is automatically inferred as:
// UserNotFound | DependencyFailed | InsufficientFunds | TransferFailed
```

### End-to-End: API Handler

Here's the complete picture--workflow result to HTTP response with structured logging:

```typescript
// API route handler
// Assume a framework request type with body + id (Express/Fastify/etc.)
// Helper function for HTTP responses (adapt to your framework)
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleTransfer(req: Request): Promise<Response> {
  const { fromId, toId, amount } = req.body;

  const result = await transferMoney(
    { fromId, toId, amount },
    async (step, { fetchUser, fetchBalance, executeTransfer }, args) => {
      const sender = await step(fetchUser(args.fromId));
      const recipient = await step(fetchUser(args.toId));
      const balance = await step(fetchBalance(args.fromId));

      if (balance.available < args.amount) {
        return err(new InsufficientFunds({
          required: args.amount,
          available: balance.available,
        }));
      }

      const txId = await step(executeTransfer(sender, recipient, args.amount));
      return ok({ txId, amount: args.amount });
    }
  );

  if (!result.ok) {
    // Log with structured context for alerting/debugging
    const dep = result.error._tag === "DependencyFailed"
      ? (result.error as DependencyFailed)
      : null;
    
    logger.error("Transfer failed", {
      tag: result.error._tag,
      requestId: req.id,
      ...(dep && {
        service: dep.service,
        operation: dep.operation,
        retryable: dep.retryable,
        cause: dep.cause,
      }),
    });

    // Map to HTTP response
    // Never return cause to clients; treat it as internal diagnostic data.
    return TaggedError.match(result.error, {
      UserNotFound: (e) => json(404, { error: "User not found", userId: e.userId }),
      InsufficientFunds: (e) => json(400, {
        error: "Insufficient funds",
        required: e.required,
        available: e.available,
      }),
      DependencyFailed: (e) => e.retryable
        ? json(503, { error: "Service unavailable", retryAfter: 30 })
        : json(500, { error: "Internal error" }),
      TransferFailed: (e) => json(400, { error: e.reason }),
      UnexpectedError: (e) => json(500, { error: "Unexpected error", context: e.context }),
    });
  }

  return json(200, { transactionId: result.value.txId });
}
```

This closes the loop: **typed errors → structured logs → appropriate HTTP responses**.

## Pattern Matching

`TaggedError.match` enforces exhaustive handling at **system boundaries** (HTTP handlers, queue workers, CLI commands). This is where errors should be translated to responses--not scattered throughout business logic.

> **Note:** Use `_tag` matching for serialized errors; `instanceof` is for in-process errors. If you serialize/deserialize errors across process boundaries, `instanceof` checks will fail, but `_tag` matching remains reliable.

```typescript
const message = TaggedError.match(result.error, {
  UserNotFound: (e) => `User ${e.userId} not found`,
  InsufficientFunds: (e) => `Need ${e.required}, have ${e.available}`,
  DependencyFailed: (e) => `${e.service} unavailable (retryable: ${e.retryable})`,
  TransferFailed: (e) => `Transfer failed: ${e.reason}`,
});
```

TypeScript errors if you miss a variant. Add a new domain error? The compiler tells you everywhere that needs updating.

### Partial Matching with Fallback

For cases where you only care about specific errors:

```typescript
const message = TaggedError.matchPartial(
  result.error,
  {
    InsufficientFunds: (e) => `Add ${e.required - e.available} more funds`,
  },
  (e) => `Operation failed: ${e.message}`  // fallback for all others
);
```

## Type Guards

```typescript
// Check if any value is a TaggedError
if (TaggedError.isTaggedError(caught)) {
  console.log(caught._tag);  // safe to access
}

// Check if any value is an Error
if (TaggedError.isError(caught)) {
  console.log(caught.message);
}
```

## Error Chaining with Cause

Preserve the original error for debugging while presenting a clean interface:

```typescript
try {
  await riskyOperation();
} catch (e) {
  return err(new DependencyFailed({
    service: "payments",
    operation: "charge",
    retryable: false,
    cause: e,  // original error preserved for logging
  }));
}

// In error handler (see logging guidance below)
if (error._tag === "DependencyFailed" && (error as DependencyFailed).cause) {
  const depError = error as DependencyFailed;
  logger.error("Dependency failure", {
    service: depError.service,
    operation: depError.operation,
    originalError: depError.cause,
  });
}
```

### Where to Log

**Attach `cause` in adapters, log once at the edge.**

```typescript
// ❌ Don't: log at every step (duplicate logs, noise)
async function fetchUser(userId: string) {
  try {
    return ok(await httpClient.get(`/users/${userId}`));
  } catch (e) {
    logger.error("fetchUser failed", e);  // logged here...
    return err(new DependencyFailed({ ... }));
  }
}

// ✅ Do: attach cause, log at API/worker boundary
async function fetchUser(userId: string) {
  try {
    return ok(await httpClient.get(`/users/${userId}`));
  } catch (e) {
    return err(new DependencyFailed({
      service: "users",
      operation: "fetchUser",
      retryable: isRetryable(e),
      cause: e,  // preserved for edge logging
    }));
  }
}

// Edge handler (API route, queue worker, etc.)
const result = await transferMoney(
  { fromId, toId, amount },
  async (step, deps, args) => {
    // ... workflow logic ...
  }
);
if (!result.ok) {
  logger.error("Transfer failed", {
    tag: result.error._tag,
    ...extractLogContext(result.error),
  });
  return toHttpResponse(result.error);
}

function extractLogContext(error: TransferError) {
  if (error._tag === "DependencyFailed") {
    const depError = error as DependencyFailed;
    return {
      service: depError.service,
      operation: depError.operation,
      retryable: depError.retryable,
      cause: depError.cause,
    };
  }
  return { message: error.message };
}
```

This approach:

- Avoids duplicate logs from nested calls
- Groups errors by `service` + `operation` for alerting
- Keeps adapters focused on mapping, not logging policy

## Helper Types

```typescript
import { type TagOf, type ErrorByTag, type PropsOf } from 'awaitly';

// Extract tag literal
type Tag = TagOf<UserNotFound>;  // "UserNotFound"

// Extract variant from union
type AppError = UserNotFound | InsufficientFunds;
type NotFound = ErrorByTag<AppError, "UserNotFound">;  // UserNotFound

// Extract props (excludes _tag, name, message, stack)
type Props = PropsOf<UserNotFound>;  // { userId: string }
```

## Best Practices

### DO: Keep domain errors focused on business concepts

```typescript
// ✅ Business meaning is clear
class PaymentDeclined extends TaggedError("PaymentDeclined")<{
  reason: "insufficient_funds" | "card_expired" | "fraud_suspected";
  cardLast4: string;
}> {}
```

### DON'T: Let infrastructure errors leak into domain

```typescript
// ❌ Implementation detail exposed
class StripeAPIError extends TaggedError("StripeAPIError")<{
  stripeCode: string;
  stripeMessage: string;
}> {}
```

### DO: Use adapter errors with rich metadata

```typescript
// ✅ Enough info to retry intelligently, log effectively
class DependencyFailed extends TaggedError("DependencyFailed")<{
  service: string;
  operation: string;
  retryable: boolean;
  retryAfterMs?: number;
  cause?: unknown;
}> {}
```

### DON'T: Create a variant for every possible failure

```typescript
// ❌ Union explosion
type PaymentError =
  | StripeRateLimited
  | StripeTimeout
  | StripeInvalidRequest
  | StripeCardDeclined
  | StripeNetworkError
  | ...;
```

### DO: Collapse at boundaries, discriminate on metadata

```typescript
// ✅ One type, rich metadata
const error = new DependencyFailed({
  service: "stripe",
  operation: "createCharge",
  retryable: e.code === "rate_limit_exceeded",
  retryAfterMs: e.headers?.["retry-after"] ? parseInt(e.headers["retry-after"]) * 1000 : undefined,
  cause: e,
});
```

## Real-World Scenarios

### E-Commerce Checkout: Handle Payment, Inventory, and Fraud

Your checkout flow talks to multiple services. Each can fail differently, but your business logic only cares about a few outcomes.

```typescript
import { TaggedError } from 'awaitly';

// Domain errors - what the business cares about
class PaymentDeclined extends TaggedError("PaymentDeclined")<{
  reason: string;
  canRetry: boolean;
}> {}

class OutOfStock extends TaggedError("OutOfStock")<{
  productId: string;
  requested: number;
  available: number;
}> {}

class FraudDetected extends TaggedError("FraudDetected")<{
  riskScore: number;
  flaggedRules: string[];
}> {}

// Adapter error - collapses infrastructure failures
class CheckoutServiceFailed extends TaggedError("CheckoutServiceFailed")<{
  service: "payment" | "inventory" | "fraud";
  retryable: boolean;
  cause: unknown;
}> {}

type CheckoutError = PaymentDeclined | OutOfStock | FraudDetected | CheckoutServiceFailed;
```

Why this works: Your checkout handler sees exactly 4 error types regardless of whether Stripe returns 47 different error codes or your inventory service uses gRPC with its own error taxonomy.

### API Gateway: Collapse External Service Failures

You're building an API that aggregates data from multiple microservices. Each service has its own error types, but your API consumers don't care about that complexity.

```typescript
import { TaggedError } from 'awaitly';

// What API consumers see
class NotFound extends TaggedError("NotFound")<{
  resource: string;
  id: string;
}> {}

class Unauthorized extends TaggedError("Unauthorized")<{
  reason: "invalid_token" | "expired" | "insufficient_scope";
}> {}

class ServiceUnavailable extends TaggedError("ServiceUnavailable")<{
  service: string;
  retryAfterMs?: number;
}> {}

// Adapter function that collapses internal errors
function collapseServiceError(service: string, error: unknown): ServiceUnavailable {
  const retryable = error instanceof Error &&
    ("code" in error && (error.code === "ECONNRESET" || error.code === "ETIMEDOUT"));

  return new ServiceUnavailable({
    service,
    retryAfterMs: retryable ? 5000 : undefined,
  });
}
```

Why this works: Your API returns consistent error responses. Internal service chaos (database timeouts, cache misses, gRPC errors) becomes one clean `ServiceUnavailable` type.

### Data Pipeline: Validate, Transform, Load

Your ETL pipeline processes records from external sources. You need to distinguish between bad data (skip the record) and system failures (stop the pipeline).

```typescript
import { TaggedError } from 'awaitly';

// Record-level errors - skip the record, continue processing
class ValidationFailed extends TaggedError("ValidationFailed")<{
  recordId: string;
  field: string;
  expected: string;
  actual: string;
}> {}

class TransformFailed extends TaggedError("TransformFailed")<{
  recordId: string;
  step: string;
  reason: string;
}> {}

// Pipeline-level errors - stop processing
class SourceUnavailable extends TaggedError("SourceUnavailable")<{
  source: string;
  retryable: boolean;
}> {}

class DestinationFailed extends TaggedError("DestinationFailed")<{
  destination: string;
  recordsLost: number;
}> {}

type RecordError = ValidationFailed | TransformFailed;
type PipelineError = SourceUnavailable | DestinationFailed;
```

Why this works: Your pipeline can handle record errors (log and continue) differently from pipeline errors (alert and stop). The type system enforces this distinction.

## When NOT to Use This

This pattern adds ceremony. Skip it when:

- **Tiny scripts / prototypes** - Just throw exceptions. You'll rewrite it anyway.
- **Exceptions are the contract** - Most libraries throw. Wrapping everything adds noise without benefit.
- **You don't control the boundary** - Third-party callbacks, framework hooks, event handlers that expect thrown errors.
- **Single-layer apps** - If your entire app is one HTTP handler calling one database, the layering overhead isn't worth it.

**Use this when:**

- You have multiple services/adapters with different failure modes
- Error types matter for business logic (retry decisions, user messaging, alerting)
- You want compiler-enforced exhaustive handling
- Your team is already using Result types

## Summary

| Layer | Purpose | Stability | Example |
| ----- | ------- | --------- | ------- |
| Domain | Business rules | High | `UserNotFound`, `InsufficientFunds` |
| Adapter | Collapse infrastructure | Medium | `DependencyFailed` |
| Infrastructure | Raw library errors | Low | `ECONNRESET`, `SQLDeadlock` |

**The key insight:** Your workflow should only see domain + adapter errors. Infrastructure errors get collapsed at the boundary. This keeps your unions small, meaningful, and stable over time.
