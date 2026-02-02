/**
 * Resume state helpers: collectors and state manipulation for workflow replay.
 */

import { ok } from "../core";
import type { WorkflowEvent } from "../core";
import type { ResumeState, ResumeStateEntry, PendingApproval } from "./types";
import { isStepComplete, isPendingApproval } from "./guards";

/**
 * Create a collector for step results to build resume state.
 *
 * ## When to Use
 *
 * Use `createResumeStateCollector` when you need to:
 * - **Save workflow state** for later replay/resume
 * - **Persist step results** to a database or file system
 * - **Build resume state** from workflow execution
 * - **Enable workflow replay** after application restarts
 *
 * ## Why Use This Instead of Manual Collection
 *
 * - **Automatic filtering**: Only collects `step_complete` events (ignores other events)
 * - **Metadata preservation**: Captures both result and meta for proper error replay
 * - **Type-safe**: Returns properly typed `ResumeState`
 * - **Convenient API**: Simple `handleEvent` → `getResumeState` pattern
 *
 * ## How It Works
 *
 * 1. Create collector and pass `handleEvent` to workflow's `onEvent` option
 * 2. Workflow emits `step_complete` events for keyed steps
 * 3. Collector automatically captures these events
 * 4. Call `getResumeState()` to get the collected `ResumeState`
 * 5. Persist state (e.g., to database) for later resume
 *
 * ## When step_complete Events Are Emitted
 *
 * Events are emitted for ANY step that has a `key` option, regardless of calling pattern:
 *
 * ```typescript
 * // Function-wrapped pattern - emits step_complete
 * await step(() => fetchUser("1"), { key: "user:1" });
 *
 * // Direct AsyncResult pattern - also emits step_complete
 * await step(fetchUser("1"), { key: "user:1" });
 * ```
 *
 * Both patterns above will emit `step_complete` events and be captured by the collector.
 *
 * ## Important Notes
 *
 * - Only steps with a `key` option are collected (unkeyed steps are not saved)
 * - The collector preserves error metadata for proper replay behavior
 * - State can be serialized to JSON (but complex cause types may need custom handling)
 *
 * @returns An object with:
 *   - `handleEvent`: Function to pass to workflow's `onEvent` option
 *   - `getResumeState`: Get collected resume state (call after workflow execution)
 *   - `clear`: Clears the collector's internal recorded entries (does not mutate workflow state)
 *
 * @example
 * ```typescript
 * // Collect state during workflow execution
 * const collector = createResumeStateCollector();
 *
 * const workflow = createWorkflow({ fetchUser, fetchPosts }, {
 *   onEvent: collector.handleEvent, // Pass collector's handler
 * });
 *
 * await workflow(async (step) => {
 *   // Only keyed steps are collected
 *   const user = await step(() => fetchUser("1"), { key: "user:1" });
 *   const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` });
 *   return { user, posts };
 * });
 *
 * // Get collected state for persistence
 * const state = collector.getResumeState();
 * // state.steps contains: 'user:1' and 'posts:1' entries
 *
 * // Save to database
 * await db.saveWorkflowState(workflowId, state);
 * ```
 *
 * @example
 * ```typescript
 * // Resume workflow from saved state
 * const savedState = await db.loadWorkflowState(workflowId);
 * const workflow = createWorkflow({ fetchUser, fetchPosts }, {
 *   resumeState: savedState // Pre-populate cache from saved state
 * });
 *
 * // Cached steps skip execution, new steps run normally
 * await workflow(async (step) => {
 *   const user = await step(() => fetchUser("1"), { key: "user:1" }); // Cache hit
 *   const posts = await step(() => fetchPosts(user.id), { key: `posts:${user.id}` }); // Cache hit
 *   return { user, posts };
 * });
 * ```
 */
export function createResumeStateCollector(): {
  /** Handle workflow events. Pass this to workflow's `onEvent` option. */
  handleEvent: (event: WorkflowEvent<unknown>) => void;
  /** Get the collected resume state. Call after workflow execution. */
  getResumeState: () => ResumeState;
  /** Clears the collector's internal recorded entries (does not mutate workflow state). */
  clear: () => void;
} {
  const steps = new Map<string, ResumeStateEntry>();

  return {
    handleEvent: (event: WorkflowEvent<unknown>) => {
      if (isStepComplete(event)) {
        steps.set(event.stepKey, { result: event.result, meta: event.meta });
      }
    },
    getResumeState: () => ({ steps: new Map(steps) }),
    clear: () => steps.clear(),
  };
}

/**
 * Inject an approved value into resume state.
 * Use this when an external approval is granted and you want to resume the workflow.
 *
 * @param state - The resume state to update
 * @param options - Object with stepKey and the approved value
 * @returns A new ResumeState with the approval injected
 *
 * @example
 * ```typescript
 * // When approval is granted externally:
 * const updatedState = injectApproval(savedState, {
 *   stepKey: 'deploy:prod',
 *   value: { approvedBy: 'admin', approvedAt: Date.now() }
 * });
 *
 * // Resume workflow with the approval injected
 * const workflow = createWorkflow({ ... }, { resumeState: updatedState });
 * ```
 */
export function injectApproval<T>(
  state: ResumeState,
  options: { stepKey: string; value: T }
): ResumeState {
  const newSteps = new Map(state.steps);
  newSteps.set(options.stepKey, {
    result: ok(options.value),
  });
  return { steps: newSteps };
}

/**
 * Remove a step from resume state (e.g., to force re-execution).
 * This is an immutable operation - returns a new ResumeState without modifying the original.
 *
 * @param state - The resume state to update
 * @param stepKey - The key of the step to remove
 * @returns A new ResumeState with the step removed (original is unchanged)
 *
 * @example
 * ```typescript
 * // Force a step to re-execute on resume
 * const updatedState = clearStep(savedState, 'approval:123');
 * ```
 */
export function clearStep(state: ResumeState, stepKey: string): ResumeState {
  const newSteps = new Map(state.steps);
  newSteps.delete(stepKey);
  return { steps: newSteps };
}

/**
 * Check if a step in resume state has a pending approval error.
 *
 * @param state - The resume state to check
 * @param stepKey - The key of the step to check
 * @returns `true` if the step has a pending approval, `false` otherwise
 *
 * @example
 * ```typescript
 * if (hasPendingApproval(savedState, 'deploy:prod')) {
 *   // Show approval UI
 * }
 * ```
 */
export function hasPendingApproval(
  state: ResumeState,
  stepKey: string
): boolean {
  const entry = state.steps.get(stepKey);
  if (!entry || entry.result.ok) return false;
  return isPendingApproval(entry.result.error);
}

/**
 * Get all pending approval step keys from resume state.
 *
 * @param state - The resume state to check
 * @returns Array of step keys that have pending approvals
 *
 * @example
 * ```typescript
 * const pendingKeys = getPendingApprovals(savedState);
 * // ['deploy:prod', 'deploy:staging']
 * ```
 */
export function getPendingApprovals(state: ResumeState): string[] {
  const pending: string[] = [];
  for (const [key, entry] of state.steps) {
    if (!entry.result.ok && isPendingApproval(entry.result.error)) {
      pending.push(key);
    }
  }
  return pending;
}

/**
 * Extended resume state collector that tracks pending approvals.
 * Use this for human-in-the-loop workflows that need to track approval state.
 *
 * @returns An object with methods to handle events, get state, and manage approvals
 *
 * @example
 * ```typescript
 * const collector = createApprovalStateCollector();
 *
 * const workflow = createWorkflow({ fetchUser, requireApproval }, {
 *   onEvent: collector.handleEvent,
 * });
 *
 * const result = await workflow(async (step) => {
 *   const user = await step(() => fetchUser("1"), { key: "user:1" });
 *   const approval = await step(requireApproval, { key: "approval:1" });
 *   return { user, approval };
 * });
 *
 * // Check for pending approvals
 * if (collector.hasPendingApprovals()) {
 *   const pending = collector.getPendingApprovals();
 *   // pending: [{ stepKey: 'approval:1', error: PendingApproval }]
 *   await saveToDatabase(collector.getResumeState());
 * }
 *
 * // Later, when approved:
 * const resumeState = collector.injectApproval('approval:1', { approvedBy: 'admin' });
 * ```
 */
export function createApprovalStateCollector(): {
  /** Handle workflow events. Pass this to workflow's `onEvent` option. */
  handleEvent: (event: WorkflowEvent<unknown>) => void;
  /** Get the collected resume state. Call after workflow execution. */
  getResumeState: () => ResumeState;
  /** Clears the collector's internal recorded entries (does not mutate workflow state). */
  clear: () => void;
  /** Check if any steps have pending approvals */
  hasPendingApprovals: () => boolean;
  /** Get all pending approval entries with their errors */
  getPendingApprovals: () => Array<{ stepKey: string; error: PendingApproval }>;
  /** Inject an approval result, updating the collector's internal state. Returns a copy for use as resumeState. */
  injectApproval: <T>(stepKey: string, value: T) => ResumeState;
} {
  const steps = new Map<string, ResumeStateEntry>();

  return {
    handleEvent: (event: WorkflowEvent<unknown>) => {
      if (isStepComplete(event)) {
        steps.set(event.stepKey, { result: event.result, meta: event.meta });
      }
    },
    getResumeState: () => ({ steps: new Map(steps) }),
    clear: () => steps.clear(),
    hasPendingApprovals: () => {
      for (const entry of steps.values()) {
        if (!entry.result.ok && isPendingApproval(entry.result.error)) {
          return true;
        }
      }
      return false;
    },
    getPendingApprovals: () => {
      const pending: Array<{ stepKey: string; error: PendingApproval }> = [];
      for (const [key, entry] of steps) {
        if (!entry.result.ok && isPendingApproval(entry.result.error)) {
          pending.push({ stepKey: key, error: entry.result.error as PendingApproval });
        }
      }
      return pending;
    },
    injectApproval: <T>(stepKey: string, value: T): ResumeState => {
      // Mutate internal state so collector reflects the approval
      steps.set(stepKey, { result: ok(value) });
      // Return a copy for use as resumeState
      return { steps: new Map(steps) };
    },
  };
}
