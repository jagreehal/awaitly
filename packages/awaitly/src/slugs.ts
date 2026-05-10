/**
 * awaitly/slugs
 *
 * Source-of-truth slug namespace. Every concept that surfaces as a runtime
 * error, lint rule, static-analyzer diagnostic, visualizer event, or skill rule
 * has exactly one canonical kebab-case slug here.
 *
 * Slugs are public API. Renames are a major version bump. Adds are non-breaking.
 *
 * Categories:
 * - step-*       step() discipline
 * - workflow-*   createWorkflow / run / runWithState shape
 * - result-*     Result usage
 * - error-*      Boundary handling
 * - concurrency-* step.all/map/race vs Promise.*
 * - runtime-*    Failures only observable at runtime
 */

export const AWAITLY_SLUGS = {
  // --- step-* ---
  "step-require-id": "step-require-id",
  "step-no-immediate-execution": "step-no-immediate-execution",
  "step-require-thunk-for-key": "step-require-thunk-for-key",
  "step-no-bare-await": "step-no-bare-await",
  "step-no-try-catch-wrap": "step-no-try-catch-wrap",
  "step-stable-cache-keys": "step-stable-cache-keys",

  // --- workflow-* ---
  "workflow-no-floating": "workflow-no-floating",
  "workflow-options-position": "workflow-options-position",
  "workflow-callback-shape": "workflow-callback-shape",
  "workflow-no-callable-form": "workflow-no-callable-form",
  "workflow-no-dynamic-import": "workflow-no-dynamic-import",

  // --- result-* ---
  "result-no-floating": "result-no-floating",
  "result-require-handling": "result-require-handling",
  "result-no-double-wrap": "result-no-double-wrap",
  "result-no-manual-propagation": "result-no-manual-propagation",
  "result-no-direct-ok-err": "result-no-direct-ok-err",

  // --- error-* ---
  "error-check-unexpected-first": "error-check-unexpected-first",
  "error-access-cause": "error-access-cause",
  "error-normalize": "error-normalize",
  "error-no-throw-in-deps": "error-no-throw-in-deps",

  // --- concurrency-* ---
  "concurrency-no-promise-all": "concurrency-no-promise-all",
  "concurrency-no-promise-race": "concurrency-no-promise-race",
  "concurrency-no-promise-allsettled": "concurrency-no-promise-allsettled",

  // --- runtime-* ---
  "runtime-step-timeout": "runtime-step-timeout",
  "runtime-step-aborted": "runtime-step-aborted",
  "runtime-retry-exhausted": "runtime-retry-exhausted",
  "runtime-rate-limit": "runtime-rate-limit",
  "runtime-circuit-open": "runtime-circuit-open",
  "runtime-unexpected": "runtime-unexpected",
  "runtime-resolver-not-found": "runtime-resolver-not-found",
  "runtime-saga-compensation": "runtime-saga-compensation",
} as const;

/** All canonical awaitly slugs as a string-literal union. */
export type AwaitlySlug = keyof typeof AWAITLY_SLUGS;

/** Categories derived from slug prefixes. */
export type AwaitlySlugCategory =
  | "step"
  | "workflow"
  | "result"
  | "error"
  | "concurrency"
  | "runtime";

/** Returns the category (prefix) of a slug. */
export function slugCategory(slug: AwaitlySlug): AwaitlySlugCategory {
  return slug.split("-")[0] as AwaitlySlugCategory;
}

/**
 * Returns the canonical docs URL for a slug. Resolves to the matching
 * anchored section on the consolidated rule index page.
 */
export function slugDocsUrl(slug: AwaitlySlug): string {
  return `https://jagreehal.github.io/awaitly/rules/#${slug}`;
}

/** Type guard: is a string a known awaitly slug? */
export function isAwaitlySlug(value: string): value is AwaitlySlug {
  return Object.prototype.hasOwnProperty.call(AWAITLY_SLUGS, value);
}

/** All slugs as an array. */
// Object.keys returns string[] — cast is safe because AWAITLY_SLUGS is `as const`
// and the module's keys are never mutated.
export const ALL_SLUGS: readonly AwaitlySlug[] = Object.keys(
  AWAITLY_SLUGS
) as AwaitlySlug[];
