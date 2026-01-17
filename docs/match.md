# Match

Exhaustive pattern matching for discriminated unions. Ensures all cases are handled at compile time.

## The Problem: Switch Statements Miss Cases

TypeScript doesn't catch missing cases in switch statements:

```typescript
type Status =
  | { _tag: 'Pending' }
  | { _tag: 'Running'; progress: number }
  | { _tag: 'Completed'; result: string }
  | { _tag: 'Failed'; error: string }

// ❌ No compile error when you add a new status!
function getMessage(status: Status): string {
  switch (status._tag) {
    case 'Pending': return 'Waiting...';
    case 'Running': return `${status.progress}%`;
    case 'Completed': return status.result;
    // Forgot 'Failed' - runtime error!
  }
}
```

## The Solution: Exhaustive Matching

Use `Match` for compile-time exhaustiveness checking:

```typescript
import { Match } from 'awaitly/match';

// ✓ TypeScript error if any case is missing
function getMessage(status: Status): string {
  return Match.value(status)
    .pipe(Match.tag("Pending", () => "Waiting..."))
    .pipe(Match.tag("Running", s => `${s.progress}%`))
    .pipe(Match.tag("Completed", s => s.result))
    .pipe(Match.tag("Failed", s => `Error: ${s.error}`))
    .pipe(Match.exhaustive);
}
```

If you forget a case, TypeScript shows an error at `.pipe(Match.exhaustive)`.

## Core API

### `Match.value` - Start Matching

```typescript
import { Match } from 'awaitly/match';

type Event =
  | { _tag: 'UserCreated'; userId: string; name: string }
  | { _tag: 'UserUpdated'; userId: string }
  | { _tag: 'UserDeleted'; userId: string }

const message = Match.value(event)
  .pipe(Match.tag("UserCreated", e => `Created: ${e.name}`))
  .pipe(Match.tag("UserUpdated", e => `Updated: ${e.userId}`))
  .pipe(Match.tag("UserDeleted", e => `Deleted: ${e.userId}`))
  .pipe(Match.exhaustive);
```

### `Match.tag` - Handle One Case

```typescript
Match.value(status)
  .pipe(Match.tag("Pending", () => "waiting"))      // Handle Pending
  .pipe(Match.tag("Running", s => s.progress))      // Handle Running
  .pipe(Match.tag("Completed", s => s.result))      // Handle Completed
  .pipe(Match.tag("Failed", s => s.error))          // Handle Failed
  .pipe(Match.exhaustive);
```

Each `Match.tag` removes that case from the remaining unhandled set. TypeScript tracks this.

### `Match.tags` - Handle Multiple Cases

```typescript
// Handle multiple cases at once
Match.value(event)
  .pipe(Match.tags({
    UserCreated: e => `Created: ${e.name}`,
    UserUpdated: e => `Updated: ${e.userId}`,
    UserDeleted: e => `Deleted: ${e.userId}`,
  }))
  .pipe(Match.exhaustive);
```

### `Match.exhaustive` - Complete the Match

```typescript
// TypeScript error if any case is not handled
const result = Match.value(status)
  .pipe(Match.tag("Pending", () => 0))
  .pipe(Match.tag("Running", s => s.progress))
  // Missing: Completed, Failed
  .pipe(Match.exhaustive);  // ❌ Type error!
```

## Default Handling

### `Match.orElse` - Default Handler

Handle specific cases, use a function for everything else:

```typescript
const message = Match.value(status)
  .pipe(Match.tag("Completed", s => `Done: ${s.result}`))
  .pipe(Match.orElse(s => `Status: ${s._tag}`));

// Completed → "Done: success"
// Pending   → "Status: Pending"
// Running   → "Status: Running"
// Failed    → "Status: Failed"
```

### `Match.orElseValue` - Default Value

Return a constant for unhandled cases:

```typescript
const result = Match.value(status)
  .pipe(Match.tag("Completed", s => s.result))
  .pipe(Match.orElseValue("not completed"));

// Completed → "success"
// Everything else → "not completed"
```

## Conditional Matching

### `Match.when` - Predicate-Based Matching

Add conditions beyond just the tag:

```typescript
type User = { _tag: 'User'; name: string; isAdmin: boolean };

const greeting = Match.value(user)
  .pipe(Match.tag("User", u => `Hello ${u.name}`))           // Default
  .pipe(Match.when("User", u => u.isAdmin, u => `Hello Admin ${u.name}!`))  // Override for admins
  .pipe(Match.exhaustive);

// { _tag: 'User', name: 'Alice', isAdmin: true }  → "Hello Admin Alice!"
// { _tag: 'User', name: 'Bob', isAdmin: false }   → "Hello Bob"
```

Order matters: `when` overrides a previous `tag` handler when the predicate is true.

## Type Guards

### `Match.is` - Single Tag Check

```typescript
const event: Event = { _tag: 'UserCreated', userId: '1', name: 'Alice' };

if (Match.is<Event, "UserCreated">("UserCreated")(event)) {
  // TypeScript knows: event.name exists
  console.log(event.name);  // "Alice"
}
```

### `Match.isOneOf` - Multiple Tag Check

```typescript
const isModification = Match.isOneOf<Event, ("UserCreated" | "UserUpdated")[]>(
  "UserCreated",
  "UserUpdated"
);

if (isModification(event)) {
  // TypeScript knows: event is UserCreated | UserUpdated
}
```

## Real-World Scenarios

### Payment Processing: Handle Every Possible Outcome

Your checkout API returns different result types. Missing one means silent bugs in production.

```typescript
import { Match } from 'awaitly/match';

type PaymentResult =
  | { _tag: 'Success'; transactionId: string; amount: number }
  | { _tag: 'Declined'; reason: string; canRetry: boolean }
  | { _tag: 'Fraud'; riskScore: number }
  | { _tag: 'NetworkError'; provider: string }

function handlePayment(result: PaymentResult): { action: string; notify: boolean } {
  return Match.value(result)
    .pipe(Match.tag("Success", r => ({
      action: `Charge ${r.transactionId} complete`,
      notify: false
    })))
    .pipe(Match.tag("Declined", r => ({
      action: r.canRetry ? "Show retry prompt" : "Show alternative payment",
      notify: false
    })))
    .pipe(Match.tag("Fraud", r => ({
      action: `Flag order for review (score: ${r.riskScore})`,
      notify: true  // Alert fraud team
    })))
    .pipe(Match.tag("NetworkError", r => ({
      action: `Retry with fallback provider (${r.provider} down)`,
      notify: true  // Alert ops
    })))
    .pipe(Match.exhaustive);
}
```

Add a new payment status later? TypeScript errors until you handle it.

### Subscription Billing: Different Logic per Plan

Your billing system charges differently based on plan type. Each plan has unique fields.

```typescript
import { Match } from 'awaitly/match';

type Subscription =
  | { _tag: 'Free'; userId: string }
  | { _tag: 'Pro'; userId: string; monthlyRate: number }
  | { _tag: 'Enterprise'; userId: string; contractValue: number; billingContact: string }

function calculateInvoice(sub: Subscription): number {
  return Match.value(sub)
    .pipe(Match.tag("Free", () => 0))
    .pipe(Match.tag("Pro", s => s.monthlyRate))
    .pipe(Match.tag("Enterprise", s => s.contractValue / 12))
    .pipe(Match.exhaustive);
}

function getBillingEmail(sub: Subscription): string {
  return Match.value(sub)
    .pipe(Match.tag("Enterprise", s => s.billingContact))
    .pipe(Match.orElse(s => `user-${s.userId}@example.com`));
}
```

### Notification Routing: Send to the Right Channel

Different event types need different notification channels. Miss one and users don't get notified.

```typescript
import { Match } from 'awaitly/match';

type NotificationEvent =
  | { _tag: 'OrderShipped'; orderId: string; trackingUrl: string }
  | { _tag: 'PaymentFailed'; amount: number; retryUrl: string }
  | { _tag: 'AccountLocked'; reason: string }
  | { _tag: 'PasswordChanged' }

type Channel = 'email' | 'sms' | 'push' | 'slack';

function routeNotification(event: NotificationEvent): { channel: Channel; urgent: boolean } {
  return Match.value(event)
    .pipe(Match.tag("OrderShipped", () => ({ channel: 'push' as const, urgent: false })))
    .pipe(Match.tag("PaymentFailed", () => ({ channel: 'email' as const, urgent: true })))
    .pipe(Match.tag("AccountLocked", () => ({ channel: 'sms' as const, urgent: true })))
    .pipe(Match.tag("PasswordChanged", () => ({ channel: 'email' as const, urgent: false })))
    .pipe(Match.exhaustive);
}
```

### Form Validation: Collect All Errors with Context

Validation returns different error types. You need to show the right message for each.

```typescript
import { Match } from 'awaitly/match';

type ValidationError =
  | { _tag: 'Required'; field: string }
  | { _tag: 'TooShort'; field: string; min: number; actual: number }
  | { _tag: 'InvalidFormat'; field: string; expected: string }
  | { _tag: 'AlreadyExists'; field: string; value: string }

function formatValidationError(error: ValidationError): string {
  return Match.value(error)
    .pipe(Match.tag("Required", e => `${e.field} is required`))
    .pipe(Match.tag("TooShort", e => `${e.field} must be at least ${e.min} characters (got ${e.actual})`))
    .pipe(Match.tag("InvalidFormat", e => `${e.field} must be a valid ${e.expected}`))
    .pipe(Match.tag("AlreadyExists", e => `${e.field} "${e.value}" is already taken`))
    .pipe(Match.exhaustive);
}
```

## More Examples

### Event Handler

```typescript
type DomainEvent =
  | { _tag: 'OrderPlaced'; orderId: string; items: string[] }
  | { _tag: 'OrderShipped'; orderId: string; trackingNumber: string }
  | { _tag: 'OrderDelivered'; orderId: string }
  | { _tag: 'OrderCancelled'; orderId: string; reason: string }

function handleEvent(event: DomainEvent): void {
  const message = Match.value(event)
    .pipe(Match.tag("OrderPlaced", e => `Order ${e.orderId} placed with ${e.items.length} items`))
    .pipe(Match.tag("OrderShipped", e => `Order ${e.orderId} shipped: ${e.trackingNumber}`))
    .pipe(Match.tag("OrderDelivered", e => `Order ${e.orderId} delivered`))
    .pipe(Match.tag("OrderCancelled", e => `Order ${e.orderId} cancelled: ${e.reason}`))
    .pipe(Match.exhaustive);

  console.log(message);
}
```

### Result Handling

```typescript
type ApiResult =
  | { _tag: 'Success'; data: unknown }
  | { _tag: 'NotFound'; resource: string }
  | { _tag: 'Unauthorized' }
  | { _tag: 'RateLimited'; retryAfter: number }

function formatError(result: ApiResult): string | null {
  return Match.value(result)
    .pipe(Match.tag("Success", () => null))
    .pipe(Match.tag("NotFound", r => `Resource not found: ${r.resource}`))
    .pipe(Match.tag("Unauthorized", () => "Please log in"))
    .pipe(Match.tag("RateLimited", r => `Too many requests. Retry in ${r.retryAfter}s`))
    .pipe(Match.exhaustive);
}
```

### State Machine

```typescript
type ConnectionState =
  | { _tag: 'Disconnected' }
  | { _tag: 'Connecting'; attempt: number }
  | { _tag: 'Connected'; sessionId: string }
  | { _tag: 'Reconnecting'; attempt: number; lastError: string }

function getStatusIcon(state: ConnectionState): string {
  return Match.value(state)
    .pipe(Match.tag("Disconnected", () => "⚫"))
    .pipe(Match.tag("Connecting", () => "🟡"))
    .pipe(Match.tag("Connected", () => "🟢"))
    .pipe(Match.tag("Reconnecting", () => "🟠"))
    .pipe(Match.exhaustive);
}
```

### Partial Handling with Defaults

```typescript
// Only care about certain states
const isActive = Match.value(state)
  .pipe(Match.tag("Connected", () => true))
  .pipe(Match.tag("Reconnecting", () => true))
  .pipe(Match.orElseValue(false));
```

## Best Practices

### DO: Use for discriminated unions

```typescript
// ✓ Good - tagged union
type Result =
  | { _tag: 'Ok'; value: string }
  | { _tag: 'Err'; error: Error }

Match.value(result)
  .pipe(Match.tag("Ok", r => r.value))
  .pipe(Match.tag("Err", r => r.error.message))
  .pipe(Match.exhaustive);
```

### DON'T: Use for simple boolean/null checks

```typescript
// ✗ Overkill - just use if/else
const message = value ? "yes" : "no";
```

### DO: Extract handlers for complex logic

```typescript
// ✓ Keep match expressions clean
const handleCreated = (e: Extract<Event, { _tag: 'UserCreated' }>) => {
  // Complex logic here
  return `Created: ${e.name}`;
};

Match.value(event)
  .pipe(Match.tag("UserCreated", handleCreated))
  .pipe(Match.tag("UserUpdated", handleUpdated))
  .pipe(Match.tag("UserDeleted", handleDeleted))
  .pipe(Match.exhaustive);
```

## Summary

| Function | Purpose |
| -------- | ------- |
| `Match.value(x)` | Start matching on a value |
| `Match.tag(tag, fn)` | Handle one case |
| `Match.tags({ ... })` | Handle multiple cases |
| `Match.when(tag, pred, fn)` | Conditional handling |
| `Match.exhaustive` | Complete match (all cases required) |
| `Match.orElse(fn)` | Default handler |
| `Match.orElseValue(v)` | Default value |
| `Match.is(tag)` | Type guard for one tag |
| `Match.isOneOf(...tags)` | Type guard for multiple tags |

**The key insight:** Let the compiler catch missing cases. When you add a new variant to a union, TypeScript tells you everywhere that needs updating.
