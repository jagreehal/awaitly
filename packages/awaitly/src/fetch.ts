/**
 * awaitly/fetch
 *
 * Type-safe fetch helpers that return AsyncResult, eliminating boilerplate
 * for status checks, JSON parsing, and error handling.
 *
 * @example
 * ```typescript
 * import { fetchJson } from 'awaitly/fetch';
 * import { step } from 'awaitly';
 *
 * // Simple case - auto JSON parsing, auto status error
 * const data = await step(fetchJson('/api/users/1'));
 * // Returns: AsyncResult<User, 'NOT_FOUND' | 'SERVER_ERROR' | 'NETWORK_ERROR'>
 *
 * // With custom error mapping
 * const data = await step(fetchJson('/api/users/1', {
 *   error: (status, response) => {
 *     if (status === 404) return 'USER_NOT_FOUND' as const;
 *     if (status === 429) return 'RATE_LIMITED' as const;
 *     return 'API_ERROR' as const;
 *   }
 * }));
 *
 * // With full fetch options
 * const data = await step(fetchJson('/api/users/1', {
 *   method: 'POST',
 *   headers: { 'Authorization': 'Bearer token' },
 *   body: JSON.stringify({ name: 'Alice' })
 * }));
 * ```
 */

import type { AsyncResult, Result } from "./core";
import { ok, err } from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * Default error types returned by fetch helpers when no custom error mapper is provided.
 */
export type DefaultFetchError =
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SERVER_ERROR"
  | "NETWORK_ERROR";

/**
 * Function to map HTTP status codes to error values.
 * @param status - The HTTP status code
 * @param response - The Response object for additional context
 * @returns The error value (string, number, or object)
 */
export type FetchErrorMapper<TError = DefaultFetchError> = (
  status: number,
  response: Response
) => TError;

/**
 * Options for fetch helpers, extending RequestInit with optional error handling.
 */
export type FetchOptions<TError = DefaultFetchError> = RequestInit & {
  /**
   * Custom error mapper function or a single error value to use for all failures.
   * If a function is provided, it will be called with the status code and response.
   * If a single value is provided, it will be used for all HTTP errors.
   * Network errors (fetch rejections) will always map to 'NETWORK_ERROR' unless
   * a custom mapper handles them.
   */
  error?: FetchErrorMapper<TError> | TError;
};

// =============================================================================
// Default Error Mapping
// =============================================================================

/**
 * Maps HTTP status codes to default error types.
 */
function defaultErrorMapper(status: number): DefaultFetchError {
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status >= 500) return "SERVER_ERROR";
  // Default for other 4xx/5xx
  return "SERVER_ERROR";
}

// =============================================================================
// Core Fetch Implementation
// =============================================================================

/**
 * Internal helper that performs the fetch and handles errors.
 */
async function fetchWithErrorHandling<T, TError = DefaultFetchError>(
  url: string | URL | Request,
  options: FetchOptions<TError> | undefined,
  parseResponse: (response: Response) => Promise<T>
): Promise<Result<T, TError>> {
  try {
    const { error: errorOption, ...fetchOptions } = options ?? {};

    const response = await fetch(url, fetchOptions);

    // Handle successful responses (2xx)
    if (response.ok) {
      try {
        const data = await parseResponse(response);
        return ok(data);
      } catch (parseError) {
        // Parsing error (e.g., invalid JSON)
        // Treat as network error since it's a data corruption issue
        return err("NETWORK_ERROR" as TError, { cause: parseError });
      }
    }

    // Handle HTTP errors (non-2xx)
    const status = response.status;

    // Determine error value
    let errorValue: TError;
    if (errorOption !== undefined) {
      if (typeof errorOption === "function") {
        // Custom error mapper function
        errorValue = (errorOption as FetchErrorMapper<TError>)(status, response) as TError;
      } else {
        // Single error value for all HTTP errors
        errorValue = errorOption as TError;
      }
    } else {
      // Default error mapping
      errorValue = defaultErrorMapper(status) as TError;
    }

    return err(errorValue, { cause: { status, statusText: response.statusText } });
  } catch (fetchError) {
    // Network errors (fetch rejects) - e.g., no connection, timeout, CORS
    // Always map to NETWORK_ERROR unless custom mapper handles it
    // (Note: custom mapper won't be called for network errors since fetch rejects)
    return err("NETWORK_ERROR" as TError, { cause: fetchError });
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetches a URL and parses the response as JSON.
 *
 * @param url - The URL to fetch (string, URL, or Request object)
 * @param options - Fetch options including RequestInit and optional error handling
 * @returns AsyncResult with parsed JSON data or an error
 *
 * @example
 * ```typescript
 * // Simple usage with default error mapping
 * const result = await fetchJson<User>('/api/users/1');
 * // Error type: 'NOT_FOUND' | 'SERVER_ERROR' | 'NETWORK_ERROR' | ...
 *
 * // With custom error mapping
 * const result = await fetchJson<User, 'USER_NOT_FOUND' | 'API_ERROR'>(
 *   '/api/users/1',
 *   {
 *     error: (status) => status === 404 ? 'USER_NOT_FOUND' as const : 'API_ERROR' as const
 *   }
 * );
 * ```
 */
export function fetchJson<T = unknown, TError = DefaultFetchError>(
  url: string | URL | Request,
  options?: FetchOptions<TError>
): AsyncResult<T, TError> {
  return fetchWithErrorHandling(
    url,
    options,
    async (response) => {
      const text = await response.text();
      if (!text) {
        // Empty response - return null as JSON
        return null as T;
      }
      return JSON.parse(text) as T;
    }
  );
}

/**
 * Fetches a URL and returns the response as text.
 *
 * @param url - The URL to fetch (string, URL, or Request object)
 * @param options - Fetch options including RequestInit and optional error handling
 * @returns AsyncResult with response text or an error
 *
 * @example
 * ```typescript
 * const result = await fetchText('/api/data.txt');
 * if (result.ok) {
 *   console.log(result.value); // string
 * }
 * ```
 */
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

/**
 * Fetches a URL and returns the response as a Blob.
 *
 * @param url - The URL to fetch (string, URL, or Request object)
 * @param options - Fetch options including RequestInit and optional error handling
 * @returns AsyncResult with Blob or an error
 *
 * @example
 * ```typescript
 * const result = await fetchBlob('/api/image.png');
 * if (result.ok) {
 *   const url = URL.createObjectURL(result.value);
 * }
 * ```
 */
export function fetchBlob<TError = DefaultFetchError>(
  url: string | URL | Request,
  options?: FetchOptions<TError>
): AsyncResult<Blob, TError> {
  return fetchWithErrorHandling(
    url,
    options,
    async (response) => response.blob()
  );
}

/**
 * Fetches a URL and returns the response as an ArrayBuffer.
 *
 * @param url - The URL to fetch (string, URL, or Request object)
 * @param options - Fetch options including RequestInit and optional error handling
 * @returns AsyncResult with ArrayBuffer or an error
 *
 * @example
 * ```typescript
 * const result = await fetchArrayBuffer('/api/binary');
 * if (result.ok) {
 *   const buffer = result.value;
 * }
 * ```
 */
export function fetchArrayBuffer<TError = DefaultFetchError>(
  url: string | URL | Request,
  options?: FetchOptions<TError>
): AsyncResult<ArrayBuffer, TError> {
  return fetchWithErrorHandling(
    url,
    options,
    async (response) => response.arrayBuffer()
  );
}
