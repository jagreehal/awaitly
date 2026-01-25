/**
 * Recommended configuration for eslint-plugin-awaitly
 *
 * Enables all rules that catch common mistakes:
 * - no-immediate-execution: Prevents step(fn()) patterns
 * - require-thunk-for-key: Ensures thunks when using key option
 * - stable-cache-keys: Prevents Date.now() etc in cache keys
 *
 * Note: This is configured as a flat config preset in index.ts
 */
export const recommendedRules = {
  'awaitly/no-immediate-execution': 'error' as const,
  'awaitly/require-thunk-for-key': 'error' as const,
  'awaitly/stable-cache-keys': 'error' as const,
};
