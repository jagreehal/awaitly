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
  // Token bucket (original)
  type RateLimiterConfig,
  type RateLimiterStats,
  type RateLimiter,
  createRateLimiter,

  // Fixed window
  type FixedWindowLimiterConfig,
  type FixedWindowLimiterStats,
  type FixedWindowLimiter,
  createFixedWindowLimiter,

  // Cost-based token bucket
  type CostBasedRateLimiterConfig,
  type CostBasedRateLimiterStats,
  type CostBasedRateLimiter,
  createCostBasedRateLimiter,

  // Concurrency
  type ConcurrencyLimiterConfig,
  type ConcurrencyLimiterStats,
  type ConcurrencyLimiter,
  createConcurrencyLimiter,

  // Combined
  type CombinedLimiterConfig,
  createCombinedLimiter,

  // Errors
  type RateLimitExceededError,
  type QueueFullError,
  isRateLimitExceededError,
  isQueueFullError,

  // Presets
  rateLimiterPresets,
} from "./rate-limiter";
