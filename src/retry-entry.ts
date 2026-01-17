/**
 * awaitly/retry
 *
 * Composable retry and polling strategies: build complex backoff patterns
 * by composing simple building blocks.
 *
 * @example
 * ```typescript
 * import { Schedule, Duration } from 'awaitly/retry';
 *
 * // Exponential backoff with jitter, max 5 attempts
 * const retryStrategy = Schedule.exponential(Duration.millis(100))
 *   .pipe(Schedule.jittered(0.2))
 *   .pipe(Schedule.upTo(5));
 *
 * // Use with workflows
 * const result = await step.retry(fetchData, { schedule: retryStrategy });
 * ```
 */

// Re-export everything from schedule.ts
export * from "./schedule";

// Also export Duration for convenience
export {
  type Duration as DurationType,
  Duration,
  millis,
  seconds,
  minutes,
  hours,
  days,
  toMillis,
  toSeconds,
  toMinutes,
  toHours,
  toDays,
  isDuration,
} from "./duration";
