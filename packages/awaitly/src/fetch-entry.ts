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

export {
  // Types
  type DefaultFetchError,
  type FetchErrorMapper,
  type FetchOptions,

  // Functions
  fetchJson,
  fetchText,
  fetchBlob,
  fetchArrayBuffer,
} from "./fetch";
