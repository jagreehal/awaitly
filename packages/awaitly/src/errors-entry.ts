/**
 * awaitly/errors entry point
 *
 * Pre-built error types for common failure scenarios.
 */
export {
  // Factory
  makeError,
  // Pre-built errors
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  NetworkError,
  CompensationError,
  // Union type
  type AwaitlyError,
  // Type guards
  isTimeoutError,
  isRetryExhaustedError,
  isRateLimitError,
  isCircuitBreakerOpenError,
  isValidationError,
  isNotFoundError,
  isUnauthorizedError,
  isNetworkError,
  isCompensationError,
  isAwaitlyError,
} from "./errors";
