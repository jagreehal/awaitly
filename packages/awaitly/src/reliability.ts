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
