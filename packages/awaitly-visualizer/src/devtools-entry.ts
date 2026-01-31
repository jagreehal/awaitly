/**
 * awaitly/devtools
 *
 * Debugging and development tools: timeline visualization, run comparison,
 * and console logging for workflow execution.
 *
 * @example
 * ```typescript
 * import { createDevtools, quickVisualize, createConsoleLogger } from 'awaitly/devtools';
 *
 * const devtools = createDevtools();
 * const workflow = createWorkflow(deps, {
 *   onEvent: devtools.handleEvent,
 * });
 *
 * await workflow(async (step) => { ... });
 *
 * // View timeline
 * console.log(devtools.getTimeline());
 *
 * // Quick visualization
 * quickVisualize(events);
 * ```
 */

export {
  // Types
  type WorkflowRun,
  type RunDiff,
  type StepDiff,
  type TimelineEntry,
  type DevtoolsOptions,
  type Devtools,

  // Factory
  createDevtools,

  // Helpers
  renderDiff,
  quickVisualize,
  createConsoleLogger,
} from "./devtools";