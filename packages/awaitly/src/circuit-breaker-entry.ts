/**
 * awaitly/circuit-breaker
 *
 * Circuit breaker pattern: protect against cascading failures.
 *
 * @example
 * ```typescript
 * import { createCircuitBreaker, isCircuitOpenError } from 'awaitly/circuit-breaker';
 *
 * const breaker = createCircuitBreaker('payment-service', {
 *   failureThreshold: 5,
 *   resetTimeout: 30_000, // 30 seconds in ms
 * });
 *
 * const result = await breaker.execute(() => chargeCard(amount));
 *
 * if (!result.ok && isCircuitOpenError(result.error)) {
 *   // Circuit is open, service is unavailable
 * }
 * ```
 */

export {
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerStats,
  type CircuitBreaker,
  CircuitOpenError,
  isCircuitOpenError,
  createCircuitBreaker,
  circuitBreakerPresets,
} from "./circuit-breaker";
