---
title: Your First Workflow
description: Build a simple workflow with typed errors in 5 minutes
---

This guide walks through building a workflow that fetches a user and their posts, with typed error handling.

## Define your operations

Operations return `AsyncResult<T, E>` - either `ok(value)` or `err(error)`:

```typescript
import { ok, err, type AsyncResult } from 'awaitly';

type User = { id: string; name: string };
type Post = { id: number; title: string };

const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> => {
  if (id === '1') {
    return ok({ id: '1', name: 'Alice' });
  }
  return err('NOT_FOUND');
};

const fetchPosts = async (userId: string): AsyncResult<Post[], 'FETCH_ERROR'> => {
  return ok([
    { id: 1, title: 'Hello World' },
    { id: 2, title: 'Second Post' },
  ]);
};
```

## Create the workflow

Pass your operations to `createWorkflow`. Error types are inferred automatically:

```typescript
import { createWorkflow } from 'awaitly/workflow';

const loadUserData = createWorkflow({ fetchUser, fetchPosts });
```

## Run it

Use `step()` to execute operations. If any step fails, the workflow exits early:

```typescript
const result = await loadUserData(async (step) => {
  const user = await step(fetchUser('1'));
  const posts = await step(fetchPosts(user.id));
  return { user, posts };
});
```

## Handle the result

Check `result.ok` to determine success or failure:

```typescript
if (result.ok) {
  console.log(result.value.user.name);
  console.log(result.value.posts.length, 'posts');
} else {
  // TypeScript knows: result.error is 'NOT_FOUND' | 'FETCH_ERROR' | UnexpectedError
  switch (result.error) {
    case 'NOT_FOUND':
      console.log('User not found');
      break;
    case 'FETCH_ERROR':
      console.log('Failed to fetch posts');
      break;
    default:
      // UnexpectedError - something threw an exception
      console.log('Unexpected error:', result.error);
  }
}
```

## Complete example

```typescript
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

type User = { id: string; name: string };
type Post = { id: number; title: string };

const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
  id === '1' ? ok({ id: '1', name: 'Alice' }) : err('NOT_FOUND');

const fetchPosts = async (userId: string): AsyncResult<Post[], 'FETCH_ERROR'> =>
  ok([{ id: 1, title: 'Hello World' }]);

const loadUserData = createWorkflow({ fetchUser, fetchPosts });

const result = await loadUserData(async (step) => {
  const user = await step(fetchUser('1'));
  const posts = await step(fetchPosts(user.id));
  return { user, posts };
});

if (result.ok) {
  console.log(`${result.value.user.name} has ${result.value.posts.length} posts`);
}
```

## What happens on error?

Change `fetchUser('1')` to `fetchUser('999')`:

```typescript
const result = await loadUserData(async (step) => {
  const user = await step(fetchUser('999')); // Returns err('NOT_FOUND')
  // This line never runs
  const posts = await step(fetchPosts(user.id));
  return { user, posts };
});

console.log(result.ok);    // false
console.log(result.error); // 'NOT_FOUND'
```

The workflow exits at the first error. No need for try/catch or manual error checking.

## Next

[Learn about error handling →](../error-handling/)
