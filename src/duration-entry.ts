/**
 * awaitly/duration
 *
 * Type-safe time duration utilities: avoid "is this milliseconds or seconds?" confusion.
 *
 * @example
 * ```typescript
 * import { Duration, millis, seconds, toMillis } from 'awaitly/duration';
 *
 * const timeout = Duration.seconds(30);
 * const delay = Duration.millis(100);
 *
 * // Convert to milliseconds for setTimeout
 * setTimeout(() => {}, toMillis(timeout));
 * ```
 */

export {
  // Types
  type Duration as DurationType,

  // Namespace
  Duration,

  // Individual exports (for tree-shaking)
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

  // Arithmetic
  add,
  subtract,
  multiply,
  divide,

  // Comparison
  lessThan,
  lessThanOrEqual,
  greaterThan,
  greaterThanOrEqual,
  equals,

  // Utilities
  isZero,
  isInfinite,
  isFinite,
  min,
  max,
  clamp,
  format,
  parse,

  // Constants
  zero,
  infinity,
} from "./duration";
