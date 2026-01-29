---
title: Parallel Operations
description: Run multiple operations concurrently
---

Execute multiple operations in parallel while maintaining typed error handling.

## Basic parallel execution

Use `allAsync` to run operations concurrently:

```typescript
import { allAsync } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

const workflow = createWorkflow({ fetchUser, fetchPosts, fetchComments });

const result = await workflow(async (step) => {
  const [user, posts, comments] = await step(() =>
    allAsync([
      fetchUser('1'),
      fetchPosts('1'),
      fetchComments('1'),
    ])
  );

  return { user, posts, comments };
});
```

## Fail-fast behavior

`allAsync` stops on the first error:

```typescript
const result = await allAsync([
  fetchUser('1'),        // Takes 100ms, succeeds
  fetchPosts('999'),     // Takes 50ms, fails with 'NOT_FOUND'
  fetchComments('1'),    // Takes 200ms, never completes
]);

// result.ok === false
// result.error === 'NOT_FOUND'
```

## Collect all errors

Use `allSettledAsync` to run all operations and collect all errors (if any fail):

```typescript
import { allSettledAsync } from 'awaitly';

const result = await allSettledAsync([
  fetchUser('1'),      // Succeeds
  fetchPosts('999'),   // Fails
  fetchComments('1'),  // Succeeds
]);

// Returns ok([values]) only if ALL succeed
// Returns err([SettledError]) if ANY fail, collecting all errors
if (result.ok) {
  // All operations succeeded
  const [user, posts, comments] = result.value;
  console.log('All succeeded:', user, posts, comments);
} else {
  // At least one failed - result.error is SettledError[]
  for (const settled of result.error) {
    console.log('Failed:', settled.error);
  }
}
```

**Note**: Unlike `Promise.allSettled()`, this returns a Result - `ok` if all succeed, `err` if any fail. This is consistent with awaitly's philosophy that all functions return Results. If you need partial success, use `partition()` after `Promise.all()` of Results.

## Partition successes and failures

```typescript
import { partition } from 'awaitly';

const results = await Promise.all([
  fetchUser('1'),
  fetchUser('2'),
  fetchUser('999'),
]);

const [successes, failures] = partition(results);
// successes: [User, User]
// failures: ['NOT_FOUND']
```

## Named parallel operations

Give parallel groups a name for visualization:

```typescript
const result = await workflow(async (step) => {
  const [user, posts] = await step(
    () => allAsync([fetchUser('1'), fetchPosts('1')]),
    { name: 'Fetch user data' }
  );

  return { user, posts };
});
```

## Race to first success

Use `anyAsync` to get the first successful result:

```typescript
import { anyAsync } from 'awaitly';

// Try multiple API endpoints, use first to respond
const result = await anyAsync([
  fetchFromPrimary(id),
  fetchFromBackup(id),
  fetchFromCache(id),
]);

if (result.ok) {
  // Got data from whichever responded first
  console.log(result.value);
}
```

## Bounded concurrency

For large sets, use `processInBatches`:

```typescript
import { processInBatches } from 'awaitly/batch';

const result = await processInBatches(
  userIds,
  (id) => fetchUser(id),
  { batchSize: 20, concurrency: 5 }
);
```

See [Batch Processing/../guides/batch-processing/) for details.

## Parallel with dependencies

Some operations depend on others:

```typescript
const result = await workflow(async (step) => {
  // Fetch user first
  const user = await step(fetchUser('1'));

  // Then fetch user's data in parallel
  const [posts, friends, settings] = await step(() =>
    allAsync([
      fetchPosts(user.id),
      fetchFriends(user.id),
      fetchSettings(user.id),
    ])
  );

  return { user, posts, friends, settings };
});
```

## Error handling in parallel operations

Errors from parallel operations are typed:

```typescript
const fetchUser = async (id: string): AsyncResult<User, 'USER_NOT_FOUND'> => { ... };
const fetchPosts = async (id: string): AsyncResult<Post[], 'POSTS_FETCH_ERROR'> => { ... };

const result = await allAsync([fetchUser('1'), fetchPosts('1')]);
// result.error is: 'USER_NOT_FOUND' | 'POSTS_FETCH_ERROR'
```

## Mapping over arrays

Process an array with typed errors:

```typescript
const userIds = ['1', '2', '3'];

const results = await allAsync(
  userIds.map((id) => fetchUser(id))
);

if (results.ok) {
  // results.value is User[]
  console.log(results.value.map((u) => u.name));
}
```

## With timeout

Add a timeout to parallel operations:

```typescript
const result = await workflow(async (step) => {
  const data = await step.withTimeout(
    () => allAsync([fetchUser('1'), fetchPosts('1')]),
    { ms: 5000, name: 'Fetch user data' }
  );

  return data;
});
```

## Full example

```typescript
import {
  allAsync,
  partition,
  ok,
  err,
  type AsyncResult,
} from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

type User = { id: string; name: string };
type Notification = { id: string; message: string };

const fetchUser = async (id: string): AsyncResult<User, 'USER_NOT_FOUND'> => {
  const user = await db.users.find(id);
  return user ? ok(user) : err('USER_NOT_FOUND');
};

const sendNotification = async (
  userId: string,
  message: string
): AsyncResult<Notification, 'SEND_FAILED'> => {
  try {
    const notification = await notificationService.send(userId, message);
    return ok(notification);
  } catch {
    return err('SEND_FAILED');
  }
};

const notifyUsers = createWorkflow({ fetchUser, sendNotification });

const result = await notifyUsers(async (step) => {
  const userIds = ['1', '2', '3', '4', '5'];

  // Fetch all users in parallel
  const usersResult = await step(() =>
    allAsync(userIds.map((id) => fetchUser(id)))
  );

  // Send notifications in parallel
  const notifications = await step(() =>
    allAsync(
      usersResult.map((user) =>
        sendNotification(user.id, 'Hello!')
      )
    )
  );

  return {
    notified: notifications.length,
  };
});
```
