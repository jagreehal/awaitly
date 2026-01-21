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
