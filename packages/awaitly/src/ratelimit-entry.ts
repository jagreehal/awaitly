/**
 * awaitly/ratelimit
 *
 * Rate limiting and concurrency control: respect API limits and manage throughput.
 *
 * @example
 * ```typescript
 * import { createRateLimiter, createConcurrencyLimiter } from 'awaitly/ratelimit';
 *
 * // 10 requests per second with burst capacity of 20
 * const rateLimiter = createRateLimiter('api', {
 *   maxPerSecond: 10,
 *   burstCapacity: 20,
 * });
 *
 * // Max 5 concurrent operations
 * const concurrencyLimiter = createConcurrencyLimiter('db', {
 *   maxConcurrent: 5,
 * });
 *
 * const result = await rateLimiter.execute(() => callApi(params));
 * ```
 */

export {
  type RateLimiterConfig,
  type ConcurrencyLimiterConfig,
  type RateLimitExceededError,
  type QueueFullError,
  type RateLimiterStats,
  type ConcurrencyLimiterStats,
  type RateLimiter,
  type ConcurrencyLimiter,
  type CombinedLimiterConfig,
  isRateLimitExceededError,
  isQueueFullError,
  createRateLimiter,
  createConcurrencyLimiter,
  createCombinedLimiter,
  rateLimiterPresets,
} from "./rate-limiter";
