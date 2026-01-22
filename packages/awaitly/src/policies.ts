/**
 * awaitly/policies
 *
 * Policy-Driven Step Middleware - Reusable bundles of StepOptions
 * that can be composed and applied per-workflow or per-step.
 */

import type { StepOptions, RetryOptions, TimeoutOptions } from "./core";

// =============================================================================
// Policy Types
// =============================================================================

/**
 * A policy is a partial StepOptions that can be merged with other policies.
 */
export type Policy = Partial<StepOptions>;

/**
 * A policy factory that creates policies based on context.
 */
export type PolicyFactory<T = void> = T extends void
  ? () => Policy
  : (context: T) => Policy;

/**
 * Named policy with metadata.
 */
export interface NamedPolicy {
  name: string;
  policy: Policy;
  description?: string;
}

// =============================================================================
// Policy Composition
// =============================================================================

/**
 * Merge multiple policies into a single StepOptions object.
 * Later policies override earlier ones for conflicting properties.
 * Retry and timeout options are deep-merged.
 *
 * @param policies - Policies to merge (in order of precedence)
 * @returns Merged StepOptions
 *
 * @example
 * ```typescript
 * const merged = mergePolicies(
 *   timeoutPolicies.api,      // timeout: 5000ms
 *   retryPolicies.transient,  // retry: 3 attempts
 *   { name: 'fetch-user' }    // name override
 * );
 * ```
 */
export function mergePolicies(...policies: Policy[]): StepOptions {
  const result: StepOptions = {};

  for (const policy of policies) {
    if (policy.name !== undefined) result.name = policy.name;
    if (policy.key !== undefined) result.key = policy.key;

    // Deep merge retry options
    if (policy.retry !== undefined) {
      result.retry = result.retry
        ? { ...result.retry, ...policy.retry }
        : { ...policy.retry };
    }

    // Deep merge timeout options
    if (policy.timeout !== undefined) {
      result.timeout = result.timeout
        ? { ...result.timeout, ...policy.timeout }
        : { ...policy.timeout };
    }
  }

  return result;
}

/**
 * Create a policy applier that merges base policies with step-specific options.
 *
 * @param basePolicies - Base policies to apply to all steps
 * @returns A function that applies policies to step options
 *
 * @example
 * ```typescript
 * const applyPolicy = createPolicyApplier(
 *   timeoutPolicies.api,
 *   retryPolicies.transient
 * );
 *
 * // In workflow
 * const user = await step(
 *   () => fetchUser(id),
 *   applyPolicy({ name: 'fetch-user', key: 'user:' + id })
 * );
 * ```
 */
export function createPolicyApplier(
  ...basePolicies: Policy[]
): (stepOptions?: StepOptions | string) => StepOptions {
  const basePolicy = mergePolicies(...basePolicies);

  return (stepOptions?: StepOptions | string): StepOptions => {
    const opts = typeof stepOptions === "string" ? { name: stepOptions } : (stepOptions ?? {});
    return mergePolicies(basePolicy, opts);
  };
}

/**
 * Create a named policy bundle for reuse across workflows.
 *
 * @param name - Policy bundle name
 * @param policies - Policies to include in the bundle
 * @returns Named policy object
 */
export function createPolicyBundle(
  name: string,
  ...policies: Policy[]
): NamedPolicy {
  return {
    name,
    policy: mergePolicies(...policies),
  };
}

// =============================================================================
// Retry Policies
// =============================================================================

/**
 * Create a retry policy with the given options.
 */
export function retryPolicy(options: RetryOptions): Policy {
  return { retry: options };
}

/**
 * Pre-built retry policies for common scenarios.
 */
export const retryPolicies = {
  /**
   * No retry - fail immediately on error.
   */
  none: retryPolicy({ attempts: 1 }),

  /**
   * Quick retry for transient errors (3 attempts, fast backoff).
   */
  transient: retryPolicy({
    attempts: 3,
    backoff: "exponential",
    initialDelay: 100,
    maxDelay: 1000,
    jitter: true,
  }),

  /**
   * Standard retry for API calls (3 attempts, moderate backoff).
   */
  standard: retryPolicy({
    attempts: 3,
    backoff: "exponential",
    initialDelay: 200,
    maxDelay: 5000,
    jitter: true,
  }),

  /**
   * Aggressive retry for critical operations (5 attempts, longer backoff).
   */
  aggressive: retryPolicy({
    attempts: 5,
    backoff: "exponential",
    initialDelay: 500,
    maxDelay: 30000,
    jitter: true,
  }),

  /**
   * Fixed interval retry (useful for polling).
   */
  fixed: (attempts: number, delayMs: number): Policy =>
    retryPolicy({
      attempts,
      backoff: "fixed",
      initialDelay: delayMs,
      jitter: false,
    }),

  /**
   * Linear backoff retry.
   */
  linear: (attempts: number, initialDelay: number): Policy =>
    retryPolicy({
      attempts,
      backoff: "linear",
      initialDelay,
      jitter: true,
    }),

  /**
   * Custom retry policy builder.
   */
  custom: (options: Partial<RetryOptions> & { attempts: number }): Policy =>
    retryPolicy({
      backoff: "exponential",
      initialDelay: 100,
      maxDelay: 30000,
      jitter: true,
      ...options,
    }),
} as const;

// =============================================================================
// Timeout Policies
// =============================================================================

/**
 * Create a timeout policy with the given options.
 */
export function timeoutPolicy(options: TimeoutOptions): Policy {
  return { timeout: options };
}

/**
 * Pre-built timeout policies for common scenarios.
 */
export const timeoutPolicies = {
  /**
   * No timeout.
   */
  none: {} as Policy,

  /**
   * Fast timeout for quick operations (1 second).
   */
  fast: timeoutPolicy({ ms: 1000 }),

  /**
   * Standard API timeout (5 seconds).
   */
  api: timeoutPolicy({ ms: 5000 }),

  /**
   * Extended timeout for slower operations (30 seconds).
   */
  extended: timeoutPolicy({ ms: 30000 }),

  /**
   * Long timeout for batch operations (2 minutes).
   */
  long: timeoutPolicy({ ms: 120000 }),

  /**
   * Custom timeout in milliseconds.
   */
  ms: (ms: number): Policy => timeoutPolicy({ ms }),

  /**
   * Custom timeout in seconds.
   */
  seconds: (seconds: number): Policy => timeoutPolicy({ ms: seconds * 1000 }),

  /**
   * Timeout with custom error.
   */
  withError: <E>(ms: number, error: E): Policy =>
    timeoutPolicy({ ms, error }),

  /**
   * Timeout with AbortSignal support.
   */
  withSignal: (ms: number): Policy =>
    timeoutPolicy({ ms, signal: true }),
} as const;

// =============================================================================
// Combined Policies
// =============================================================================

/**
 * Pre-built combined policies for common service patterns.
 */
export const servicePolicies = {
  /**
   * Policy for external HTTP APIs.
   * - 5 second timeout
   * - 3 retries with exponential backoff
   */
  httpApi: mergePolicies(
    timeoutPolicies.api,
    retryPolicies.standard
  ),

  /**
   * Policy for database operations.
   * - 30 second timeout
   * - 2 retries for transient errors
   */
  database: mergePolicies(
    timeoutPolicies.extended,
    retryPolicy({
      attempts: 2,
      backoff: "exponential",
      initialDelay: 100,
      maxDelay: 2000,
      jitter: true,
    })
  ),

  /**
   * Policy for cache operations.
   * - 1 second timeout
   * - No retry (cache misses are not errors)
   */
  cache: mergePolicies(
    timeoutPolicies.fast,
    retryPolicies.none
  ),

  /**
   * Policy for message queue operations.
   * - 30 second timeout
   * - 5 retries with longer backoff
   */
  messageQueue: mergePolicies(
    timeoutPolicies.extended,
    retryPolicies.aggressive
  ),

  /**
   * Policy for file operations.
   * - 2 minute timeout
   * - 3 retries
   */
  fileSystem: mergePolicies(
    timeoutPolicies.long,
    retryPolicies.standard
  ),

  /**
   * Policy for third-party services with rate limits.
   * - 10 second timeout
   * - 5 retries with linear backoff
   */
  rateLimited: mergePolicies(
    timeoutPolicy({ ms: 10000 }),
    retryPolicy({
      attempts: 5,
      backoff: "linear",
      initialDelay: 1000,
      maxDelay: 10000,
      jitter: true,
    })
  ),
} as const;

// =============================================================================
// Policy Decorators
// =============================================================================

/**
 * Options for withPolicies workflow wrapper.
 */
export interface WithPoliciesOptions {
  /**
   * Base policies applied to all steps.
   */
  policies: Policy[];

  /**
   * Step-specific policy overrides by name or key pattern.
   */
  overrides?: Record<string, Policy>;
}

/**
 * Create step options with policies applied.
 * This is a helper for applying policies inline.
 *
 * @param policies - Policies to apply
 * @param stepOptions - Step-specific options
 * @returns Merged StepOptions
 *
 * @example
 * ```typescript
 * const user = await step(
 *   () => fetchUser(id),
 *   withPolicy(servicePolicies.httpApi, { name: 'fetch-user' })
 * );
 * ```
 */
export function withPolicy(
  policy: Policy,
  stepOptions?: StepOptions | string
): StepOptions {
  const opts = typeof stepOptions === "string" ? { name: stepOptions } : (stepOptions ?? {});
  return mergePolicies(policy, opts);
}

/**
 * Create step options with multiple policies applied.
 *
 * @param policies - Policies to apply (in order)
 * @param stepOptions - Step-specific options
 * @returns Merged StepOptions
 *
 * @example
 * ```typescript
 * const user = await step(
 *   () => fetchUser(id),
 *   withPolicies([timeoutPolicies.api, retryPolicies.standard], { name: 'fetch-user' })
 * );
 * ```
 */
export function withPolicies(
  policies: Policy[],
  stepOptions?: StepOptions | string
): StepOptions {
  const opts = typeof stepOptions === "string" ? { name: stepOptions } : (stepOptions ?? {});
  return mergePolicies(...policies, opts);
}

// =============================================================================
// Conditional Policies
// =============================================================================

/**
 * Create a policy that applies conditionally.
 *
 * @param condition - Condition to check
 * @param policy - Policy to apply if condition is true
 * @param elsePolicy - Policy to apply if condition is false (optional)
 * @returns The selected policy
 *
 * @example
 * ```typescript
 * const policy = conditionalPolicy(
 *   isProduction,
 *   servicePolicies.httpApi,     // Use in production
 *   retryPolicies.none           // Skip in development
 * );
 * ```
 */
export function conditionalPolicy(
  condition: boolean,
  policy: Policy,
  elsePolicy: Policy = {}
): Policy {
  return condition ? policy : elsePolicy;
}

/**
 * Create a policy based on environment.
 *
 * @param envPolicies - Map of environment names to policies
 * @param currentEnv - Current environment (defaults to NODE_ENV)
 * @param defaultPolicy - Default policy if environment not found
 * @returns The selected policy
 *
 * @example
 * ```typescript
 * const policy = envPolicy({
 *   production: servicePolicies.httpApi,
 *   development: retryPolicies.none,
 *   test: retryPolicies.none,
 * });
 * ```
 */
export function envPolicy(
  envPolicies: Record<string, Policy>,
  currentEnv: string = process.env.NODE_ENV ?? "development",
  defaultPolicy: Policy = {}
): Policy {
  return envPolicies[currentEnv] ?? defaultPolicy;
}

// =============================================================================
// Policy Registry
// =============================================================================

/**
 * A registry for managing named policies.
 */
export interface PolicyRegistry {
  /**
   * Register a named policy.
   */
  register(name: string, policy: Policy): void;

  /**
   * Get a policy by name.
   */
  get(name: string): Policy | undefined;

  /**
   * Check if a policy exists.
   */
  has(name: string): boolean;

  /**
   * Get all registered policy names.
   */
  names(): string[];

  /**
   * Create step options using a registered policy.
   */
  apply(policyName: string, stepOptions?: StepOptions | string): StepOptions;
}

/**
 * Create a policy registry for managing named policies.
 *
 * @returns PolicyRegistry instance
 *
 * @example
 * ```typescript
 * const registry = createPolicyRegistry();
 *
 * // Register policies
 * registry.register('api', servicePolicies.httpApi);
 * registry.register('db', servicePolicies.database);
 *
 * // Use in workflow
 * const user = await step(
 *   () => fetchUser(id),
 *   registry.apply('api', { name: 'fetch-user' })
 * );
 * ```
 */
export function createPolicyRegistry(): PolicyRegistry {
  const policies = new Map<string, Policy>();

  return {
    register(name: string, policy: Policy): void {
      policies.set(name, policy);
    },

    get(name: string): Policy | undefined {
      return policies.get(name);
    },

    has(name: string): boolean {
      return policies.has(name);
    },

    names(): string[] {
      return Array.from(policies.keys());
    },

    apply(policyName: string, stepOptions?: StepOptions | string): StepOptions {
      const policy = policies.get(policyName);
      if (!policy) {
        throw new Error(`Policy not found: ${policyName}`);
      }
      return withPolicy(policy, stepOptions);
    },
  };
}

// =============================================================================
// Step Options Builder (Fluent API)
// =============================================================================

/**
 * Fluent builder for constructing step options.
 */
export interface StepOptionsBuilder {
  /**
   * Set step name.
   */
  name(name: string): StepOptionsBuilder;

  /**
   * Set step key for caching.
   */
  key(key: string): StepOptionsBuilder;

  /**
   * Apply a policy.
   */
  policy(policy: Policy): StepOptionsBuilder;

  /**
   * Set timeout in milliseconds.
   */
  timeout(ms: number): StepOptionsBuilder;

  /**
   * Set retry options.
   */
  retry(options: RetryOptions): StepOptionsBuilder;

  /**
   * Set retry attempts (with default exponential backoff).
   */
  retries(attempts: number): StepOptionsBuilder;

  /**
   * Build the final StepOptions.
   */
  build(): StepOptions;
}

/**
 * Create a fluent builder for step options.
 *
 * @returns StepOptionsBuilder instance
 *
 * @example
 * ```typescript
 * const options = stepOptions()
 *   .name('fetch-user')
 *   .key('user:123')
 *   .timeout(5000)
 *   .retries(3)
 *   .build();
 *
 * const user = await step(() => fetchUser(id), options);
 * ```
 */
export function stepOptions(): StepOptionsBuilder {
  const policies: Policy[] = [];

  const builder: StepOptionsBuilder = {
    name(name: string) {
      policies.push({ name });
      return builder;
    },

    key(key: string) {
      policies.push({ key });
      return builder;
    },

    policy(policy: Policy) {
      policies.push(policy);
      return builder;
    },

    timeout(ms: number) {
      policies.push(timeoutPolicy({ ms }));
      return builder;
    },

    retry(options: RetryOptions) {
      policies.push(retryPolicy(options));
      return builder;
    },

    retries(attempts: number) {
      policies.push(retryPolicies.custom({ attempts }));
      return builder;
    },

    build(): StepOptions {
      return mergePolicies(...policies);
    },
  };

  return builder;
}
