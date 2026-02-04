---
title: Policies
description: Reusable bundles of step options
---

Reusable bundles of `StepOptions` (retry, timeout, cache keys) that can be composed and applied per-workflow or per-step.

## Using service policies

Apply pre-built policies for common scenarios:

```typescript
import { withPolicy, servicePolicies } from 'awaitly/policies';

const result = await workflow(async (step) => {
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
import { withPolicies, timeoutPolicies, retryPolicies } from 'awaitly/policies';

const data = await step(
  () => fetchData(),
  withPolicies([timeoutPolicies.api, retryPolicies.standard], 'fetch-data')
);
```

## Policy applier

Create a reusable applier for consistent defaults:

```typescript
import { createPolicyApplier, timeoutPolicies, retryPolicies } from 'awaitly/policies';

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
import { stepOptions } from 'awaitly/policies';

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
import { createPolicyRegistry, servicePolicies } from 'awaitly/policies';

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
import { retryPolicies } from 'awaitly/policies';

retryPolicies.none           // No retry
retryPolicies.transient      // 3 attempts, fast backoff
retryPolicies.standard       // 3 attempts, moderate backoff
retryPolicies.aggressive     // 5 attempts, longer backoff
retryPolicies.fixed(3, 1000) // 3 attempts, 1s fixed delay
retryPolicies.linear(3, 100) // 3 attempts, linear backoff
```

### Timeout policies

```typescript
import { timeoutPolicies } from 'awaitly/policies';

timeoutPolicies.fast         // 1 second
timeoutPolicies.api          // 5 seconds
timeoutPolicies.extended     // 30 seconds
timeoutPolicies.long         // 2 minutes
timeoutPolicies.ms(3000)     // Custom milliseconds
```

### Service policies

Combined retry + timeout for specific scenarios:

```typescript
import { servicePolicies } from 'awaitly/policies';

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
import { mergePolicies } from 'awaitly/policies';

const myApiPolicy = {
  timeout: { ms: 10000 },
  retry: {
    attempts: 4,
    backoff: 'exponential',
    delayMs: 200,
    maxDelayMs: 5000,
  },
};

const myDbPolicy = {
  timeout: { ms: 60000 },
  retry: {
    attempts: 2,
    backoff: 'fixed',
    delayMs: 1000,
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
import { servicePolicies, mergePolicies } from 'awaitly/policies';

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
import { withPolicy, servicePolicies } from 'awaitly/policies';

describe('workflow with policies', () => {
  it('retries on transient failure', async () => {
    const mockFetch = createMockFn();
    mockFetch
      .returnsOnce(errOutcome('NETWORK_ERROR'))
      .returnsOnce(errOutcome('NETWORK_ERROR'))
      .returns(okOutcome({ id: '1' }));

    const harness = createWorkflowHarness({ fetchData: mockFetch });

    const result = await harness.run(async (step) => {
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

    const result = await harness.run(async (step) => {
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
    retry: { attempts: 3, backoff: 'exponential', delayMs: 1000 },
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
    retry: { attempts: 2, backoff: 'fixed', delayMs: 100 },
  },

  // External APIs - less trusted, slower
  external: {
    timeout: { ms: 10000 },
    retry: { attempts: 3, backoff: 'exponential', delayMs: 500 },
  },

  // Event publishing - fire and forget with retry
  events: {
    timeout: { ms: 5000 },
    retry: { attempts: 5, backoff: 'linear', delayMs: 200 },
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
