/**
 * awaitly/reliability
 *
 * Reliability patterns for production workflows: circuit breakers,
 * rate limiting, saga compensation, and retry/timeout policies.
 */

// =============================================================================
// Circuit Breaker
// =============================================================================
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

// =============================================================================
// Rate Limiter
// =============================================================================
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

// =============================================================================
// Saga / Compensation Pattern
// =============================================================================
export {
  type CompensationAction,
  type SagaStepOptions,
  type SagaCompensationError,
  type SagaContext,
  type SagaEvent,
  type SagaWorkflowOptions,
  type SagaResult,
  isSagaCompensationError,
  createSagaWorkflow,
  runSaga,
} from "./saga";

// =============================================================================
// Policies (retry/timeout)
// =============================================================================
export {
  type Policy,
  type PolicyFactory,
  type NamedPolicy,
  type WithPoliciesOptions,
  type PolicyRegistry,
  type StepOptionsBuilder,
  mergePolicies,
  createPolicyApplier,
  createPolicyBundle,
  retryPolicy,
  retryPolicies,
  timeoutPolicy,
  timeoutPolicies,
  servicePolicies,
  withPolicy,
  withPolicies,
  conditionalPolicy,
  envPolicy,
  createPolicyRegistry,
  stepOptions,
} from "./policies";
