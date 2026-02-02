/**
 * Human-in-the-Loop (HITL) helpers: pendingApproval, createApprovalStep, gatedStep.
 */

import { ok, err, type Err, type AsyncResult } from "../core";
import type { PendingApproval, ApprovalRejected, ApprovalStepOptions, GatedStepOptions } from "./types";

/**
 * Create a PendingApproval error result.
 * Convenience helper for approval-gated steps.
 *
 * @param stepKey - Stable key for this approval step (used for resume)
 * @param options - Optional reason and metadata for the pending approval
 * @returns A Result with a PendingApproval error
 *
 * @example
 * ```typescript
 * const requireApproval = async (userId: string) => {
 *   const status = await db.getApproval(userId);
 *   if (!status) return pendingApproval(`approval:${userId}`);
 *   return ok(status);
 * };
 * ```
 */
export function pendingApproval(
  stepKey: string,
  options?: { reason?: string; metadata?: Record<string, unknown> }
): Err<PendingApproval> {
  return err({
    type: "PENDING_APPROVAL",
    stepKey,
    reason: options?.reason,
    metadata: options?.metadata,
  });
}

/**
 * Create a Result-returning function that checks external approval status.
 *
 * ## When to Use
 *
 * Use `createApprovalStep` when you need:
 * - **Human-in-the-loop workflows**: Steps that require human approval
 * - **External approval systems**: Integrate with approval databases/APIs
 * - **Workflow pausing**: Workflows that pause and resume after approval
 * - **Approval tracking**: Track who approved what and when
 *
 * ## Why Use This Instead of Manual Approval Checks
 *
 * - **Standardized pattern**: Consistent approval step interface
 * - **Type-safe**: Returns typed `PendingApproval` or `ApprovalRejected` errors
 * - **Resume-friendly**: Works seamlessly with `injectApproval()` and resume state
 * - **Metadata support**: Can include approval reason and metadata
 *
 * ## How It Works
 *
 * 1. Create approval step with `checkApproval` function
 * 2. `checkApproval` returns one of:
 *    - `{ status: 'pending' }` - Approval not yet granted (workflow pauses)
 *    - `{ status: 'approved', value: T }` - Approval granted (workflow continues)
 *    - `{ status: 'rejected', reason: string }` - Approval rejected (workflow fails)
 * 3. Use in workflow with `step()` - workflow pauses if pending
 * 4. When approval granted externally, use `injectApproval()` to resume
 *
 * ## Typical Approval Flow
 *
 * 1. Workflow executes → reaches approval step
 * 2. `checkApproval()` called → returns `{ status: 'pending' }`
 * 3. Workflow returns `PendingApproval` error
 * 4. Save workflow state → persist for later resume
 * 5. Show approval UI → user sees pending approval
 * 6. User grants/rejects → update approval system
 * 7. Inject approval → call `injectApproval()` with approved value
 * 8. Resume workflow → continue from approval step
 *
 * @param options - Configuration for the approval step:
 *   - `key`: Stable key for this approval (must match step key in workflow)
 *   - `checkApproval`: Async function that checks current approval status
 *   - `pendingReason`: Optional reason shown when approval is pending
 *   - `metadata`: Optional metadata attached to the approval request
 *
 * @returns A function that returns an AsyncResult checking approval status.
 *          The function can be used directly with `step()` in workflows.
 *
 * @example
 * ```typescript
 * // Create approval step that checks database
 * const requireManagerApproval = createApprovalStep<{ approvedBy: string }>({
 *   key: 'manager-approval',
 *   checkApproval: async () => {
 *     const approval = await db.getApproval('manager-approval');
 *     if (!approval) {
 *       return { status: 'pending' }; // Workflow pauses here
 *     }
 *     if (approval.rejected) {
 *       return { status: 'rejected', reason: approval.reason };
 *     }
 *     return {
 *       status: 'approved',
 *       value: { approvedBy: approval.approvedBy }
 *     };
 *   },
 *   pendingReason: 'Waiting for manager approval',
 * });
 *
 * // Use in workflow
 * const workflow = createWorkflow({ requireManagerApproval });
 * const result = await workflow(async (step) => {
 *   const approval = await step(requireManagerApproval, { key: 'manager-approval' });
 *   // If pending, workflow exits with PendingApproval error
 *   // If approved, continues with approval value
 *   return approval;
 * });
 *
 * // Handle pending state
 * if (!result.ok && isPendingApproval(result.error)) {
 *   // Workflow paused - show approval UI
 *   showApprovalUI(result.error.stepKey);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With approval injection for resume
 * const collector = createApprovalStateCollector();
 * const workflow = createWorkflow({ requireApproval }, {
 *   onEvent: collector.handleEvent,
 * });
 *
 * const result = await workflow(async (step) => {
 *   const approval = await step(requireApproval, { key: 'approval:1' });
 *   return approval;
 * });
 *
 * // When approval granted externally
 * if (collector.hasPendingApprovals()) {
 *   const resumeState = collector.injectApproval('approval:1', {
 *     approvedBy: 'admin@example.com'
 *   });
 *
 *   // Resume workflow
 *   const workflow2 = createWorkflow({ requireApproval }, { resumeState });
 *   const result2 = await workflow2(async (step) => {
 *     const approval = await step(requireApproval, { key: 'approval:1' });
 *     return approval; // Now succeeds with injected value
 *   });
 * }
 * ```
 */
export function createApprovalStep<T>(
  options: ApprovalStepOptions<T>
): () => AsyncResult<T, PendingApproval | ApprovalRejected> {
  return async (): AsyncResult<T, PendingApproval | ApprovalRejected> => {
    const result = await options.checkApproval();

    switch (result.status) {
      case "pending":
        return err({
          type: "PENDING_APPROVAL",
          stepKey: options.key,
          reason: options.pendingReason,
          metadata: options.metadata,
        });
      case "rejected":
        return err({
          type: "APPROVAL_REJECTED",
          stepKey: options.key,
          reason: result.reason,
        });
      case "approved":
        return ok(result.value);
    }
  };
}

/**
 * Create a gated step that requires approval before execution.
 *
 * This is the AI SDK / LangChain-style pattern where you intercept
 * tool calls *before* they execute, allowing humans to see the args
 * and approve, edit, or reject before the operation runs.
 *
 * ## When to Use
 *
 * Use `gatedStep` when you want to:
 * - **Show args before execution**: Let humans see what the operation will do
 * - **Allow editing args**: Humans can modify args before operation runs
 * - **Conditional gating**: Only require approval for certain conditions
 * - **AI safety**: Gate dangerous AI tool calls (send email, delete file, etc.)
 *
 * ## Difference from createApprovalStep
 *
 * - `createApprovalStep`: Checks external approval status, operation already defined
 * - `gatedStep`: Gates before operation, shows args, allows editing, then executes
 *
 * ## Flow
 *
 * 1. Call gatedStep with args
 * 2. Check if approval is required (based on requiresApproval condition)
 * 3. If required and not approved:
 *    - Return PendingApproval with args visible in metadata
 *    - Human sees: "Send email to external@example.com with subject X"
 *    - Human can approve (run as-is), edit (modify args), or reject
 * 4. If approved or not required:
 *    - Execute the operation with (potentially edited) args
 *
 * @param operation - The operation to gate (a function returning AsyncResult)
 * @param options - Gating configuration
 * @returns A gated function that checks approval before execution
 *
 * @example
 * ```typescript
 * // Gate external email sends
 * const sendEmail = async (to: string, subject: string, body: string) => { ... };
 *
 * const gatedSendEmail = gatedStep(
 *   sendEmail,
 *   {
 *     key: 'email',
 *     requiresApproval: (args) => !args.to.endsWith('@mycompany.com'),
 *     description: (args) => `Send email to ${args.to}: "${args.subject}"`,
 *   }
 * );
 *
 * // In workflow:
 * const result = await step(
 *   () => gatedSendEmail({ to: 'external@other.com', subject: 'Hello', body: '...' }),
 *   { key: 'send-welcome-email' }
 * );
 *
 * // If gated, returns PendingApproval with:
 * // {
 * //   stepKey: 'email',
 * //   reason: 'Send email to external@other.com: "Hello"',
 * //   metadata: { pendingArgs: { to: '...', subject: '...', body: '...' } }
 * // }
 * ```
 *
 * @example
 * ```typescript
 * // Gate file deletion with explicit approval check
 * const gatedDelete = gatedStep(
 *   (path: string) => deleteFile(path),
 *   {
 *     key: 'delete-file',
 *     requiresApproval: true, // Always require approval
 *     description: (args) => `Delete file: ${args.path}`,
 *     checkApproval: () => approvalStore.getApproval('delete-file'),
 *   }
 * );
 * ```
 */
export function gatedStep<TArgs extends Record<string, unknown>, T, E>(
  operation: (args: TArgs) => AsyncResult<T, E>,
  options: GatedStepOptions<TArgs, T>
): (args: TArgs) => AsyncResult<T, E | PendingApproval | ApprovalRejected> {
  return async (args: TArgs): AsyncResult<T, E | PendingApproval | ApprovalRejected> => {
    // Check if approval is required
    const requiresApproval =
      typeof options.requiresApproval === "function"
        ? await options.requiresApproval(args)
        : options.requiresApproval;

    if (!requiresApproval) {
      // No approval needed - execute immediately
      return operation(args);
    }

    // Approval is required - check if already approved
    if (options.checkApproval) {
      const approvalStatus = await options.checkApproval();

      switch (approvalStatus.status) {
        case "approved":
          // Approved - execute the operation
          return operation(args);
        case "rejected":
          return err({
            type: "APPROVAL_REJECTED",
            stepKey: options.key,
            reason: approvalStatus.reason,
          });
        case "pending":
          // Fall through to return pending
          break;
      }
    }

    // Return pending approval with args visible
    const description =
      typeof options.description === "function"
        ? options.description(args)
        : options.description;

    return err({
      type: "PENDING_APPROVAL",
      stepKey: options.key,
      reason: description,
      metadata: {
        ...options.metadata,
        pendingArgs: args,
        gatedOperation: true,
      },
    });
  };
}
