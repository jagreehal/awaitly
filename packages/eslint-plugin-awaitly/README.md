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

### `awaitly/no-immediate-execution` (error)

Prevents `step(fn())` patterns where the function executes immediately instead of being wrapped in a thunk.

```typescript
// BAD - executes immediately, defeats caching/retries
step(fetchUser('1'));
step(deps.fetchUser('1'), { key: 'user:1' });

// GOOD - thunk lets step control execution
step(() => fetchUser('1'));
step(() => deps.fetchUser('1'), { key: 'user:1' });
```

**Autofix**: Wraps the call in an arrow function.

### `awaitly/require-thunk-for-key` (error)

When using `step()` with a `key` option, the first argument must be a thunk. Without a thunk, the cache is never checked.

```typescript
// BAD - key option is useless without thunk
step(fetchUser('1'), { key: 'user:1' });

// GOOD - thunk enables caching with key
step(() => fetchUser('1'), { key: 'user:1' });
```

**Autofix**: Wraps the call in an arrow function.

### `awaitly/stable-cache-keys` (error)

Prevents non-deterministic values like `Date.now()`, `Math.random()`, or `uuid()` in cache keys.

```typescript
// BAD - new key every time, cache never hits
step(() => fetch(id), { key: `user:${Date.now()}` });
step(() => fetch(id), { key: `user:${Math.random()}` });

// GOOD - stable key enables caching
step(() => fetch(id), { key: `user:${userId}` });
```

## Why These Rules?

The #1 mistake with awaitly is forgetting the thunk:

```typescript
// This looks correct but is wrong:
const user = await step(fetchUser('1'), { key: 'user:1' });
```

The function `fetchUser('1')` executes **immediately** when JavaScript evaluates this line. The `step()` function receives the Promise (already started), not a function it can call. This defeats:

- **Caching**: step can't check the cache before calling
- **Retries**: step can't re-call on failure
- **Resume**: step can't skip already-completed work

The correct pattern:

```typescript
const user = await step(() => fetchUser('1'), { key: 'user:1' });
```

Now `step()` receives a function it can call **after** checking the cache.

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
