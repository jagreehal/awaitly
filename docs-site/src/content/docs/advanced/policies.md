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

const user = await step(() => fetchUser('123'), options);
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

## Best practices

1. **Use policies consistently** - Same service type should use same policy
2. **Register in one place** - Use `createPolicyRegistry` for organization-wide standards
3. **Don't over-configure** - Presets handle most cases well
4. **Adjust for criticality** - Payment APIs may need more retries than logging
5. **Monitor and tune** - Adjust based on actual failure patterns
