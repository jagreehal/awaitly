/**
 * awaitly/duration
 *
 * Type-safe duration handling inspired by Effect's Duration module.
 * Prevents unit confusion (milliseconds vs seconds) with explicit constructors.
 */

// =============================================================================
// Duration Type
// =============================================================================

/**
 * A type-safe representation of a time duration.
 * Use the constructor functions (millis, seconds, etc.) to create durations.
 */
export interface Duration {
  readonly _tag: "Duration";
  readonly millis: number;
}

// =============================================================================
// Constructors
// =============================================================================

/**
 * Create a Duration from milliseconds.
 *
 * @example
 * ```typescript
 * const d = Duration.millis(500)
 * ```
 */
export function millis(ms: number): Duration {
  return { _tag: "Duration", millis: ms };
}

/**
 * Create a Duration from seconds.
 *
 * @example
 * ```typescript
 * const d = Duration.seconds(5)  // 5000ms
 * ```
 */
export function seconds(s: number): Duration {
  return { _tag: "Duration", millis: s * 1000 };
}

/**
 * Create a Duration from minutes.
 *
 * @example
 * ```typescript
 * const d = Duration.minutes(2)  // 120000ms
 * ```
 */
export function minutes(m: number): Duration {
  return { _tag: "Duration", millis: m * 60 * 1000 };
}

/**
 * Create a Duration from hours.
 *
 * @example
 * ```typescript
 * const d = Duration.hours(1)  // 3600000ms
 * ```
 */
export function hours(h: number): Duration {
  return { _tag: "Duration", millis: h * 60 * 60 * 1000 };
}

/**
 * Create a Duration from days.
 *
 * @example
 * ```typescript
 * const d = Duration.days(1)  // 86400000ms
 * ```
 */
export function days(d: number): Duration {
  return { _tag: "Duration", millis: d * 24 * 60 * 60 * 1000 };
}

/**
 * Zero duration.
 */
export const zero: Duration = { _tag: "Duration", millis: 0 };

/**
 * Infinite duration (represented as Infinity milliseconds).
 */
export const infinity: Duration = { _tag: "Duration", millis: Infinity };

// =============================================================================
// Conversions
// =============================================================================

/**
 * Convert a Duration to milliseconds.
 */
export function toMillis(duration: Duration): number {
  return duration.millis;
}

/**
 * Convert a Duration to seconds.
 */
export function toSeconds(duration: Duration): number {
  return duration.millis / 1000;
}

/**
 * Convert a Duration to minutes.
 */
export function toMinutes(duration: Duration): number {
  return duration.millis / (60 * 1000);
}

/**
 * Convert a Duration to hours.
 */
export function toHours(duration: Duration): number {
  return duration.millis / (60 * 60 * 1000);
}

/**
 * Convert a Duration to days.
 */
export function toDays(duration: Duration): number {
  return duration.millis / (24 * 60 * 60 * 1000);
}

// =============================================================================
// Operations
// =============================================================================

/**
 * Add two durations.
 *
 * @example
 * ```typescript
 * const total = Duration.add(Duration.seconds(5), Duration.millis(500))
 * // 5500ms
 * ```
 */
export function add(a: Duration, b: Duration): Duration {
  return { _tag: "Duration", millis: a.millis + b.millis };
}

/**
 * Subtract duration b from duration a.
 * Result is clamped to zero (no negative durations).
 *
 * @example
 * ```typescript
 * const remaining = Duration.subtract(Duration.seconds(5), Duration.seconds(2))
 * // 3000ms
 * ```
 */
export function subtract(a: Duration, b: Duration): Duration {
  return { _tag: "Duration", millis: Math.max(0, a.millis - b.millis) };
}

/**
 * Multiply a duration by a factor.
 *
 * @example
 * ```typescript
 * const doubled = Duration.multiply(Duration.seconds(5), 2)
 * // 10000ms
 * ```
 */
export function multiply(duration: Duration, factor: number): Duration {
  return { _tag: "Duration", millis: duration.millis * factor };
}

/**
 * Divide a duration by a divisor.
 *
 * @example
 * ```typescript
 * const half = Duration.divide(Duration.seconds(10), 2)
 * // 5000ms
 * ```
 */
export function divide(duration: Duration, divisor: number): Duration {
  return { _tag: "Duration", millis: duration.millis / divisor };
}

// =============================================================================
// Comparisons
// =============================================================================

/**
 * Check if duration a is less than duration b.
 */
export function lessThan(a: Duration, b: Duration): boolean {
  return a.millis < b.millis;
}

/**
 * Check if duration a is less than or equal to duration b.
 */
export function lessThanOrEqual(a: Duration, b: Duration): boolean {
  return a.millis <= b.millis;
}

/**
 * Check if duration a is greater than duration b.
 */
export function greaterThan(a: Duration, b: Duration): boolean {
  return a.millis > b.millis;
}

/**
 * Check if duration a is greater than or equal to duration b.
 */
export function greaterThanOrEqual(a: Duration, b: Duration): boolean {
  return a.millis >= b.millis;
}

/**
 * Check if two durations are equal.
 */
export function equals(a: Duration, b: Duration): boolean {
  return a.millis === b.millis;
}

/**
 * Get the minimum of two durations.
 */
export function min(a: Duration, b: Duration): Duration {
  return a.millis <= b.millis ? a : b;
}

/**
 * Get the maximum of two durations.
 */
export function max(a: Duration, b: Duration): Duration {
  return a.millis >= b.millis ? a : b;
}

/**
 * Clamp a duration between a minimum and maximum.
 */
export function clamp(duration: Duration, minimum: Duration, maximum: Duration): Duration {
  return min(max(duration, minimum), maximum);
}

// =============================================================================
// Predicates
// =============================================================================

/**
 * Check if a duration is zero.
 */
export function isZero(duration: Duration): boolean {
  return duration.millis === 0;
}

/**
 * Check if a duration is infinite.
 */
export function isInfinite(duration: Duration): boolean {
  return duration.millis === Infinity;
}

/**
 * Check if a duration is finite and positive.
 */
export function isFinite(duration: Duration): boolean {
  return Number.isFinite(duration.millis) && duration.millis > 0;
}

/**
 * Type guard to check if a value is a Duration.
 */
export function isDuration(value: unknown): value is Duration {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    value._tag === "Duration" &&
    "millis" in value &&
    typeof value.millis === "number"
  );
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format a duration as a human-readable string.
 *
 * @example
 * ```typescript
 * Duration.format(Duration.seconds(90))  // "1m 30s"
 * Duration.format(Duration.millis(500))  // "500ms"
 * ```
 */
export function format(duration: Duration): string {
  const ms = duration.millis;

  if (ms === Infinity) return "∞";
  if (ms === 0) return "0ms";

  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((ms % (60 * 1000)) / 1000);
  const millis = ms % 1000;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);
  if (millis > 0 && parts.length === 0) parts.push(`${millis}ms`);

  return parts.join(" ") || "0ms";
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse a duration from a string like "100ms", "5s", "2m", "1h", "1d".
 * Returns undefined if parsing fails.
 *
 * @example
 * ```typescript
 * Duration.parse("5s")    // Duration.seconds(5)
 * Duration.parse("100ms") // Duration.millis(100)
 * Duration.parse("2m")    // Duration.minutes(2)
 * ```
 */
export function parse(input: string): Duration | undefined {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!match) return undefined;

  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "ms":
      return millis(value);
    case "s":
      return seconds(value);
    case "m":
      return minutes(value);
    case "h":
      return hours(value);
    case "d":
      return days(value);
    default:
      return undefined;
  }
}

// =============================================================================
// Namespace Export
// =============================================================================

/**
 * Duration namespace with all functions for convenient access.
 *
 * @example
 * ```typescript
 * import { Duration } from "awaitly";
 *
 * const timeout = Duration.seconds(30);
 * const delay = Duration.millis(100);
 * const total = Duration.add(timeout, delay);
 *
 * console.log(Duration.format(total));  // "30s 100ms"
 * ```
 */
export const Duration = {
  // Constructors
  millis,
  seconds,
  minutes,
  hours,
  days,
  zero,
  infinity,

  // Conversions
  toMillis,
  toSeconds,
  toMinutes,
  toHours,
  toDays,

  // Operations
  add,
  subtract,
  multiply,
  divide,

  // Comparisons
  lessThan,
  lessThanOrEqual,
  greaterThan,
  greaterThanOrEqual,
  equals,
  min,
  max,
  clamp,

  // Predicates
  isZero,
  isInfinite,
  isFinite,
  isDuration,

  // Formatting
  format,
  parse,
} as const;

export type { Duration as DurationType };
