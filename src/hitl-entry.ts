/**
 * awaitly/hitl
 *
 * Human-in-the-loop orchestration: pause workflows for manual approval,
 * manage approval state, and resume from checkpoints.
 *
 * @example
 * ```typescript
 * import { createApprovalStep, isPendingApproval, injectApproval } from 'awaitly/hitl';
 *
 * const requireApproval = createApprovalStep({
 *   key: 'approve:refund',
 *   checkApproval: async () => ({ status: 'pending' }),
 * });
 *
 * const result = await workflow(async (step) => {
 *   const refund = await step(calculateRefund(orderId));
 *   const approval = await step(requireApproval, { key: 'approve:refund' });
 *   return await step(processRefund(refund, approval));
 * });
 *
 * if (!result.ok && isPendingApproval(result.error)) {
 *   // Notify operators, later call injectApproval(state, { stepKey, value })
 * }
 * ```
 */

// =============================================================================
// HITL Step Helpers (from workflow.ts)
// =============================================================================
export {
  // Types
  type PendingApproval,
  type ApprovalRejected,
  type ApprovalStepOptions,
  type GatedStepOptions,

  // Functions
  isPendingApproval,
  isApprovalRejected,
  pendingApproval,
  createApprovalStep,
  gatedStep,
  injectApproval,
  clearStep,
  hasPendingApproval,
  getPendingApprovals,
  createHITLCollector,
} from "./workflow";

// =============================================================================
// HITL Orchestration (from hitl.ts)
// =============================================================================
export {
  // Types
  type ApprovalStatus,
  type ApprovalStore,
  type SavedWorkflowState,
  type WorkflowStateStore,
  type HITLOrchestratorOptions,
  type HITLExecutionResult,
  type PollerOptions,
  type HITLOrchestrator,
  type HITLWorkflowFactoryOptions,
  type ApprovalWebhookRequest,
  type ApprovalWebhookResponse,

  // Notification channel types (for integrations)
  type NotificationChannel,
  type ApprovalNeededContext,
  type ApprovalResolvedContext,

  // Functions
  createMemoryApprovalStore,
  createMemoryWorkflowStateStore,
  createHITLOrchestrator,
  createApprovalWebhookHandler,
  createApprovalChecker,
} from "./hitl";
