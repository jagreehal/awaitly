/**
 * awaitly/workflow
 *
 * Workflow orchestration engine: compose async operations with automatic
 * error inference, step caching, and resume state.
 *
 * @example
 * ```typescript
 * import { createWorkflow, run } from 'awaitly/workflow';
 * import { ok, err, type AsyncResult } from 'awaitly/core';
 *
 * const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
 *   id === '1' ? ok({ id, name: 'Alice' }) : err('NOT_FOUND');
 *
 * const workflow = createWorkflow({ fetchUser });
 *
 * const result = await workflow(async (step) => {
 *   const user = await step(fetchUser('1'));
 *   return user;
 * });
 * ```
 */

// =============================================================================
// Core run() function
// =============================================================================
export {
  // Types
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

  // Type guards
  isStepTimeoutError,
  getStepTimeoutMeta,

  // Function
  run,
} from "./core";

// =============================================================================
// Workflow Engine
// =============================================================================
export {
  // Types
  type AnyResultFn,
  type ErrorsOfDeps,
  type CausesOfDeps,
  type WorkflowOptions,
  type WorkflowOptionsStrict,
  type Workflow,
  type WorkflowStrict,
  type WorkflowContext,
  type StepCache,
  type ResumeState,
  type ResumeStateEntry,

  // Functions
  createWorkflow,
  isStepComplete,
  createStepCollector,
} from "./workflow";
