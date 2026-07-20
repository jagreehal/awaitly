---
title: Policies
description: Per-dependency retry, timeout, and fallback wrappers plus StepOptions bundles
---

Policies control retries, timeouts, and fallbacks. awaitly offers two patterns:

1. **Per-dep policies (recommended):** declare `retry`, `timeout`, and `fallback` wrappers in the deps object. Call sites stay clean, and the analyzer reads policy chains from the deps literal.
2. **StepOptions bundles (legacy):** apply `withPolicy` or `servicePolicies` per step through options.

## Per-dep policies

Wrap dependencies at declaration site. Policies compose inside-out. `retry(timeout(fn, 5000), { attempts: 3 })` applies the timeout before each retry.

```typescript
import { ok, run, retry, timeout, fallback, tryAsync } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

const charge = tryAsync(
  () => paymentGateway.charge(amount),
  (cause) => ({ type: 'CHARGE_FAILED' as const, cause })
);

const sendEmail = tryAsync(
  () => emailService.send(to),
  (cause) => ({ type: 'SEND_FAILED' as const, cause })
);

// Standalone composition with run()
const result = await run(
  {
    charge: retry(timeout(charge, 5000), { attempts: 3 }),
    notify: fallback(sendEmail, () => ok(undefined)),
  },
  async (s) => {
    await s.charge(amount);
    await s.notify(to);
    return ok(undefined);
  }
);

// Same wrappers in a workflow deps object
const checkout = createWorkflow('checkout', {
  charge: retry(timeout(charge, 5000), { attempts: 3 }),
  notify: fallback(sendEmail, () => ok(undefined)),
});
```

### Error-union behavior

| Wrapper | Effect on error union |
|---------|----------------------|
| `retry(fn, opts)` | Preserves the base union. The last failure propagates. |
| `timeout(fn, ms)` | Adds `TimeoutError` to the union |
| `fallback(fn, handler)` | Consumes base errors; only handler errors remain |

Plain (non-Result) functions are valid inputs: return values normalize to `ok()`, throws surface as `UnexpectedError` at the run/workflow layer. Wrappers preserve the base function's name so events and diagrams keep showing the dep name.

See [Result types: policies](/foundations/result-types/#retry-with-the-retry-policy) and [Retries & Timeouts: deps-level policies](/guides/retries-timeouts/#deps-level-policies).

## StepOptions bundles (legacy)

Reusable bundles of `StepOptions` (retry, timeout, cache keys) applied per step via `withPolicy` and related helpers.

### Using service policies

Apply pre-built policies for common scenarios:

```typescript
import { withPolicy, servicePolicies } from 'awaitly';

const result = await workflow.run(async ({ step }) => {
  // HTTP API: 5s timeout, 3 retries
  const user = await step(
    () => fetchUser(id),
    withPolicy(servicePolicies.httpApi, { name: 'fetch-user' })
  );

  // Database: 30s timeout, 2 retries
  const orders = await step(
    () => db.query('SELECT * FROM orders'),
    withPolicy(servicePolicies.database, { name: 'fetch-orders' })
  );

  // Cache: 1s timeout, no retry
  const cached = await step(
    () => cache.get(key),
    withPolicy(servicePolicies.cache, { name: 'cache-lookup' })
  );

  return { user, orders, cached };
});
```

## Combining policies

Merge multiple policies together:

```typescript
import { withPolicies, timeoutPolicies, retryPolicies } from 'awaitly';

const data = await step(
  () => fetchData(),
  withPolicies([timeoutPolicies.api, retryPolicies.standard], 'fetch-data')
);
```

## Policy applier

Create a reusable applier for consistent defaults:

```typescript
import { createPolicyApplier, timeoutPolicies, retryPolicies } from 'awaitly';

const applyPolicy = createPolicyApplier(
  timeoutPolicies.api,
  retryPolicies.transient
);

const result = await step(
  () => callApi(),
  applyPolicy({ name: 'api-call', key: 'cache:api' })
);
```

## Fluent builder

Build step options with a fluent API:

```typescript
import { stepOptions } from 'awaitly';

const options = stepOptions()
  .name('fetch-user')
  .key('user:123')
  .timeout(5000)
  .retries(3)
  .build();

const user = await step('fetchUser', () => fetchUser('123'), options);
```

## Policy registry

Create organization-wide policy standards:

```typescript
import { createPolicyRegistry, servicePolicies } from 'awaitly';

const registry = createPolicyRegistry();
registry.register('api', servicePolicies.httpApi);
registry.register('db', servicePolicies.database);
registry.register('cache', servicePolicies.cache);
registry.register('queue', servicePolicies.messageQueue);

// Use in workflows
const user = await step(
  () => fetchUser(id),
  registry.apply('api', { name: 'fetch-user' })
);

const data = await step(
  () => db.query(sql),
  registry.apply('db', { name: 'query-data' })
);
```

## Available presets

### Retry policies

```typescript
import { retryPolicies } from 'awaitly';

retryPolicies.none           // No retry
retryPolicies.transient      // 3 attempts, fast backoff
retryPolicies.standard       // 3 attempts, moderate backoff
retryPolicies.aggressive     // 5 attempts, longer backoff
retryPolicies.fixed(3, 1000) // 3 attempts, 1s fixed delay
retryPolicies.linear(3, 100) // 3 attempts, linear backoff
```

### Timeout policies

```typescript
import { timeoutPolicies } from 'awaitly';

timeoutPolicies.fast         // 1 second
timeoutPolicies.api          // 5 seconds
timeoutPolicies.extended     // 30 seconds
timeoutPolicies.long         // 2 minutes
timeoutPolicies.ms(3000)     // Custom milliseconds
```

### Service policies

Combined retry + timeout for specific scenarios:

```typescript
import { servicePolicies } from 'awaitly';

servicePolicies.httpApi      // 5s timeout, 3 retries
servicePolicies.database     // 30s timeout, 2 retries
servicePolicies.cache        // 1s timeout, no retry
servicePolicies.messageQueue // 30s timeout, 5 retries
servicePolicies.fileSystem   // 2min timeout, 3 retries
servicePolicies.rateLimited  // 10s timeout, 5 linear retries
```

## Custom policies

Create your own policies:

```typescript
import { mergePolicies } from 'awaitly';

const myApiPolicy = {
  timeout: { ms: 10000 },
  retry: {
    attempts: 4,
    backoff: 'exponential',
    initialDelay: 200,
    maxDelay: 5000,
  },
};

const myDbPolicy = {
  timeout: { ms: 60000 },
  retry: {
    attempts: 2,
    backoff: 'fixed',
    initialDelay: 1000,
  },
};

// Combine with existing policies
const criticalApiPolicy = mergePolicies(
  servicePolicies.httpApi,
  { retry: { attempts: 5 } }
);
```

## When to use policies

| Scenario | Recommended Policy |
|----------|-------------------|
| External HTTP APIs | `servicePolicies.httpApi` |
| Database queries | `servicePolicies.database` |
| Cache operations | `servicePolicies.cache` |
| Message queue consumers | `servicePolicies.messageQueue` |
| File system operations | `servicePolicies.fileSystem` |
| Rate-limited APIs | `servicePolicies.rateLimited` |

## Testing policies

### Test policy configuration

```typescript
import { describe, it, expect } from 'vitest';
import { servicePolicies, mergePolicies } from 'awaitly';

describe('custom policies', () => {
  it('merges correctly with base policies', () => {
    const customApi = mergePolicies(
      servicePolicies.httpApi,
      { retry: { attempts: 5 } }
    );

    expect(customApi.retry?.attempts).toBe(5);
    expect(customApi.timeout?.ms).toBe(5000); // Inherited from httpApi
  });

  it('has expected timeout for critical operations', () => {
    const paymentPolicy = myPolicies.payment;

    // Payment should have longer timeout
    expect(paymentPolicy.timeout?.ms).toBeGreaterThanOrEqual(30000);
    // And more retries
    expect(paymentPolicy.retry?.attempts).toBeGreaterThanOrEqual(3);
  });
});
```

### Test policy application in workflows

```typescript
import { createWorkflowHarness, okOutcome, errOutcome } from 'awaitly/testing';
import { withPolicy, servicePolicies } from 'awaitly';

describe('workflow with policies', () => {
  it('retries on transient failure', async () => {
    const mockFetch = createMockFn();
    mockFetch
      .returnsOnce(errOutcome('NETWORK_ERROR'))
      .returnsOnce(errOutcome('NETWORK_ERROR'))
      .returns(okOutcome({ id: '1' }));

    const harness = createWorkflowHarness({ fetchData: mockFetch });

    const result = await harness.run(async ({ step, deps }) => {
      return await step(
        () => deps.fetchData(),
        withPolicy(servicePolicies.httpApi, { name: 'fetch' })
      );
    });

    expect(result.ok).toBe(true);
    expect(mockFetch.getCallCount()).toBe(3); // Retried twice
  });

  it('times out slow operations', async () => {
    const slowFetch = () => new Promise((resolve) =>
      setTimeout(() => resolve(ok({ data: 'slow' })), 10000)
    );

    const harness = createWorkflowHarness({ fetchData: () => slowFetch() });

    const result = await harness.run(async ({ step, deps }) => {
      return await step(
        () => deps.fetchData(),
        withPolicy({ timeout: { ms: 100 } }, { name: 'fetch' })
      );
    });

    expect(result.ok).toBe(false);
    // Should timeout, not succeed
  });
});
```

## Domain-specific policy patterns

### E-commerce policies

```typescript
const ecommercePolicies = {
  // Payment processing - high reliability needed
  payment: mergePolicies(servicePolicies.httpApi, {
    timeout: { ms: 30000 },
    retry: { attempts: 3, backoff: 'exponential', initialDelay: 1000 },
  }),

  // Inventory check - can fail fast
  inventory: mergePolicies(servicePolicies.httpApi, {
    timeout: { ms: 2000 },
    retry: { attempts: 1 },
  }),

  // Order database - needs durability
  orderDb: mergePolicies(servicePolicies.database, {
    timeout: { ms: 60000 },
    retry: { attempts: 3 },
  }),

  // Email notifications - best effort
  notifications: {
    timeout: { ms: 5000 },
    retry: { attempts: 1 },
  },
};

// Register globally
const registry = createPolicyRegistry();
Object.entries(ecommercePolicies).forEach(([name, policy]) => {
  registry.register(name, policy);
});
```

### Microservices policies

```typescript
const microservicesPolicies = {
  // Internal services - trusted, fast
  internal: {
    timeout: { ms: 2000 },
    retry: { attempts: 2, backoff: 'fixed', initialDelay: 100 },
  },

  // External APIs - less trusted, slower
  external: {
    timeout: { ms: 10000 },
    retry: { attempts: 3, backoff: 'exponential', initialDelay: 500 },
  },

  // Event publishing - fire and forget with retry
  events: {
    timeout: { ms: 5000 },
    retry: { attempts: 5, backoff: 'linear', initialDelay: 200 },
  },

  // Cache operations - fail fast
  cache: {
    timeout: { ms: 500 },
    retry: { attempts: 0 },
  },
};
```

### Conditional policy selection

```typescript
function getPolicyForService(service: string, criticality: 'low' | 'medium' | 'high') {
  const basePolicy = servicePolicies.httpApi;

  const criticalityModifiers = {
    low: { retry: { attempts: 1 }, timeout: { ms: 2000 } },
    medium: { retry: { attempts: 3 }, timeout: { ms: 5000 } },
    high: { retry: { attempts: 5 }, timeout: { ms: 30000 } },
  };

  return mergePolicies(basePolicy, criticalityModifiers[criticality]);
}

// Usage
const paymentPolicy = getPolicyForService('stripe', 'high');
const analyticsPolicy = getPolicyForService('mixpanel', 'low');
```

## Best practices

1. **Use policies consistently** - Same service type should use same policy
2. **Register in one place** - Use `createPolicyRegistry` for organization-wide standards
3. **Don't over-configure** - Presets handle most cases well
4. **Adjust for criticality** - Payment APIs may need more retries than logging
5. **Monitor and tune** - Adjust based on actual failure patterns
6. **Test your policies** - Verify retry and timeout behavior in tests
7. **Document policy decisions** - Explain why each service has its configuration
