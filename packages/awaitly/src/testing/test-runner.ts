/**
 * Simple workflow test runner.
 *
 * Runs a real workflow with real deps, captures per-step results and events,
 * and returns a structured result. No mocking needed.
 *
 * This is a complement to `createWorkflowHarness`, not a replacement.
 *
 * @example
 * ```typescript
 * import { testWorkflow } from 'awaitly/testing';
 * import { ok, err } from 'awaitly';
 *
 * const getUser = async (id: string) => ok({ id, name: 'Alice' });
 * const getPosts = async (userId: string) => ok([{ id: 1, title: 'Hello' }]);
 *
 * const result = await testWorkflow(
 *   { getUser, getPosts },
 *   async ({ step, deps: { getUser, getPosts } }) => {
 *     const user = await step('user', () => getUser('1'));
 *     const posts = await step('posts', () => getPosts(user.id));
 *     return { user, posts };
 *   }
 * );
 *
 * expect(result.result.ok).toBe(true);
 * expect(result.steps['user'].result.ok).toBe(true);
 * expect(result.stepOrder).toEqual(['user', 'posts']);
 * ```
 */

import { createWorkflow } from "../workflow";
import type { AnyResultFn, ErrorsOfDeps, WorkflowContext } from "../workflow/types";
import type { Result, WorkflowEvent, RunStep } from "../core";
import type { UnexpectedError } from "../errors";

// =============================================================================
// Types
// =============================================================================

/**
 * Captured information about a single step execution.
 */
export interface TestStepResult {
  /** The unwrapped output value (from result.value if ok) */
  output: unknown;
  /** Step execution duration in milliseconds */
  durationMs: number;
  /** The full Result of the step */
  result: Result<unknown, unknown>;
}

/**
 * Structured result returned by `testWorkflow`.
 */
export interface TestWorkflowResult<T, E> {
  /** The workflow's final result */
  result: Result<T, E | UnexpectedError>;
  /** Per-step results keyed by step key (the step ID) */
  steps: Record<string, TestStepResult>;
  /** All workflow events emitted during execution */
  events: Array<WorkflowEvent<unknown>>;
  /** Total execution duration in milliseconds */
  durationMs: number;
  /** Step keys in execution order */
  stepOrder: string[];
}

/**
 * Options for `testWorkflow`.
 */
export interface TestWorkflowOptions {
  /** AbortSignal for cancellation testing */
  signal?: AbortSignal;
  /** Custom metadata to track */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Execute a workflow with real deps, capturing all step results and events.
 * No mocking needed — this runs the actual workflow function.
 *
 * Step results are captured from `step_complete` events. Every step emits a
 * `step_complete` event with a `stepKey` equal to the step ID (or the explicit
 * `key` option if provided). These appear in the `steps` record and `stepOrder` array.
 */
export async function testWorkflow<
  const Deps extends Readonly<Record<string, AnyResultFn>>,
  T,
>(
  deps: Deps,
  fn: (context: {
    step: RunStep<ErrorsOfDeps<Deps>>;
    deps: Deps;
    ctx: WorkflowContext;
  }) => T | Promise<T>,
  options?: TestWorkflowOptions,
): Promise<TestWorkflowResult<T, ErrorsOfDeps<Deps>>> {
  type E = ErrorsOfDeps<Deps>;

  const events: Array<WorkflowEvent<unknown>> = [];
  const steps: Record<string, TestStepResult> = {};
  const stepOrder: string[] = [];

  const onEvent = (event: WorkflowEvent<E | UnexpectedError>) => {
    events.push(event);

    // Capture keyed step results from step_complete events
    if (event.type === "step_complete" && event.stepKey) {
      const stepResult: TestStepResult = {
        output: event.result.ok ? event.result.value : undefined,
        durationMs: event.durationMs,
        result: event.result,
      };
      steps[event.stepKey] = stepResult;
      stepOrder.push(event.stepKey);
    }
  };

  const workflow = createWorkflow("test-workflow", deps);

  const start = performance.now();
  const result = await workflow.run(fn, {
    onEvent,
    signal: options?.signal,
  });
  const durationMs = performance.now() - start;

  return {
    result: result as Result<T, E | UnexpectedError>,
    steps,
    events,
    durationMs,
    stepOrder,
  };
}
