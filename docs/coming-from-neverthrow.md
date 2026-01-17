# Coming from neverthrow

You already get it: **errors should be in the type system, not hidden behind `unknown`**. Both neverthrow and this library share that philosophy.

The difference? neverthrow gives you typed Results. This library gives you typed Results *plus* orchestration--retries, timeouts, caching, resume, and visualization built in.

This library **automatically infers error types** from your dependencies. No more manually tracking error unions--add a step, the union updates. Remove one? It updates. TypeScript enforces it at compile time.

**TL;DR:**
- `andThen` chains → `step()` calls with async/await
- **Automatic error inference** -- no manual union tracking
- Same error-first mindset, different syntax
- Keep your existing neverthrow code--they interop cleanly

## Two philosophies, same goal

| | neverthrow | awaitly |
|---|------------|---------------------|
| **Mental model** | "The Realist" -- explicit about what can fail | "The Orchestrator" -- explicit failures + execution control |
| **Syntax** | Functional chaining (`.andThen()`, `.map()`) | Imperative async/await with `step()` |
| **Error inference** | ⚠️ **Manual union types** -- you maintain them | ✅ **Automatic from dependencies** -- always in sync |
| **Orchestration** | DIY (retries, caching, timeouts) | Built-in primitives |

Both make your functions *honest*--the signature says what can go wrong. The key difference: **workflow eliminates the manual union tracking burden** while adding orchestration features.

---

## Quick orientation

Before diving into examples, here are the key concepts:

### Two runners: `createWorkflow` vs `run`

| Runner | When to use | Features |
|--------|-------------|----------|
| `createWorkflow({ deps })` | Multi-step workflows needing orchestration | Auto error inference, caching, resume, events |
| `run(async (step) => ...)` | Simple one-off sequences without deps injection | Minimal, no caching/resume |

Most examples in this guide use `createWorkflow` because it's the common case. Use `run()` for quick operations where you don't need dependency injection or orchestration features.

### Two forms of `step()`

```typescript
// Form 1: Direct result - use for simple steps
const user = await step(deps.fetchUser(id));

// Form 2: Lazy function with options - use when you need caching/resume
const user = await step(() => deps.fetchUser(id), { key: 'user:' + id });
```

**Rule of thumb:**
- Use `step(result)` for normal steps
- Use `step(() => fn(), { key })` when you need **caching**, **resume**, or **retry/timeout**

The key enables these features. Without a key, the step runs but isn't cached or resumable.

### Type literal tip

Use `as const` to keep error unions narrow:

```typescript
return err('NOT_FOUND' as const);  // error is literal 'NOT_FOUND'
return err('NOT_FOUND');           // error widens to string
```

This matters because narrow unions enable exhaustive `switch` handling and better autocomplete.

### About `UnexpectedError`

By default, workflow results include `UnexpectedError` alongside your typed errors:

```typescript
// result.error: 'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError
```

`UnexpectedError` wraps uncaught exceptions so they don't crash your app--it contains the thrown value in `cause` for debugging. If you want a **closed** error union (no `UnexpectedError`), use strict mode:

```typescript
const workflow = createWorkflow(
  { fetchUser },
  {
    strict: true,
    catchUnexpected: (thrown) => 'UNEXPECTED' as const,
  }
);
// result.error: 'NOT_FOUND' | 'UNEXPECTED' (exactly)
```

---

## The problem both libraries solve

Standard async/await hides failure information from the type system:

```typescript
async function loadDashboard(userId: string) {
  try {
    const user = await fetchUser(userId);
    const org = await fetchOrg(user.orgId);
    return { user, org };
  } catch (e) {
    throw new Error('Failed to load dashboard');
  }
}
```

TypeScript sees this as returning `{ user, org }` or throwing `unknown`. All the real errors--NOT_FOUND, PERMISSION_DENIED, TIMEOUT--are erased.

Both neverthrow and workflow fix this by making errors part of the return type.

---

## The manual union tracking problem

**neverthrow's pain point:** You must manually declare and maintain error unions. Every time you add or remove a step, you update the type annotation:

```typescript
// ❌ Manual union tracking - easy to get out of sync
type SignUpError = 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'DB_ERROR' | 'EMAIL_EXISTS';

const signUp = (
  email: string,
  password: string
): ResultAsync<User, SignUpError> =>
  validateEmail(email)
    .andThen(() => validatePassword(password))
    .andThen(() => checkDuplicate(email))  // Oops! Forgot to add 'EMAIL_EXISTS' to SignUpError
    .andThen(() => createUser(email, password));

// TypeScript won't catch this - the error union is manually declared
// You'll only find out at runtime when you try to handle 'EMAIL_EXISTS'
```

**What happens:**
- Add a new step? Update the union manually
- Remove a step? Update the union manually  
- Forget to update? TypeScript won't catch it
- Switch on an error that can't happen? TypeScript won't warn you
- Miss handling a possible error? TypeScript won't warn you

**workflow's solution:** Error types are **automatically inferred** from your dependencies:

```typescript
// ✅ Automatic inference - always in sync
const signUp = createWorkflow({
  validateEmail,    // returns AsyncResult<string, 'INVALID_EMAIL'>
  validatePassword, // returns AsyncResult<string, 'WEAK_PASSWORD'>
  checkDuplicate,   // returns AsyncResult<void, 'EMAIL_EXISTS'>
  createUser,       // returns AsyncResult<User, 'DB_ERROR'>
});

const result = await signUp(async (step, deps) => {
  const email = await step(deps.validateEmail('alice@example.com'));
  const password = await step(deps.validatePassword('securepass123'));
  await step(deps.checkDuplicate(email));
  return await step(deps.createUser(email, password));
});

// TypeScript knows: Result<User, 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'EMAIL_EXISTS' | 'DB_ERROR' | UnexpectedError>
// Add a step? Union updates automatically. Remove one? Updates automatically.
// Switch on an impossible error? TypeScript error. Miss a possible error? TypeScript error.
```

**The difference:**
- neverthrow: You maintain the error union manually (error-prone)
- workflow: The error union is computed from your dependencies (always correct)

This is especially valuable in complex workflows with 5+ steps where manual tracking becomes a maintenance burden.

---

## Pattern-by-pattern comparison

### Basic Result construction

**neverthrow:**

```typescript
import { ok, err, Result } from 'neverthrow';

const success = ok({ id: '1', name: 'Alice' });
const failure = err('NOT_FOUND' as const);

// Access with methods
success.isOk()           // true
success._unsafeUnwrap()  // { id: '1', name: 'Alice' }
failure.isErr()          // true
failure._unsafeUnwrapErr() // 'NOT_FOUND'
```

**workflow:**

```typescript
import { ok, err } from 'awaitly';

const success = ok({ id: '1', name: 'Alice' });
const failure = err('NOT_FOUND' as const);

// Access with properties
success.ok            // true
success.value         // { id: '1', name: 'Alice' }
failure.ok            // false
failure.error         // 'NOT_FOUND'
```

---

### Sequential operations

**neverthrow** uses `andThen` to chain operations:

```typescript
fetchUser(userId)
  .andThen(user =>
    fetchOrg(user.orgId).andThen(org =>
      fetchStats(org.id).map(stats => ({ user, org, stats }))
    )
  );
```

With 3+ operations, the nesting becomes unwieldy.

**workflow** uses `step()` with standard async/await:

```typescript
import { createWorkflow } from 'awaitly';

const loadDashboard = createWorkflow({ fetchUser, fetchOrg, fetchStats });

const result = await loadDashboard(async (step, deps) => {
  const user = await step(deps.fetchUser(userId));
  const org = await step(deps.fetchOrg(user.orgId));
  const stats = await step(deps.fetchStats(org.id));
  return { user, org, stats };
});
```

The `step()` function unwraps `Ok` values and short-circuits on `Err`--same semantics as `andThen`, but stays flat regardless of depth.

---

### Early exit

**neverthrow:**

```typescript
fetchUser(id)
  .andThen(user => assertActive(user))
  .andThen(user => fetchPermissions(user.id));
```

**workflow:**

```typescript
const result = await run(async (step) => {
  const user = await step(fetchUser(id));
  await step(assertActive(user));  // stops here if user inactive
  const permissions = await step(fetchPermissions(user.id));
  return { user, permissions };
});
```

If any step returns `Err`, execution stops immediately--no manual `if (result.isErr())` checks needed.

---

### Transforming values (map)

**neverthrow:**

```typescript
fetchUser(id).map(user => user.name);
```

**workflow:**

```typescript
const result = await run(async (step) => {
  const user = await step(fetchUser(id));
  return user.name;  // just use the value directly
});
```

Since `step()` unwraps the value, you work with it naturally.

---

### Error recovery (orElse)

**neverthrow:**

```typescript
fetchUser(id).orElse(error => {
  if (error === 'NOT_FOUND') return ok(defaultUser);
  return err(error);
});
```

**workflow** -- now with direct `orElse()` function:

```typescript
import { orElse, ok, err } from 'awaitly';

// Direct equivalent to neverthrow's orElse
const userResult = orElse(
  await fetchUser(id),
  error => error === 'NOT_FOUND' ? ok(defaultUser) : err(error)
);

// Or use recover() when recovery cannot fail
import { recover } from 'awaitly';

const user = recover(
  await fetchUser(id),
  error => error === 'NOT_FOUND' ? defaultUser : guestUser
);
// user is always ok() - recovery guarantees success
```

For pattern matching, use `match()`:

```typescript
import { match } from 'awaitly';

const user = match(await fetchUser(id), {
  ok: (value) => value,
  err: (error) => error === 'NOT_FOUND' ? defaultUser : guestUser,
});
```

---

### Wrapping throwing code (fromPromise)

**neverthrow:**

```typescript
import { ResultAsync } from 'neverthrow';

const result = ResultAsync.fromPromise(
  fetch('/api/data').then(r => r.json()),
  () => 'FETCH_FAILED' as const
);
```

**awaitly** has direct equivalents:

```typescript
import { fromPromise, tryAsync } from 'awaitly';

// fromPromise - wrap an existing Promise
const result = await fromPromise(
  fetch('/api/data').then(r => r.json()),
  () => 'FETCH_FAILED' as const
);

// tryAsync - wrap an async function (often cleaner)
const result = await tryAsync(
  async () => {
    const res = await fetch('/api/data');
    return res.json();
  },
  () => 'FETCH_FAILED' as const
);
```

Both `fromPromise` and `tryAsync` support typed error mapping. Use `tryAsync` when the async logic is more than a one-liner.

---

### Parallel execution (combine)

**neverthrow:**

```typescript
import { ResultAsync } from 'neverthrow';

const result = await ResultAsync.combine([
  fetchUser(id),
  fetchPermissions(id),
]);
```

**workflow:**

```typescript
import { allAsync } from 'awaitly';

const result = await allAsync([
  fetchUser(id),
  fetchPermissions(id),
]);

if (result.ok) {
  const [user, permissions] = result.value;
}
```

Both fail fast on the first error.

---

### Collecting all errors (combineWithAllErrors)

**neverthrow:**

```typescript
Result.combineWithAllErrors([
  validateEmail(email),
  validatePassword(password),
]);
```

**workflow:**

```typescript
import { allSettled } from 'awaitly';

const result = allSettled([
  validateEmail(email),
  validatePassword(password),
]);
// If any fail: { ok: false, error: [{ error: 'INVALID_EMAIL' }, { error: 'WEAK_PASSWORD' }] }
```

Useful for form validation where you want all errors at once.

---

### Pattern matching (match)

**neverthrow:**

```typescript
result.match(
  (value) => console.log('Success:', value),
  (error) => console.log('Error:', error)
);
```

**workflow:**

```typescript
import { match } from 'awaitly';

match(result, {
  ok: (value) => console.log('Success:', value),
  err: (error) => console.log('Error:', error),
});
```

Or use simple conditionals:

```typescript
if (result.ok) {
  console.log('Success:', result.value);
} else {
  console.log('Error:', result.error);
}
```

---

### Transformations (map, mapError)

**neverthrow:**

```typescript
fetchUser(id)
  .map(user => user.name)
  .mapErr(error => ({ code: error, message: 'User not found' }));
```

**workflow:**

```typescript
import { map, mapError } from 'awaitly';

const userResult = await fetchUser(id);
const nameResult = map(userResult, user => user.name);
const enrichedResult = mapError(userResult, error => ({
  code: error,
  message: 'User not found',
}));
```

---

### Automatic error type inference

> Error unions are computed automatically--no manual tracking, no drift, no bugs.

**neverthrow** requires you to declare error unions explicitly:

```typescript
// ❌ You MUST manually track the error union
type SignUpError = 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'DB_ERROR';

const signUp = (
  email: string,
  password: string
): ResultAsync<User, SignUpError> =>
  validateEmail(email)
    .andThen(() => validatePassword(password))
    .andThen(() => createUser(email, password));

// What happens when you add a step?
// 1. Add checkDuplicate() that returns 'EMAIL_EXISTS'
// 2. Remember to update SignUpError type
// 3. If you forget? TypeScript won't catch it
// 4. Runtime error when you try to handle 'EMAIL_EXISTS'
```

**The pain:**
- Add a step? Update the union manually
- Remove a step? Update the union manually
- Forget to update? Silent type error
- Switch on impossible error? No warning
- Miss handling possible error? No warning

**workflow** with `createWorkflow` infers them automatically:

```typescript
import { createWorkflow } from 'awaitly';

// ✅ NO manual type annotation needed!
const signUp = createWorkflow({
  validateEmail,    // returns AsyncResult<string, 'INVALID_EMAIL'>
  validatePassword, // returns AsyncResult<string, 'WEAK_PASSWORD'>
  createUser,       // returns AsyncResult<User, 'DB_ERROR'>
});

const result = await signUp(async (step, deps) => {
  const email = await step(deps.validateEmail('alice@example.com'));
  const password = await step(deps.validatePassword('securepass123'));
  return await step(deps.createUser(email, password));
});

// TypeScript knows: Result<User, 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'DB_ERROR' | UnexpectedError>
```

**Add a step?** The union updates automatically:
```typescript
// Add checkDuplicate - union updates automatically
const signUp = createWorkflow({
  validateEmail,
  validatePassword,
  checkDuplicate,  // returns AsyncResult<void, 'EMAIL_EXISTS'>
  createUser,
});

// Now TypeScript knows: 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'EMAIL_EXISTS' | 'DB_ERROR' | UnexpectedError
// No manual type update needed!
```

**Remove a step?** The union updates automatically. **Switch on impossible error?** TypeScript error. **Miss handling possible error?** TypeScript error.

The error union **always** matches your actual dependencies. This becomes invaluable in complex workflows with 5+ steps where manual tracking becomes error-prone.

---

## Why async/await wins for complex logic

Beyond syntax preference, there are two structural advantages to workflow's imperative approach that become significant as your code grows:

### Variable scoping (no closure drilling)

**neverthrow** -- accessing variables from earlier steps means nesting or explicit passing:

```typescript
fetchUser(id)
  .andThen(user =>
    fetchPosts(user.id).andThen(posts =>
      fetchComments(posts[0].id).andThen(comments =>
        // To use 'user' here, we had to pass through every layer
        calculateAnalytics(user, posts, comments)
      )
    )
  );
```

**workflow** -- all variables are in block scope:

```typescript
const result = await workflow(async (step) => {
  const user = await step(fetchUser(id));
  const posts = await step(fetchPosts(user.id));
  const comments = await step(fetchComments(posts[0].id));

  // All variables accessible--no drilling needed
  return calculateAnalytics(user, posts, comments);
});
```

This matters most in checkout flows, data pipelines, and any multi-step process where later steps reference earlier results.

### Native control flow (branching without gymnastics)

**neverthrow** -- conditional logic requires functional patterns:

```typescript
fetchTenant(id).andThen(tenant => {
  if (tenant.plan === 'free') {
    return calculateFreeUsage();  // Must return compatible Result type
  }
  return fetchUsers()
    .andThen(users => fetchResources()
      .andThen(resources => calculateUsage(tenant, users, resources)));
});
```

All branches must return the same Result type, and you lose access to `tenant` inside deeper callbacks without passing it.

**workflow** -- just JavaScript:

```typescript
const result = await workflow(async (step) => {
  const tenant = await step(fetchTenant(id));

  if (tenant.plan === 'free') {
    return await step(calculateFreeUsage(tenant));
  }

  const [users, resources] = await step(allAsync([
    fetchUsers(),
    fetchResources()
  ]));

  switch (tenant.plan) {
    case 'pro':
      await step(sendProNotification(tenant));
      break;
    case 'enterprise':
      await step(sendEnterpriseNotification(tenant));
      break;
  }

  return await step(calculateUsage(tenant, users, resources));
});
```

Standard `if`, `switch`, `for`, `while`--no learning curve for conditional logic.

---

## What you get on top of neverthrow

Everything above is pattern translation--same capabilities, different syntax. These features are *new*--they don't have neverthrow equivalents because they're about orchestration, not just error handling.

### Retry with backoff

Automatically retry failed operations:

```typescript
const workflow = createWorkflow({ flakyOperation });

const result = await workflow(async (step, deps) => {
  return await step.retry(
    () => deps.flakyOperation(),
    {
      attempts: 3,
      backoff: 'exponential',  // 'fixed' | 'linear' | 'exponential'
      initialDelay: 100,
      maxDelay: 5000,
      jitter: true,
      retryOn: (error) => error !== 'FATAL',
    }
  );
});
```

---

### Timeout protection

Prevent operations from hanging:

```typescript
const data = await step.withTimeout(
  () => slowOperation(),
  { ms: 5000 }
);
```

With AbortSignal for cancellable operations:

```typescript
const data = await step.withTimeout(
  (signal) => fetch('/api/data', { signal }),
  { ms: 5000, signal: true }
);
```

---

### Step caching

Cache expensive operations by key:

```typescript
const workflow = createWorkflow({ fetchUser }, { cache: new Map() });

const result = await workflow(async (step, deps) => {
  const user = await step(() => deps.fetchUser('1'), { key: 'user:1' });

  // Same key = cache hit, fetchUser not called again
  const userAgain = await step(() => deps.fetchUser('1'), { key: 'user:1' });

  return user;
});
```

---

### Save and resume execution

Persist completed steps and resume without re-running them:

```typescript
import { createWorkflow, isStepComplete, type ResumeStateEntry } from 'awaitly';

const savedSteps = new Map<string, ResumeStateEntry>();

const workflow = createWorkflow({ fetchUser, processPayment }, {
  onEvent: (event) => {
    if (isStepComplete(event)) {
      savedSteps.set(event.stepKey, { result: event.result, meta: event.meta });
    }
  }
});

// First run - payment succeeds, then process crashes
await workflow(async (step, deps) => {
  const user = await step(() => deps.fetchUser(id), { key: 'user' });
  const payment = await step(() => deps.processPayment(user), { key: 'payment' });
  await step(() => sendConfirmation(payment), { key: 'confirm' });
});

// Resume later - user and payment steps are skipped (already completed)
const workflow2 = createWorkflow({ fetchUser, processPayment }, {
  resumeState: { steps: savedSteps }
});
```

---

### Event stream for observability

Every workflow emits structured events:

```typescript
const workflow = createWorkflow({ fetchUser }, {
  onEvent: (event) => {
    // workflow_start | workflow_success | workflow_error
    // step_start | step_success | step_error | step_complete
    // step_retry | step_timeout | step_retries_exhausted
    console.log(event.type, event.stepKey, event.durationMs);
  }
});
```

Note: `step_complete` is only emitted for steps with a `key` (enables caching/resume).

---

### Saga/compensation patterns

Define rollback actions for distributed transactions:

```typescript
import { createSagaWorkflow } from 'awaitly/saga';

const checkoutSaga = createSagaWorkflow(
  { reserveInventory, chargeCard, sendConfirmation }
);

const result = await checkoutSaga(async (saga, deps) => {
  const reservation = await saga.step(
    () => deps.reserveInventory(items),
    {
      name: 'reserve-inventory',
      compensate: (res) => releaseInventory(res.reservationId),
    }
  );

  const payment = await saga.step(
    () => deps.chargeCard(amount),
    {
      name: 'charge-card',
      compensate: (p) => refundPayment(p.transactionId),
    }
  );

  // If sendConfirmation fails, compensations run in reverse:
  // 1. refundPayment(payment.transactionId)
  // 2. releaseInventory(reservation.reservationId)
  await saga.step(
    () => deps.sendConfirmation(email),
    { name: 'send-confirmation' }
  );

  return { reservation, payment };
});
```

---

### Circuit breaker

Prevent cascading failures:

```typescript
import { createCircuitBreaker, isCircuitOpenError } from 'awaitly/circuit-breaker';

const breaker = createCircuitBreaker('external-api', {
  failureThreshold: 5,
  resetTimeout: 30000,
  halfOpenMax: 3,
});

const result = await breaker.executeResult(async () => {
  return ok(await fetchFromExternalApi());
});

if (!result.ok && isCircuitOpenError(result.error)) {
  console.log(`Circuit open, retry after ${result.error.retryAfterMs}ms`);
}
```

---

### Rate limiting

Control throughput:

```typescript
import { createRateLimiter } from 'awaitly/ratelimit';

const limiter = createRateLimiter('api-calls', {
  maxPerSecond: 10,
  burstCapacity: 20,
  strategy: 'wait',
});

const data = await limiter.execute(async () => {
  return await callExternalApi();
});
```

---

### Visualization

Render workflow execution:

```typescript
import { createVisualizer } from 'awaitly/visualize';

const viz = createVisualizer({ workflowName: 'User posts flow' });
const workflow = createWorkflow({ fetchUser, fetchPosts }, {
  onEvent: viz.handleEvent,
});

await workflow(async (step, deps) => {
  const user = await step(() => deps.fetchUser('1'), { name: 'Fetch user', key: 'user' });
  const posts = await step(() => deps.fetchPosts(user.id), { name: 'Fetch posts', key: 'posts' });
  return { user, posts };
});

console.log(viz.render());        // ASCII for terminal
console.log(viz.renderAs('mermaid')); // Mermaid for docs
```

---

### Strict mode

Close error unions with explicit unexpected error handling:

```typescript
const workflow = createWorkflow(
  { riskyOp },
  {
    strict: true,
    catchUnexpected: () => 'UNEXPECTED' as const,
  }
);

// Result type is now 'KNOWN_ERROR' | 'UNEXPECTED' (no UnexpectedError)
```

---

## Using them together

You don't have to migrate everything at once. Wrap neverthrow Results when you want workflow features:

```typescript
import { Result as NTResult } from 'neverthrow';
import { ok, err, type Result } from 'awaitly';

function fromNeverthrow<T, E>(ntResult: NTResult<T, E>): Result<T, E> {
  return ntResult.isOk() ? ok(ntResult.value) : err(ntResult.error);
}

const result = await run(async (step) => {
  // Your existing neverthrow validation, now with workflow's step() features
  const validated = await step(fromNeverthrow(validateInput(data)));
  return validated;
});
```

---

## Quick comparison tables

### Result API mapping

| Operation | neverthrow | awaitly |
|-----------|------------|---------------------|
| Result access | `.isOk()`, `.isErr()` methods | `.ok` boolean property |
| Chaining | `.andThen()` method chains | `step()` with async/await |
| Wrapping throws | `ResultAsync.fromPromise()` | `fromPromise()`, `tryAsync()` |
| Parallel ops | `.combine()` | `allAsync()` |
| Collect all errors | `.combineWithAllErrors()` | `allSettled()` |
| Pattern matching | `.match(onOk, onErr)` | `match(result, { ok, err })` |
| Transform value | `.map()` method | `map()` function |
| Transform error | `.mapErr()` method | `mapError()` function |
| Transform both | `.bimap()` method | `bimap()` function |
| Chain results | `.andThen()` method | `andThen()` function |
| Error recovery | `.orElse()` method | `orElse()` or `recover()` |

### Orchestration features

| Feature | neverthrow | awaitly |
|---------|------------|---------------------|
| Error inference | Manual union types | Automatic from `createWorkflow` deps |
| Retries | DIY | Built-in `step.retry()` |
| Timeouts | DIY | Built-in `step.withTimeout()` |
| Caching | DIY | Built-in with `key` option |
| Resume/Persist | DIY | Built-in `resumeState` |
| Event stream | DIY | Built-in 15+ event types |
| Visualization | DIY | Built-in ASCII & Mermaid |
| Saga/Compensation | DIY | Built-in `createSagaWorkflow` |
| Circuit breaker | DIY | Built-in `createCircuitBreaker` |

---

## Migration checklist

Ready to migrate? Here's a practical path:

### Phase 1: Interop (keep existing code)

- [ ] Install `awaitly`
- [ ] Create a `fromNeverthrow()` helper (see "Using them together" above)
- [ ] Wrap neverthrow Results at integration boundaries when you need workflow features

### Phase 2: New code with workflow

- [ ] Use `createWorkflow` for new multi-step operations
- [ ] Use typed error literals (`'NOT_FOUND' as const`) for narrow unions
- [ ] Add `key` to steps that need caching or resume

### Phase 3: Add orchestration (as needed)

- [ ] Add retries to flaky external calls with `step.retry()`
- [ ] Add timeouts to slow operations with `step.withTimeout()`
- [ ] Use `onEvent` for observability and debugging
- [ ] Consider `createSagaWorkflow` for distributed transactions

### Phase 4: Optional migration of existing code

- [ ] Convert neverthrow functions to return `AsyncResult` directly
- [ ] Replace `ResultAsync.fromPromise()` with `tryAsync()`
- [ ] Replace `.andThen()` chains with `step()` sequences where clarity improves

**Tip:** You don't need to migrate everything. The libraries coexist fine. Migrate when you'd benefit from orchestration features or simpler async flow.

---

## Try it

```bash
npm install awaitly
```

```typescript
import { createWorkflow, ok, err, type AsyncResult } from 'awaitly';

const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
  id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');

const fetchPosts = async (userId: string): AsyncResult<Post[], 'FETCH_ERROR'> =>
  ok([{ id: 'p1', title: 'Hello World', authorId: userId }]);

// Error union inferred automatically
const loadUserData = createWorkflow({ fetchUser, fetchPosts });

const result = await loadUserData(async (step, deps) => {
  const user = await step(deps.fetchUser('1'));
  const posts = await step(deps.fetchPosts(user.id));
  return { user, posts };
});

if (result.ok) {
  console.log(result.value.user.name);
} else {
  console.log(result.error);  // 'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError
}
```

**Next:** [README](../README.md) for the full tutorial, or [Advanced Guide](advanced.md) for production features.
