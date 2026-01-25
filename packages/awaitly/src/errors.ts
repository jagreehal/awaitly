/**
 * awaitly/errors
 *
 * Pre-built error types for common failure scenarios.
 * Uses TaggedError for type-safe exhaustive matching.
 *
 * @example
 * ```typescript
 * import { TimeoutError, RetryExhaustedError, RateLimitError, CircuitOpenError } from 'awaitly/errors';
 *
 * // Create errors
 * const timeout = new TimeoutError({ operation: 'fetchUser', ms: 5000 });
 * const retryFailed = new RetryExhaustedError({ operation: 'sendEmail', attempts: 3 });
 *
 * // Pattern match
 * TaggedError.match(error, {
 *   TimeoutError: (e) => `${e.operation} timed out after ${e.ms}ms`,
 *   RetryExhaustedError: (e) => `${e.operation} failed after ${e.attempts} attempts`,
 *   RateLimitError: (e) => `Rate limit exceeded, retry after ${e.retryAfterMs}ms`,
 *   CircuitOpenError: (e) => `Circuit ${e.circuitName} is open`,
 * });
 * ```
 */

import { TaggedError } from "./tagged-error";

// =============================================================================
// Error Factory
// =============================================================================

/**
 * Factory function to create tagged error classes with default values.
 *
 * This is a convenience wrapper around TaggedError that allows specifying
 * default property values for error types.
 *
 * @example
 * ```typescript
 * // Define custom error with defaults
 * const NetworkError = makeError('NetworkError', {
 *   defaults: { retryable: true },
 *   message: (p) => `Network error: ${p.reason}`,
 * });
 *
 * class MyNetworkError extends NetworkError<{ reason: string; code?: number }> {}
 *
 * const error = new MyNetworkError({ reason: 'Connection refused' });
 * // error.retryable === true (from defaults)
 * ```
 */
export function makeError<Tag extends string>(
  tag: Tag,
  options?: {
    message?: (props: Record<string, unknown>) => string;
    defaults?: Record<string, unknown>;
  }
) {
  const messageGenerator = options?.message ?? (() => tag);
  const defaults = options?.defaults ?? {};

  // Create base class using TaggedError
  const BaseClass = TaggedError(tag, {
    message: (props: Record<string, unknown>) =>
      messageGenerator({ ...defaults, ...props }),
  });

  // Return a factory that applies defaults
  return class extends BaseClass {
    constructor(props?: Record<string, unknown>) {
      super({ ...defaults, ...props } as Record<string, unknown>);
      // Apply defaults to instance
      Object.assign(this, { ...defaults, ...props });
    }
  };
}

// =============================================================================
// Pre-built Error Types
// =============================================================================

/**
 * Error thrown when an operation times out.
 *
 * @example
 * ```typescript
 * const error = new TimeoutError({
 *   operation: 'fetchUser',
 *   ms: 5000,
 * });
 * console.log(error.message); // "TimeoutError: fetchUser timed out after 5000ms"
 * ```
 */
export class TimeoutError extends TaggedError("TimeoutError", {
  message: (p: {
    /** Name of the operation that timed out */
    operation?: string;
    /** Timeout duration in milliseconds */
    ms: number;
  }) =>
    p.operation
      ? `TimeoutError: ${p.operation} timed out after ${p.ms}ms`
      : `TimeoutError: Operation timed out after ${p.ms}ms`,
}) {}

/**
 * Error thrown when all retry attempts are exhausted.
 *
 * @example
 * ```typescript
 * const error = new RetryExhaustedError({
 *   operation: 'sendEmail',
 *   attempts: 3,
 *   lastError: originalError,
 * });
 * console.log(error.message); // "RetryExhaustedError: sendEmail failed after 3 attempts"
 * ```
 */
export class RetryExhaustedError extends TaggedError("RetryExhaustedError", {
  message: (p: {
    /** Name of the operation that failed */
    operation?: string;
    /** Total number of retry attempts made */
    attempts: number;
    /** The last error encountered before giving up */
    lastError?: unknown;
  }) =>
    p.operation
      ? `RetryExhaustedError: ${p.operation} failed after ${p.attempts} attempts`
      : `RetryExhaustedError: Operation failed after ${p.attempts} attempts`,
}) {}

/**
 * Error thrown when a rate limit is exceeded.
 *
 * @example
 * ```typescript
 * const error = new RateLimitError({
 *   limiterName: 'api-calls',
 *   retryAfterMs: 1000,
 * });
 * console.log(error.message); // "RateLimitError: Rate limit exceeded for api-calls"
 * ```
 */
export class RateLimitError extends TaggedError("RateLimitError", {
  message: (p: {
    /** Name of the rate limiter that was exceeded */
    limiterName?: string;
    /** Time in milliseconds until the rate limit resets */
    retryAfterMs?: number;
  }) =>
    p.limiterName
      ? `RateLimitError: Rate limit exceeded for ${p.limiterName}${p.retryAfterMs ? `, retry after ${p.retryAfterMs}ms` : ""}`
      : `RateLimitError: Rate limit exceeded${p.retryAfterMs ? `, retry after ${p.retryAfterMs}ms` : ""}`,
}) {}

/**
 * Error thrown when a circuit breaker is open.
 *
 * @example
 * ```typescript
 * const error = new CircuitBreakerOpenError({
 *   circuitName: 'payment-api',
 *   state: 'OPEN',
 *   retryAfterMs: 30000,
 * });
 * console.log(error.message); // "CircuitBreakerOpenError: Circuit payment-api is OPEN"
 * ```
 */
export class CircuitBreakerOpenError extends TaggedError(
  "CircuitBreakerOpenError",
  {
    message: (p: {
      /** Name of the circuit breaker */
      circuitName: string;
      /** Current state of the circuit */
      state?: "OPEN" | "HALF_OPEN";
      /** Time in milliseconds until the circuit may close */
      retryAfterMs?: number;
    }) =>
      `CircuitBreakerOpenError: Circuit ${p.circuitName} is ${p.state ?? "OPEN"}${p.retryAfterMs ? `, retry after ${Math.ceil(p.retryAfterMs / 1000)}s` : ""}`,
  }
) {}

/**
 * Error thrown when validation fails.
 *
 * @example
 * ```typescript
 * const error = new ValidationError({
 *   field: 'email',
 *   reason: 'Invalid email format',
 * });
 * console.log(error.message); // "ValidationError: Invalid email - Invalid email format"
 * ```
 */
export class ValidationError extends TaggedError("ValidationError", {
  message: (p: {
    /** Field that failed validation */
    field: string;
    /** Reason for validation failure */
    reason: string;
    /** Raw value that failed validation */
    value?: unknown;
  }) => `ValidationError: Invalid ${p.field} - ${p.reason}`,
}) {}

/**
 * Error thrown when a resource is not found.
 *
 * @example
 * ```typescript
 * const error = new NotFoundError({
 *   resource: 'User',
 *   id: '123',
 * });
 * console.log(error.message); // "NotFoundError: User with id 123 not found"
 * ```
 */
export class NotFoundError extends TaggedError("NotFoundError", {
  message: (p: {
    /** Type of resource that was not found */
    resource: string;
    /** Identifier of the missing resource */
    id?: string;
  }) =>
    p.id
      ? `NotFoundError: ${p.resource} with id ${p.id} not found`
      : `NotFoundError: ${p.resource} not found`,
}) {}

/**
 * Error thrown when access is denied.
 *
 * @example
 * ```typescript
 * const error = new UnauthorizedError({
 *   action: 'delete',
 *   resource: 'User',
 * });
 * console.log(error.message); // "UnauthorizedError: Not authorized to delete User"
 * ```
 */
export class UnauthorizedError extends TaggedError("UnauthorizedError", {
  message: (p: {
    /** Action that was attempted */
    action?: string;
    /** Resource that was being accessed */
    resource?: string;
    /** Reason for denial */
    reason?: string;
  }) =>
    p.reason
      ? `UnauthorizedError: ${p.reason}`
      : p.action && p.resource
        ? `UnauthorizedError: Not authorized to ${p.action} ${p.resource}`
        : "UnauthorizedError: Access denied",
}) {}

/**
 * Error thrown for network-related failures.
 *
 * @example
 * ```typescript
 * const error = new NetworkError({
 *   url: 'https://api.example.com/users',
 *   reason: 'Connection refused',
 *   retryable: true,
 * });
 * ```
 */
export class NetworkError extends TaggedError("NetworkError", {
  message: (p: {
    /** URL that was being accessed */
    url?: string;
    /** Reason for the network failure */
    reason: string;
    /** Whether this error is retryable */
    retryable?: boolean;
    /** HTTP status code if applicable */
    statusCode?: number;
  }) =>
    p.url
      ? `NetworkError: ${p.reason} (${p.url})`
      : `NetworkError: ${p.reason}`,
}) {}

/**
 * Error thrown when a saga compensation fails.
 *
 * @example
 * ```typescript
 * const error = new CompensationError({
 *   step: 'chargeCard',
 *   originalError: paymentError,
 *   compensationError: refundError,
 * });
 * ```
 */
export class CompensationError extends TaggedError("CompensationError", {
  message: (p: {
    /** Step that triggered compensation */
    step: string;
    /** The original error that caused compensation */
    originalError?: unknown;
    /** Error that occurred during compensation */
    compensationError?: unknown;
  }) => `CompensationError: Failed to compensate step ${p.step}`,
}) {}

// =============================================================================
// Union Type for Common Errors
// =============================================================================

/**
 * Union of all pre-built error types.
 * Useful for exhaustive pattern matching.
 *
 * @example
 * ```typescript
 * function handleError(error: AwaitlyError): string {
 *   return TaggedError.match(error, {
 *     TimeoutError: (e) => `Timeout: ${e.ms}ms`,
 *     RetryExhaustedError: (e) => `Retries: ${e.attempts}`,
 *     RateLimitError: (e) => `Rate limited`,
 *     CircuitBreakerOpenError: (e) => `Circuit open: ${e.circuitName}`,
 *     ValidationError: (e) => `Invalid: ${e.field}`,
 *     NotFoundError: (e) => `Not found: ${e.resource}`,
 *     UnauthorizedError: (e) => `Unauthorized`,
 *     NetworkError: (e) => `Network: ${e.reason}`,
 *     CompensationError: (e) => `Compensation failed: ${e.step}`,
 *   });
 * }
 * ```
 */
export type AwaitlyError =
  | TimeoutError
  | RetryExhaustedError
  | RateLimitError
  | CircuitBreakerOpenError
  | ValidationError
  | NotFoundError
  | UnauthorizedError
  | NetworkError
  | CompensationError;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an error is a TimeoutError.
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return TaggedError.isTaggedError(error) && error._tag === "TimeoutError";
}

/**
 * Check if an error is a RetryExhaustedError.
 */
export function isRetryExhaustedError(
  error: unknown
): error is RetryExhaustedError {
  return (
    TaggedError.isTaggedError(error) && error._tag === "RetryExhaustedError"
  );
}

/**
 * Check if an error is a RateLimitError.
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return TaggedError.isTaggedError(error) && error._tag === "RateLimitError";
}

/**
 * Check if an error is a CircuitBreakerOpenError.
 */
export function isCircuitBreakerOpenError(
  error: unknown
): error is CircuitBreakerOpenError {
  return (
    TaggedError.isTaggedError(error) && error._tag === "CircuitBreakerOpenError"
  );
}

/**
 * Check if an error is a ValidationError.
 */
export function isValidationError(error: unknown): error is ValidationError {
  return TaggedError.isTaggedError(error) && error._tag === "ValidationError";
}

/**
 * Check if an error is a NotFoundError.
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return TaggedError.isTaggedError(error) && error._tag === "NotFoundError";
}

/**
 * Check if an error is an UnauthorizedError.
 */
export function isUnauthorizedError(
  error: unknown
): error is UnauthorizedError {
  return TaggedError.isTaggedError(error) && error._tag === "UnauthorizedError";
}

/**
 * Check if an error is a NetworkError.
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return TaggedError.isTaggedError(error) && error._tag === "NetworkError";
}

/**
 * Check if an error is a CompensationError.
 */
export function isCompensationError(
  error: unknown
): error is CompensationError {
  return TaggedError.isTaggedError(error) && error._tag === "CompensationError";
}

/**
 * Check if an error is any AwaitlyError.
 */
export function isAwaitlyError(error: unknown): error is AwaitlyError {
  if (!TaggedError.isTaggedError(error)) return false;
  const tag = error._tag;
  return [
    "TimeoutError",
    "RetryExhaustedError",
    "RateLimitError",
    "CircuitBreakerOpenError",
    "ValidationError",
    "NotFoundError",
    "UnauthorizedError",
    "NetworkError",
    "CompensationError",
  ].includes(tag);
}
