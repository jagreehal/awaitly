/**
 * awaitly/policies
 *
 * Retry and timeout policies: composable reliability configurations.
 *
 * @example
 * ```typescript
 * import { servicePolicies, withPolicy, mergePolicies } from 'awaitly/policies';
 *
 * // Pre-built policies for common services
 * const dbPolicy = servicePolicies.database();
 * const apiPolicy = servicePolicies.externalApi();
 *
 * // Apply to steps
 * const user = await withPolicy(dbPolicy, () => step(fetchUser(id)));
 *
 * // Compose policies
 * const strictPolicy = mergePolicies(dbPolicy, { timeout: { ms: 1000 } });
 * ```
 */

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
