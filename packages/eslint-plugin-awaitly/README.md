# eslint-plugin-awaitly

ESLint rules for [awaitly](https://github.com/jagreehal/awaitly) workflow patterns. Catch common mistakes automatically.

## Installation

```bash
npm install eslint-plugin-awaitly --save-dev
```

## Usage (ESLint v9 Flat Config)

```js
// eslint.config.js
import awaitly from 'eslint-plugin-awaitly';

export default [
  ...awaitly.configs.recommended,
  // your other configs
];
```

## Rules

### `awaitly/require-step-id` (error)

Requires a string literal as the first argument to `step()`. Use `step('id', fn, options?)` or `step('id', result, options?)`.

```typescript
// BAD - missing step ID
step(() => fetchUser('1'));
step(fetchUser('1'), { key: 'user:1' });

// GOOD - string ID as first argument
step('fetchUser', () => fetchUser('1'));
step('fetchUser', () => deps.fetchUser('1'), { key: 'user:1' });
```

**Note**: All step types take a string as the first argument (ID or name): `step.retry(id, operation, options)`, `step.withTimeout(id, operation, options)`, `step.try(id, operation, opts)`, `step.sleep(id, duration, opts?)`, `step.fromResult(id, operation, opts)`, `step.parallel(name, operations | callback)`, `step.race(name, callback)`, `step.allSettled(name, callback)`.

### `awaitly/no-immediate-execution` (error)

Prevents `step('id', fn())` patterns where the function executes immediately instead of being wrapped in a thunk. The executor is the second argument (after the ID).

```typescript
// BAD - executes immediately, defeats caching/retries
step('fetchUser', fetchUser('1'));
step('fetchUser', deps.fetchUser('1'), { key: 'user:1' });

// GOOD - thunk lets step control execution
step('fetchUser', () => fetchUser('1'));
step('fetchUser', () => deps.fetchUser('1'), { key: 'user:1' });
```

**Autofix**: Wraps the executor in an arrow function (and inserts a suggested ID if missing).

### `awaitly/require-thunk-for-key` (error)

When using `step()` with a `key` option, the executor (second argument, after the ID) must be a thunk. Without a thunk, the function executes immediately *before* the cache can be checked.

**Important clarification**: The cache IS populated and `step_complete` events ARE emitted with the direct pattern. However, the operation runs regardless of cache state, defeating the purpose of caching.

```typescript
// BAD - fetchUser() runs immediately, even if cache has value
step('fetchUser', fetchUser('1'), { key: 'user:1' });

// GOOD - fetchUser() only runs on cache miss
step('fetchUser', () => fetchUser('1'), { key: 'user:1' });
```

**Autofix**: Wraps the executor in an arrow function (and inserts a suggested ID if missing).

### `awaitly/stable-cache-keys` (error)

Prevents non-deterministic values like `Date.now()`, `Math.random()`, or `uuid()` in cache keys.

```typescript
// BAD - new key every time, cache never hits
step('fetch', () => fetch(id), { key: `user:${Date.now()}` });
step('fetch', () => fetch(id), { key: `user:${Math.random()}` });

// GOOD - stable key enables caching
step('fetch', () => fetch(id), { key: `user:${userId}` });
```

### `awaitly/no-options-on-executor` (error)

Prevents passing workflow options (like `cache`, `onEvent`, `snapshot`) to the workflow executor function. Options must be passed to `createWorkflow()` instead.

```typescript
// BAD - options are silently ignored here
await workflow({ cache: new Map() }, async (step) => { ... });
await workflow({ onEvent: handler }, async (step) => { ... });

// GOOD - options go to createWorkflow
const workflow = createWorkflow('workflow', deps, { cache: new Map() });
await workflow(async (step) => { ... });
```

Detected option keys: `cache`, `onEvent`, `resumeState`, `snapshot`, `serialization`, `snapshotSerialization`, `onUnknownSteps`, `onDefinitionChange`, `onError`, `onBeforeStart`, `onAfterStep`, `shouldRun`, `createContext`, `signal`, `strict`, `catchUnexpected`, `description`, `markdown`, `streamStore`.

## Why These Rules?

The #1 mistake with awaitly is forgetting the thunk:

```typescript
// This looks correct but is wrong:
const user = await step('fetchUser', fetchUser('1'), { key: 'user:1' });
```

The function `fetchUser('1')` executes **immediately** when JavaScript evaluates this line. The `step()` function receives the Promise (already started), not a function it can call.

**Common misconception**: The cache IS populated and `step_complete` events ARE emitted with the direct pattern. However, the operation has already run before step() could check the cache. This defeats:

- **Caching efficiency**: step can't skip execution on cache hit - the function already ran
- **Retries**: step can't re-call on failure - it only has the Promise
- **Resume**: step can't skip already-completed work - it already started

The correct pattern:

```typescript
const user = await step('fetchUser', () => fetchUser('1'), { key: 'user:1' });
```

Now `step()` receives a function it can call **after** checking the cache, and can skip execution entirely on cache hit.

## Configuration

To enable only specific rules:

```js
// eslint.config.js
import awaitly from 'eslint-plugin-awaitly';

export default [
  {
    plugins: {
      awaitly,
    },
    rules: {
      'awaitly/no-immediate-execution': 'error',
      // disable others if needed
    },
  },
];
```

## License

MIT
