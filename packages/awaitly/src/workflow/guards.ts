/**
 * Type guards for workflow events and errors.
 */

import type { WorkflowEvent } from "../core";
import type { WorkflowCancelledError, PendingApproval, ApprovalRejected, PendingHook, ResumeState } from "./types";

/**
 * Type guard to check if an event is a step_complete event.
 * Use this to filter events for state persistence.
 *
 * @param event - The workflow event to check
 * @returns `true` if the event is a step_complete event, `false` otherwise
 *
 * @example
 * ```typescript
 * const savedSteps = new Map<string, Result<unknown, unknown>>();
 *
 * const workflow = createWorkflow({ fetchUser }, {
 *   onEvent: (event) => {
 *     if (isStepComplete(event)) {
 *       savedSteps.set(event.stepKey, event.result);
 *     }
 *   }
 * });
 * ```
 */
/**
 * Type guard for runtime ResumeState (steps is a Map). Use to discriminate from WorkflowSnapshot when loading.
 */
export function isResumeState(x: unknown): x is ResumeState {
  return (
    typeof x === "object" &&
    x !== null &&
    "steps" in x &&
    (x as ResumeState).steps instanceof Map
  );
}

export function isStepComplete(
  event: WorkflowEvent<unknown>
): event is Extract<WorkflowEvent<unknown>, { type: "step_complete" }> {
  return event.type === "step_complete";
}

/**
 * Type guard to check if an error is a WorkflowCancelledError.
 *
 * @param error - The error to check
 * @returns `true` if the error is a WorkflowCancelledError, `false` otherwise
 */
export function isWorkflowCancelled(error: unknown): error is WorkflowCancelledError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as WorkflowCancelledError).type === "WORKFLOW_CANCELLED"
  );
}

/**
 * Type guard to check if an error is a PendingApproval.
 *
 * @param error - The error to check
 * @returns `true` if the error is a PendingApproval, `false` otherwise
 *
 * @example
 * ```typescript
 * const result = await workflow(...);
 * if (!result.ok && isPendingApproval(result.error)) {
 *   console.log(`Waiting for approval: ${result.error.stepKey}`);
 * }
 * ```
 */
export function isPendingApproval(error: unknown): error is PendingApproval {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as PendingApproval).type === "PENDING_APPROVAL"
  );
}

/**
 * Type guard to check if an error is an ApprovalRejected.
 *
 * @param error - The error to check
 * @returns `true` if the error is an ApprovalRejected, `false` otherwise
 */
export function isApprovalRejected(error: unknown): error is ApprovalRejected {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as ApprovalRejected).type === "APPROVAL_REJECTED"
  );
}

/**
 * Type guard to check if an error is a PendingHook.
 *
 * @param error - The error to check
 * @returns `true` if the error is a PendingHook, `false` otherwise
 */
export function isPendingHook(error: unknown): error is PendingHook {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as PendingHook).type === "PENDING_HOOK"
  );
}
