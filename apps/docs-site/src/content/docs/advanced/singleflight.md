---
title: Singleflight (Request Coalescing)
description: Dedupe concurrent identical requests to prevent thundering herd
---

Singleflight prevents duplicate in-flight requests by coalescing concurrent calls with the same key into a single operation.

## The Problem

When multiple parts of your application request the same data simultaneously, you get duplicate requests:

```typescript
// Without singleflight - 3 network requests!
const [user1, user2, user3] = await Promise.all([
  fetchUser('1'),
  fetchUser('1'),  // Duplicate
  fetchUser('1'),  // Duplicate
]);
```

## The Solution

With singleflight, concurrent calls with the same key share one in-flight request:

```typescript
import { singleflight } from 'awaitly/singleflight';
import { ok, err, type AsyncResult } from 'awaitly';

const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
  const user = await db.find(id);
  return user ? ok(user) : err('NOT_FOUND');
};

// Wrap with singleflight
const fetchUserOnce = singleflight(fetchUser, {
  key: (id) => `user:${id}`,
});

// Now only 1 network request!
const [user1, user2, user3] = await Promise.all([
  fetchUserOnce('1'),  // Triggers fetch
  fetchUserOnce('1'),  // Joins existing fetch
  fetchUserOnce('1'),  // Joins existing fetch
]);
```

## How It Works

1. First caller with a key starts the operation
2. Subsequent callers with the same key get the same Promise
3. When operation completes, all callers receive the same Result
4. Key is removed from in-flight tracking

```
Time →

Caller A: fetchUserOnce('1') ─────┬──────────────────┐
                                  │                  │
Caller B: fetchUserOnce('1') ─────┤  (shares)        ├─→ All get same Result
                                  │                  │
Caller C: fetchUserOnce('1') ─────┘                  │
                                  ↓                  ↓
                            Start fetch         Complete
```

## Use Cases

### Prevent Thundering Herd

When cache expires, many requests hit the backend simultaneously:

```typescript
const getConfig = singleflight(
  () => fetchConfigFromAPI(),
  { key: () => 'config' }
);

// 100 concurrent requests → 1 API call
await Promise.all(
  Array.from({ length: 100 }, () => getConfig())
);
```

### API Deduplication

Multiple components requesting the same data:

```typescript
const fetchUserProfile = singleflight(
  (userId: string) => apiClient.getUser(userId),
  { key: (userId) => `profile:${userId}` }
);

// Sidebar, Header, and Content all request user
// → Only 1 API call
```

### Expensive Operations

Share computation across callers:

```typescript
const computeReport = singleflight(
  (month: string) => generateExpensiveReport(month),
  { key: (month) => `report:${month}` }
);
```

## With TTL Caching

Add TTL to cache successful results after completion:

```typescript
const fetchUserCached = singleflight(fetchUser, {
  key: (id) => `user:${id}`,
  ttl: 5000,  // Cache successful results for 5 seconds
});

const user1 = await fetchUserCached('1');  // Fetches
const user2 = await fetchUserCached('1');  // Returns cached (within TTL)

// After 5 seconds...
const user3 = await fetchUserCached('1');  // Fetches again
```

**Note:** TTL only caches successful results (`ok`). Errors are not cached.

## Low-Level API

For more control, use `createSingleflightGroup`:

```typescript
import { createSingleflightGroup } from 'awaitly/singleflight';

const group = createSingleflightGroup<User, 'NOT_FOUND'>();

// Execute with manual key
const user = await group.execute('user:1', () => fetchUser('1'));

// Check if request is in-flight
if (group.isInflight('user:1')) {
  console.log('Request pending');
}

// Get number of in-flight requests
console.log('In-flight:', group.size());

// Clear all tracking (does not cancel operations)
group.clear();
```

## API Reference

### singleflight

```typescript
singleflight<Args, T, E>(
  operation: (...args: Args) => AsyncResult<T, E>,
  options: {
    key: (...args: Args) => string;  // Extract cache key
    ttl?: number;                     // Optional TTL in ms (default: 0)
  }
): (...args: Args) => AsyncResult<T, E>
```

### createSingleflightGroup

```typescript
createSingleflightGroup<T, E>(): {
  execute: (key: string, operation: () => AsyncResult<T, E>) => AsyncResult<T, E>;
  isInflight: (key: string) => boolean;
  size: () => number;
  clear: () => void;
}
```

## TTL Semantics Deep Dive

Understanding how TTL works with singleflight:

### TTL lifecycle

```
Time →

Request A: ────┬───────────────────┬────────────────────────────
               │     In-flight     │        Cached (TTL)        │
               │                   │                            │
Request B: ────┤  (shares flight)  ├──→ Returns cached          │
               │                   │                            │
Request C: ────────────────────────┼──→ Returns cached          │
               │                   │                            │
               ↓                   ↓                            ↓
             Start              Complete                    TTL expires
```

### What gets cached

```typescript
const fetchUser = singleflight(
  async (id: string) => {
    const user = await db.find(id);
    return user ? ok(user) : err('NOT_FOUND');
  },
  { key: (id) => `user:${id}`, ttl: 5000 }
);

// ✅ Success cached for 5 seconds
await fetchUser('123'); // Fetches from DB
await fetchUser('123'); // Returns cached ok(user)

// ❌ Errors are NOT cached
await fetchUser('999'); // Returns err('NOT_FOUND')
await fetchUser('999'); // Fetches again (error wasn't cached)
```

### TTL vs in-flight deduplication

```typescript
// Without TTL: only dedupes concurrent requests
const noTtl = singleflight(fetchUser, { key: (id) => `user:${id}` });

await noTtl('1'); // Fetches
await noTtl('1'); // Fetches again (not concurrent)

// With TTL: dedupes + caches
const withTtl = singleflight(fetchUser, { key: (id) => `user:${id}`, ttl: 5000 });

await withTtl('1'); // Fetches
await withTtl('1'); // Returns cached
```

### When TTL starts

TTL countdown begins **after** the operation completes, not when it starts:

```typescript
const slowOp = singleflight(
  async () => {
    await sleep(10000); // Takes 10 seconds
    return ok(data);
  },
  { key: () => 'slow', ttl: 5000 }
);

// t=0: Request starts
await slowOp();
// t=10s: Request completes, TTL starts
await slowOp(); // Returns cached
// t=15s: TTL expires
await slowOp(); // Fetches again
```

## Cache Invalidation

### Manual invalidation with groups

```typescript
import { createSingleflightGroup } from 'awaitly/singleflight';

const userCache = createSingleflightGroup<User, 'NOT_FOUND'>();

// Fetch with caching
const getUser = (id: string) =>
  userCache.execute(`user:${id}`, () => fetchUser(id));

// Invalidate single user
const invalidateUser = (id: string) => {
  userCache.clear(`user:${id}`);
};

// Invalidate all users
const invalidateAllUsers = () => {
  userCache.clear();
};

// Example: Invalidate after update
const updateUser = async (id: string, data: UpdateData) => {
  const result = await db.users.update(id, data);
  invalidateUser(id); // Clear cache
  return result;
};
```

### Pattern: Write-through invalidation

```typescript
const userService = {
  cache: createSingleflightGroup<User, 'NOT_FOUND'>(),

  get: async (id: string) => {
    return this.cache.execute(`user:${id}`, () => fetchUser(id));
  },

  update: async (id: string, data: UpdateData) => {
    const result = await db.users.update(id, data);
    if (result.ok) {
      // Invalidate cache on successful write
      this.cache.clear(`user:${id}`);
    }
    return result;
  },

  delete: async (id: string) => {
    const result = await db.users.delete(id);
    if (result.ok) {
      this.cache.clear(`user:${id}`);
    }
    return result;
  },
};
```

### Pattern: Prefix-based invalidation

```typescript
const cache = createSingleflightGroup<unknown, string>();

// Fetch with prefixed keys
const getUser = (id: string) =>
  cache.execute(`user:${id}`, () => fetchUser(id));

const getUserOrders = (userId: string) =>
  cache.execute(`user:${userId}:orders`, () => fetchOrders(userId));

// Invalidate all data for a user
const invalidateUserData = (userId: string) => {
  // Clear any key starting with user:${userId}
  const keys = cache.keys().filter(k => k.startsWith(`user:${userId}`));
  keys.forEach(k => cache.clear(k));
};
```

## Memory Considerations

### In-flight tracking is lightweight

Singleflight only stores:
- Key → Promise mapping for in-flight requests
- Key → Result mapping for TTL cache

```typescript
// Memory footprint per key:
// - In-flight: ~100 bytes (key string + Promise reference)
// - Cached: depends on result size

const group = createSingleflightGroup();
console.log(`Tracking ${group.size()} in-flight requests`);
```

### Prevent memory leaks with TTL

```typescript
// ❌ Without TTL, cached results grow unbounded
const noTtl = singleflight(fetchUser, { key: (id) => `user:${id}` });
// (Actually, without TTL there's no caching, only in-flight deduplication)

// ✅ With TTL, cache auto-cleans
const withTtl = singleflight(fetchUser, {
  key: (id) => `user:${id}`,
  ttl: 60000, // 1 minute max
});
```

### Monitor cache size

```typescript
const userCache = createSingleflightGroup<User, string>();

// Periodic monitoring
setInterval(() => {
  const metrics = {
    inFlight: userCache.size(),
    // If you track cached separately
  };
  console.log('Cache metrics:', metrics);
}, 30000);
```

### Large result handling

```typescript
// Be cautious with large results + long TTL
const fetchLargeReport = singleflight(
  () => generateMassiveReport(), // Returns 50MB of data
  {
    key: () => 'report',
    ttl: 300000, // 5 minutes - this keeps 50MB in memory!
  }
);

// Better: shorter TTL or no caching for large results
const fetchLargeReportSafe = singleflight(
  () => generateMassiveReport(),
  {
    key: () => 'report',
    ttl: 30000, // 30 seconds max
  }
);
```

## Comparison with Caching

| Feature | Singleflight | Cache |
|---------|-------------|-------|
| Dedupes in-flight requests | Yes | No |
| Stores results after completion | With TTL | Yes |
| Prevents thundering herd | Yes | Only with lock |
| Memory usage | Minimal | Depends on size |

**Use singleflight when:** You want to prevent duplicate concurrent requests.

**Use caching when:** You want to reuse results across time.

**Use both when:** You want both behaviors (singleflight with TTL option).

## Common Patterns

### Stale-while-revalidate

```typescript
const cache = new Map<string, { value: User; timestamp: number }>();
const group = createSingleflightGroup<User, 'NOT_FOUND'>();

const getUserSWR = async (id: string) => {
  const cached = cache.get(id);
  const isStale = cached && Date.now() - cached.timestamp > 60000; // 1 min

  if (cached && !isStale) {
    return ok(cached.value);
  }

  // If stale, return cached but refresh in background
  if (cached && isStale) {
    // Don't await - let it refresh in background
    group.execute(`user:${id}`, async () => {
      const result = await fetchUser(id);
      if (result.ok) {
        cache.set(id, { value: result.value, timestamp: Date.now() });
      }
      return result;
    });
    return ok(cached.value); // Return stale immediately
  }

  // No cache - fetch and wait
  const result = await group.execute(`user:${id}`, () => fetchUser(id));
  if (result.ok) {
    cache.set(id, { value: result.value, timestamp: Date.now() });
  }
  return result;
};
```

### Graceful degradation

```typescript
const cache = new Map<string, User>();

const getUserWithFallback = async (id: string) => {
  const result = await singleflightFetch(id);

  if (result.ok) {
    cache.set(id, result.value); // Update cache
    return result;
  }

  // On error, return stale cache if available
  const stale = cache.get(id);
  if (stale) {
    console.warn(`Returning stale data for user ${id}`);
    return ok(stale);
  }

  return result; // No fallback available
};
```

## Next

[Learn about Webhooks & Events →/webhooks/)
