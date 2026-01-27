---
title: Extending Awaitly
description: Build custom utilities that return Result types
---

Build your own utilities that integrate seamlessly with awaitly workflows. This guide walks through the pattern using the built-in fetch helper as a real example.

---

## Why Build Custom Utilities?

When you use the same patterns repeatedly, wrapping them in a utility helps:

- **Enforce Result types** - Never forget to handle errors
- **Reduce boilerplate** - Write the error handling once
- **Type safety** - Get typed errors that TypeScript understands

For example, instead of writing this every time:

```typescript
const res = await fetch('/api/users');
if (!res.ok) throw new Error(`HTTP ${res.status}`);
return res.json();
```

You can use a utility that returns a Result:

```typescript
const result = await step(fetchJson('/api/users'));
// TypeScript knows: result.ok ? result.value : result.error
```

---

## The Core Pattern

Every awaitly utility follows the same pattern:

```typescript
import type { AsyncResult } from 'awaitly';
import { ok, err } from 'awaitly';

function myUtility<T>(input: string): AsyncResult<T, 'ERROR_A' | 'ERROR_B'> {
  // Success: return ok(value)
  // Failure: return err(errorType, { cause: details })
}
```

The key rules:

1. **Return `AsyncResult<T, E>`** - A Promise that resolves to `Ok<T>` or `Err<E>`
2. **Never throw** - Always return `err()` instead of throwing
3. **Include error context** - Put details in the `cause` field for debugging

---

## Real Example: The Fetch Helper

Let's walk through how `fetchJson` from `awaitly/fetch` is built. This is actual code from the library.

### Step 1: Define Your Error Types

First, define the errors your utility can return. Use string literals (like `"NOT_FOUND"`) instead of classes or enums - they're simpler and TypeScript handles them better.

```typescript
// Default errors that cover common HTTP scenarios
type DefaultFetchError =
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SERVER_ERROR"
  | "NETWORK_ERROR";
```

**Why string literals?**

- TypeScript can narrow them in `if` statements
- They're easy to read in error messages
- No need for imports or class definitions
- They work with discriminated unions (more on this later)

### Step 2: Define Options

Extend existing types when possible. For fetch, we extend `RequestInit` (the standard fetch options) and add our custom error handling:

```typescript
// A function that maps status codes to errors
type FetchErrorMapper<TError> = (
  status: number,
  response: Response
) => TError;

// Extend RequestInit, add custom error option
type FetchOptions<TError = DefaultFetchError> = RequestInit & {
  error?: FetchErrorMapper<TError> | TError;
};
```

This lets users pass standard fetch options (`method`, `headers`, `body`) plus an optional `error` mapper.

### Step 3: Implement the Core Logic

Here's the core pattern - handle both success and error paths, never throw:

```typescript
import type { AsyncResult, Result } from 'awaitly';
import { ok, err } from 'awaitly';

async function fetchWithErrorHandling<T, TError>(
  url: string | URL | Request,
  options: FetchOptions<TError> | undefined,
  parseResponse: (response: Response) => Promise<T>
): Promise<Result<T, TError>> {
  try {
    const { error: errorOption, ...fetchOptions } = options ?? {};
    const response = await fetch(url, fetchOptions);

    // Success path (2xx status)
    if (response.ok) {
      try {
        const data = await parseResponse(response);
        return ok(data);
      } catch (parseError) {
        // JSON parsing failed
        return err("NETWORK_ERROR" as TError, { cause: parseError });
      }
    }

    // HTTP error path (4xx, 5xx)
    const status = response.status;
    let errorValue: TError;

    if (errorOption !== undefined) {
      if (typeof errorOption === "function") {
        // Custom mapper: (status, response) => error
        errorValue = (errorOption as FetchErrorMapper<TError>)(status, response);
      } else {
        // Single value for all errors
        errorValue = errorOption;
      }
    } else {
      // Use default mapping
      errorValue = defaultErrorMapper(status) as TError;
    }

    // Include status in cause for debugging
    return err(errorValue, {
      cause: { status, statusText: response.statusText }
    });

  } catch (fetchError) {
    // Network error (no connection, CORS, timeout)
    return err("NETWORK_ERROR" as TError, { cause: fetchError });
  }
}
```

**Key points:**

- Successful responses (`response.ok`) return `ok(data)`
- HTTP errors (404, 500, etc.) return `err(errorType)` with status in `cause`
- Network errors (fetch throws) return `err("NETWORK_ERROR")` with the original error in `cause`
- The `cause` field preserves debugging info without cluttering the error type

### Step 4: Provide Sensible Defaults

Create a default mapper for common cases:

```typescript
function defaultErrorMapper(status: number): DefaultFetchError {
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status >= 500) return "SERVER_ERROR";
  return "SERVER_ERROR"; // Fallback
}
```

This handles 80% of use cases. Users who need custom errors can override with the `error` option.

### Step 5: Create Variants

If you have multiple similar functions (like `fetchJson`, `fetchText`, `fetchBlob`), extract the shared logic into a helper and pass the variant-specific behavior as a parameter:

```typescript
// Each variant just specifies how to parse the response
export function fetchJson<T, TError = DefaultFetchError>(
  url: string | URL | Request,
  options?: FetchOptions<TError>
): AsyncResult<T, TError> {
  return fetchWithErrorHandling(
    url,
    options,
    async (response) => {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
  );
}

export function fetchText<TError = DefaultFetchError>(
  url: string | URL | Request,
  options?: FetchOptions<TError>
): AsyncResult<string, TError> {
  return fetchWithErrorHandling(
    url,
    options,
    async (response) => response.text()
  );
}
```

This DRY approach means bug fixes and improvements happen in one place.

### Step 6: Add to Build (Library Authors)

If you're contributing to awaitly or building a plugin, add your entry point to the build:

**tsup.config.ts:**

```typescript
entry: {
  // ... other entries
  fetch: 'src/fetch.ts',
}
```

**package.json:**

```json
{
  "exports": {
    "./fetch": {
      "types": "./dist/fetch.d.ts",
      "import": "./dist/fetch.js",
      "require": "./dist/fetch.cjs"
    }
  }
}
```

---

## Testing Your Utility

Test both success and error paths. Here's a quick example:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchJson } from './fetch';

describe('fetchJson', () => {
  it('returns ok with parsed JSON on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"name":"Alice"}'),
    });

    const result = await fetchJson('/api/user');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ name: 'Alice' });
    }
  });

  it('returns NOT_FOUND error on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await fetchJson('/api/user');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('NOT_FOUND');
      expect(result.cause).toEqual({
        status: 404,
        statusText: 'Not Found',
      });
    }
  });

  it('returns NETWORK_ERROR when fetch throws', async () => {
    const networkError = new Error('Failed to fetch');
    global.fetch = vi.fn().mockRejectedValue(networkError);

    const result = await fetchJson('/api/user');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('NETWORK_ERROR');
      expect(result.cause).toBe(networkError);
    }
  });
});
```

For more testing patterns, see the [Testing guide](../testing/).

---

## Checklist

When building a custom utility:

- [ ] Return `AsyncResult<T, E>` from your function
- [ ] Define clear error types as string literals
- [ ] Use `ok(value)` for success, `err(type, { cause })` for failure
- [ ] Never throw - always return `err()`
- [ ] Include debugging info in the `cause` field
- [ ] Provide sensible defaults for common cases
- [ ] Allow customization via options
- [ ] Test success path and each error type

---

## Next Steps

- [Result Types](../foundations/result-types/) - Deep dive into `Ok`, `Err`, and type narrowing
- [Testing](../guides/testing/) - Comprehensive testing patterns for workflows
- [Retries & Timeouts](../guides/retries-timeouts/) - Add resilience to your utilities
