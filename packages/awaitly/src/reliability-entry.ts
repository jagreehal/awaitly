/**
 * awaitly/reliability
 *
 * Dependency protection and request-reuse primitives. This is the focused
 * entry for retries, timeouts, fallbacks, circuit breakers, rate limiting,
 * caching, and singleflight deduplication.
 */

export {
  retry,
  timeout,
  fallback,
  type RetryPolicyOptions,
  type PolicyFn,
  type PolicyDelay,
} from "./core/policies";

export * from "./circuit-breaker-entry";
export * from "./ratelimit-entry";
export * from "./cache-entry";
export * from "./singleflight-entry";

// StepOptions-oriented bundles remain available for existing workflow code.
// New dependency declarations should prefer retry/timeout/fallback above.
export * from "./policies-entry";
