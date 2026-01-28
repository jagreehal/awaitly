/**
 * awaitly/run
 *
 * The run() function for composing Result-returning operations.
 * Use this for do-notation style workflows with automatic error propagation.
 *
 * @example
 * ```typescript
 * import { ok, err, type AsyncResult } from 'awaitly';
 * import { run } from 'awaitly/run';
 *
 * async function getUser(id: string): AsyncResult<User, 'NOT_FOUND'> {
 *   const user = await db.find(id);
 *   return user ? ok(user) : err('NOT_FOUND');
 * }
 *
 * const result = await run(async (step) => {
 *   const user = await step(getUser(id));
 *   const posts = await step(getPosts(user.id));
 *   return { user, posts };
 * });
 * ```
 */

export {
  // Run function
  run,

  // Step types (for run())
  type RunStep,
  type StepOptions,
  type WorkflowEvent,
  type ScopeType,
  type RunOptions,
  type RunOptionsWithCatch,
  type RunOptionsWithoutCatch,

  // Retry and timeout types
  type BackoffStrategy,
  type RetryOptions,
  type TimeoutOptions,
  type StepTimeoutError,
  type StepTimeoutMarkerMeta,
  STEP_TIMEOUT_MARKER,
  isStepTimeoutError,
  getStepTimeoutMeta,

  // Early exit (internal but useful for advanced users)
  type EarlyExit,
  type StepFailureMeta,
  EARLY_EXIT_SYMBOL,
  createEarlyExit,
  isEarlyExit,
} from "./core";
