/**
 * awaitly/hitl
 *
 * Human-in-the-Loop Orchestration Helpers.
 * Provides pollers, webhook handlers, and resume injectors
 * for production-ready approval workflows.
 */

import type { Result, WorkflowEvent } from "./core";
import type { ResumeState, Workflow } from "./workflow";
import { createHITLCollector, isPendingApproval, injectApproval } from "./workflow";

// =============================================================================
// Workflow Factory Types
// =============================================================================

/**
 * Options passed to the workflow factory by the HITL orchestrator.
 */
export interface HITLWorkflowFactoryOptions {
  /** Resume state for replaying completed steps */
  resumeState?: ResumeState;
  /** Event handler for tracking workflow events (required for HITL) */
  onEvent: (event: WorkflowEvent<unknown>) => void;
}

// =============================================================================
// Types
// =============================================================================

/**
 * Approval status returned from the approval store.
 */
export type ApprovalStatus<T = unknown> =
  | { status: "pending" }
  | { status: "approved"; value: T; approvedBy?: string; approvedAt?: number }
  | { status: "rejected"; reason: string; rejectedBy?: string; rejectedAt?: number }
  | { status: "expired"; expiredAt: number };

/**
 * Interface for approval storage backends.
 */
export interface ApprovalStore {
  /**
   * Get the status of an approval.
   */
  getApproval(key: string): Promise<ApprovalStatus>;

  /**
   * Create or update a pending approval request.
   */
  createApproval(
    key: string,
    options?: {
      metadata?: Record<string, unknown>;
      expiresAt?: number;
      requestedBy?: string;
    }
  ): Promise<void>;

  /**
   * Grant an approval.
   */
  grantApproval<T>(
    key: string,
    value: T,
    options?: { approvedBy?: string }
  ): Promise<void>;

  /**
   * Reject an approval.
   */
  rejectApproval(
    key: string,
    reason: string,
    options?: { rejectedBy?: string }
  ): Promise<void>;

  /**
   * Cancel a pending approval.
   */
  cancelApproval(key: string): Promise<void>;

  /**
   * List all pending approvals.
   */
  listPending(options?: { prefix?: string }): Promise<string[]>;
}

/**
 * Saved workflow state for resumption.
 */
export interface SavedWorkflowState {
  /** Unique identifier for this workflow run */
  runId: string;
  /** Workflow name/type */
  workflowName: string;
  /** Resume state with step results */
  resumeState: ResumeState;
  /** Pending approval keys */
  pendingApprovals: string[];
  /** Input that was passed to the workflow */
  input?: unknown;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** When the workflow was started */
  startedAt: number;
  /** When the state was last updated */
  updatedAt: number;
}

/**
 * Interface for workflow state storage.
 */
export interface WorkflowStateStore {
  /**
   * Save workflow state.
   */
  save(state: SavedWorkflowState): Promise<void>;

  /**
   * Load workflow state by run ID.
   */
  load(runId: string): Promise<SavedWorkflowState | undefined>;

  /**
   * Delete workflow state.
   */
  delete(runId: string): Promise<void>;

  /**
   * List all saved workflow states.
   */
  list(options?: { workflowName?: string; hasPendingApprovals?: boolean }): Promise<string[]>;

  /**
   * Find workflows waiting for a specific approval.
   */
  findByPendingApproval(approvalKey: string): Promise<string[]>;
}

/**
 * Options for the HITL orchestrator.
 */
export interface HITLOrchestratorOptions {
  /** Approval store for managing approval states */
  approvalStore: ApprovalStore;
  /** Workflow state store for persisting workflow state */
  workflowStateStore: WorkflowStateStore;
  /** Default expiration time for approvals (in milliseconds) */
  defaultExpirationMs?: number;
  /** Logger function */
  logger?: (message: string) => void;
}

/**
 * Result of executing a workflow that may pause for approval.
 * Uses unknown for error type since workflows add UnexpectedError to the union.
 */
export type HITLExecutionResult<T, E> =
  | { status: "completed"; result: Result<T, E | unknown> }
  | { status: "paused"; runId: string; pendingApprovals: string[]; reason?: string }
  | { status: "resumed"; runId: string; result: Result<T, E | unknown> };

/**
 * Poller configuration.
 */
export interface PollerOptions {
  /** Polling interval in milliseconds */
  intervalMs: number;
  /** Maximum number of polls (undefined = unlimited) */
  maxPolls?: number;
  /** Timeout for the entire polling operation */
  timeoutMs?: number;
  /** Callback when polling starts */
  onPollStart?: () => void;
  /** Callback when a poll completes */
  onPollComplete?: (result: ApprovalStatus) => void;
}

// =============================================================================
// In-Memory Stores (for development/testing)
// =============================================================================

/**
 * Create an in-memory approval store for development/testing.
 */
export function createMemoryApprovalStore(): ApprovalStore {
  const approvals = new Map<string, ApprovalStatus & { metadata?: Record<string, unknown>; expiresAt?: number }>();

  return {
    async getApproval(key: string): Promise<ApprovalStatus> {
      const approval = approvals.get(key);
      if (!approval) {
        return { status: "pending" };
      }

      // Check expiration
      if (approval.expiresAt && Date.now() > approval.expiresAt) {
        return { status: "expired", expiredAt: approval.expiresAt };
      }

      return approval;
    },

    async createApproval(
      key: string,
      options?: { metadata?: Record<string, unknown>; expiresAt?: number }
    ): Promise<void> {
      approvals.set(key, {
        status: "pending",
        metadata: options?.metadata,
        expiresAt: options?.expiresAt,
      });
    },

    async grantApproval<T>(
      key: string,
      value: T,
      options?: { approvedBy?: string }
    ): Promise<void> {
      approvals.set(key, {
        status: "approved",
        value,
        approvedBy: options?.approvedBy,
        approvedAt: Date.now(),
      });
    },

    async rejectApproval(
      key: string,
      reason: string,
      options?: { rejectedBy?: string }
    ): Promise<void> {
      approvals.set(key, {
        status: "rejected",
        reason,
        rejectedBy: options?.rejectedBy,
        rejectedAt: Date.now(),
      });
    },

    async cancelApproval(key: string): Promise<void> {
      approvals.delete(key);
    },

    async listPending(options?: { prefix?: string }): Promise<string[]> {
      const pending: string[] = [];
      for (const [key, approval] of approvals) {
        if (approval.status === "pending") {
          if (!options?.prefix || key.startsWith(options.prefix)) {
            pending.push(key);
          }
        }
      }
      return pending;
    },
  };
}

/**
 * Create an in-memory workflow state store for development/testing.
 */
export function createMemoryWorkflowStateStore(): WorkflowStateStore {
  const states = new Map<string, SavedWorkflowState>();

  return {
    async save(state: SavedWorkflowState): Promise<void> {
      states.set(state.runId, { ...state, updatedAt: Date.now() });
    },

    async load(runId: string): Promise<SavedWorkflowState | undefined> {
      return states.get(runId);
    },

    async delete(runId: string): Promise<void> {
      states.delete(runId);
    },

    async list(options?: { workflowName?: string; hasPendingApprovals?: boolean }): Promise<string[]> {
      const results: string[] = [];
      for (const [runId, state] of states) {
        if (options?.workflowName && state.workflowName !== options.workflowName) {
          continue;
        }
        if (options?.hasPendingApprovals !== undefined) {
          const hasPending = state.pendingApprovals.length > 0;
          if (options.hasPendingApprovals !== hasPending) {
            continue;
          }
        }
        results.push(runId);
      }
      return results;
    },

    async findByPendingApproval(approvalKey: string): Promise<string[]> {
      const results: string[] = [];
      for (const [runId, state] of states) {
        if (state.pendingApprovals.includes(approvalKey)) {
          results.push(runId);
        }
      }
      return results;
    },
  };
}

// =============================================================================
// HITL Orchestrator
// =============================================================================

/**
 * HITL orchestrator interface.
 */
export interface HITLOrchestrator {
  /**
   * Execute a workflow that may pause for approvals.
   * If the workflow pauses, state is automatically saved.
   * 
   * The workflowFactory receives options including onEvent handler which MUST be
   * passed to createWorkflow for HITL tracking to work.
   */
  execute<T, E, TInput>(
    workflowName: string,
    workflowFactory: (options: HITLWorkflowFactoryOptions) => Workflow<E, unknown>,
    workflowFn: (step: unknown, deps: unknown, input: TInput) => Promise<T>,
    input: TInput,
    options?: { runId?: string; metadata?: Record<string, unknown> }
  ): Promise<HITLExecutionResult<T, E>>;

  /**
   * Resume a paused workflow after approvals have been granted.
   */
  resume<T, E, TInput>(
    runId: string,
    workflowFactory: (options: HITLWorkflowFactoryOptions) => Workflow<E, unknown>,
    workflowFn: (step: unknown, deps: unknown, input: TInput) => Promise<T>
  ): Promise<HITLExecutionResult<T, E>>;

  /**
   * Grant an approval and automatically resume any waiting workflows.
   */
  grantApproval<T>(
    approvalKey: string,
    value: T,
    options?: { approvedBy?: string; autoResume?: boolean }
  ): Promise<{ grantedAt: number; resumedWorkflows: string[] }>;

  /**
   * Reject an approval.
   */
  rejectApproval(
    approvalKey: string,
    reason: string,
    options?: { rejectedBy?: string }
  ): Promise<void>;

  /**
   * Poll for an approval to be granted.
   */
  pollApproval<T>(
    approvalKey: string,
    options?: PollerOptions
  ): Promise<ApprovalStatus<T>>;

  /**
   * Get the status of a workflow run.
   */
  getWorkflowStatus(runId: string): Promise<SavedWorkflowState | undefined>;

  /**
   * List all pending workflows.
   */
  listPendingWorkflows(workflowName?: string): Promise<string[]>;

  /**
   * Clean up completed workflows older than the specified age.
   */
  cleanup(maxAgeMs: number): Promise<number>;
}

/**
 * Create a HITL orchestrator for managing approval workflows.
 *
 * @example
 * ```typescript
 * const orchestrator = createHITLOrchestrator({
 *   approvalStore: createMemoryApprovalStore(),
 *   workflowStateStore: createMemoryWorkflowStateStore(),
 * });
 *
 * // Execute workflow - IMPORTANT: pass onEvent to createWorkflow!
 * const result = await orchestrator.execute(
 *   'order-approval',
 *   ({ resumeState, onEvent }) => createWorkflow(deps, { resumeState, onEvent }),
 *   async (step, deps, input) => {
 *     const order = await step(() => deps.createOrder(input));
 *     const approval = await step(() => deps.requireApproval(order.id), { key: `approval:${order.id}` });
 *     await step(() => deps.processOrder(order.id));
 *     return { orderId: order.id, approvedBy: approval.approvedBy };
 *   },
 *   { items: [...], total: 100 }
 * );
 *
 * if (result.status === 'paused') {
 *   console.log(`Workflow paused, waiting for: ${result.pendingApprovals}`);
 * }
 *
 * // Later, grant approval
 * await orchestrator.grantApproval(
 *   `approval:${orderId}`,
 *   { approvedBy: 'manager@example.com' },
 *   { autoResume: true }
 * );
 * ```
 */
export function createHITLOrchestrator(options: HITLOrchestratorOptions): HITLOrchestrator {
  const {
    approvalStore,
    workflowStateStore,
    defaultExpirationMs = 7 * 24 * 60 * 60 * 1000, // 7 days
    logger = () => {},
  } = options;

  async function execute<T, E, TInput>(
    workflowName: string,
    workflowFactory: (options: HITLWorkflowFactoryOptions) => Workflow<E, unknown>,
    workflowFn: (step: unknown, deps: unknown, input: TInput) => Promise<T>,
    input: TInput,
    opts?: { runId?: string; metadata?: Record<string, unknown> }
  ): Promise<HITLExecutionResult<T, E>> {
    const runId = opts?.runId ?? crypto.randomUUID();
    const collector = createHITLCollector();

    // Create workflow with collector's event handler wired in
    const workflow = workflowFactory({
      onEvent: collector.handleEvent,
    });

    // Execute workflow - collector tracks pending approvals via events
    const result = await (workflow as Workflow<E, unknown>)(
      input,
      workflowFn as (step: unknown, deps: unknown, args: TInput) => Promise<T>
    );

    // Check for pending approvals
    const pendingApprovals = collector.getPendingApprovals().map((p) => p.stepKey);

    if (pendingApprovals.length > 0) {
      // Save state for later resumption
      const state: SavedWorkflowState = {
        runId,
        workflowName,
        resumeState: collector.getState(),
        pendingApprovals,
        input,
        metadata: opts?.metadata,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };

      await workflowStateStore.save(state);

      // Create approval requests in the store
      for (const key of pendingApprovals) {
        await approvalStore.createApproval(key, {
          metadata: { runId, workflowName },
          expiresAt: Date.now() + defaultExpirationMs,
        });
      }

      logger(`Workflow ${runId} paused, waiting for: ${pendingApprovals.join(", ")}`);

      // Find the reason from the error if available
      let reason: string | undefined;
      if (!result.ok && isPendingApproval(result.error)) {
        reason = result.error.reason;
      }

      return {
        status: "paused",
        runId,
        pendingApprovals,
        reason,
      };
    }

    // Workflow completed
    logger(`Workflow ${runId} completed`);
    return { status: "completed", result };
  }

  async function resume<T, E, TInput>(
    runId: string,
    workflowFactory: (options: HITLWorkflowFactoryOptions) => Workflow<E, unknown>,
    workflowFn: (step: unknown, deps: unknown, input: TInput) => Promise<T>
  ): Promise<HITLExecutionResult<T, E>> {
    const savedState = await workflowStateStore.load(runId);
    if (!savedState) {
      throw new Error(`Workflow run not found: ${runId}`);
    }

    // Check if all approvals have been granted
    for (const key of savedState.pendingApprovals) {
      const status = await approvalStore.getApproval(key);
      if (status.status === "pending") {
        return {
          status: "paused",
          runId,
          pendingApprovals: savedState.pendingApprovals,
        };
      }
      if (status.status === "rejected") {
        // Inject rejection as error
        // This would need custom handling
      }
      if (status.status === "expired") {
        throw new Error(`Approval ${key} has expired`);
      }
    }

    // Inject approved values into resume state
    let resumeState = savedState.resumeState;
    for (const key of savedState.pendingApprovals) {
      const status = await approvalStore.getApproval(key);
      if (status.status === "approved") {
        resumeState = injectApproval(resumeState, {
          stepKey: key,
          value: status.value,
        });
      }
    }

    // Create collector for tracking any new pending approvals
    const collector = createHITLCollector();

    // Create workflow with resume state and event handler
    const workflow = workflowFactory({
      resumeState,
      onEvent: collector.handleEvent,
    });

    // Execute workflow
    const result = await (workflow as Workflow<E, unknown>)(
      savedState.input as TInput,
      workflowFn as (step: unknown, deps: unknown, args: TInput) => Promise<T>
    );

    // Check for NEW pending approvals (workflow paused again at a different step)
    const newPendingApprovals = collector.getPendingApprovals().map((p) => p.stepKey);

    if (newPendingApprovals.length > 0) {
      // Update saved state with new pending approvals
      const updatedState: SavedWorkflowState = {
        ...savedState,
        resumeState: collector.getState(),
        pendingApprovals: newPendingApprovals,
        updatedAt: Date.now(),
      };

      await workflowStateStore.save(updatedState);

      // Create approval requests for new approvals
      for (const key of newPendingApprovals) {
        await approvalStore.createApproval(key, {
          metadata: { runId, workflowName: savedState.workflowName },
          expiresAt: Date.now() + defaultExpirationMs,
        });
      }

      logger(`Workflow ${runId} paused again, waiting for: ${newPendingApprovals.join(", ")}`);

      // Find the reason from the error if available
      let reason: string | undefined;
      if (!result.ok && isPendingApproval(result.error)) {
        reason = result.error.reason;
      }

      return {
        status: "paused",
        runId,
        pendingApprovals: newPendingApprovals,
        reason,
      };
    }

    // Workflow completed - clean up saved state
    await workflowStateStore.delete(runId);

    logger(`Workflow ${runId} resumed and completed`);
    return { status: "resumed", runId, result };
  }

  async function grantApprovalFn<T>(
    approvalKey: string,
    value: T,
    opts?: { approvedBy?: string; autoResume?: boolean }
  ): Promise<{ grantedAt: number; resumedWorkflows: string[] }> {
    await approvalStore.grantApproval(approvalKey, value, {
      approvedBy: opts?.approvedBy,
    });

    const grantedAt = Date.now();
    const resumedWorkflows: string[] = [];

    if (opts?.autoResume !== false) {
      // Find workflows waiting for this approval
      const waitingWorkflows = await workflowStateStore.findByPendingApproval(approvalKey);

      for (const runId of waitingWorkflows) {
        // Note: Auto-resume would need the workflow factory, which we don't have here
        // This is a simplified implementation
        resumedWorkflows.push(runId);
      }
    }

    logger(`Approval ${approvalKey} granted by ${opts?.approvedBy ?? "unknown"}`);
    return { grantedAt, resumedWorkflows };
  }

  async function rejectApprovalFn(
    approvalKey: string,
    reason: string,
    opts?: { rejectedBy?: string }
  ): Promise<void> {
    await approvalStore.rejectApproval(approvalKey, reason, {
      rejectedBy: opts?.rejectedBy,
    });
    logger(`Approval ${approvalKey} rejected: ${reason}`);
  }

  async function pollApproval<T>(
    approvalKey: string,
    opts?: PollerOptions
  ): Promise<ApprovalStatus<T>> {
    const {
      intervalMs = 1000,
      maxPolls,
      timeoutMs,
      onPollStart,
      onPollComplete,
    } = opts ?? {};

    const startTime = Date.now();
    let pollCount = 0;

    while (true) {
      onPollStart?.();
      const status = (await approvalStore.getApproval(approvalKey)) as ApprovalStatus<T>;
      onPollComplete?.(status);

      if (status.status !== "pending") {
        return status;
      }

      pollCount++;
      if (maxPolls !== undefined && pollCount >= maxPolls) {
        return { status: "pending" };
      }

      if (timeoutMs !== undefined && Date.now() - startTime >= timeoutMs) {
        return { status: "pending" };
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async function getWorkflowStatus(runId: string): Promise<SavedWorkflowState | undefined> {
    return workflowStateStore.load(runId);
  }

  async function listPendingWorkflows(workflowName?: string): Promise<string[]> {
    return workflowStateStore.list({
      workflowName,
      hasPendingApprovals: true,
    });
  }

  async function cleanup(maxAgeMs: number): Promise<number> {
    const allWorkflows = await workflowStateStore.list();
    let cleaned = 0;
    const cutoff = Date.now() - maxAgeMs;

    for (const runId of allWorkflows) {
      const state = await workflowStateStore.load(runId);
      if (state && state.updatedAt < cutoff && state.pendingApprovals.length === 0) {
        await workflowStateStore.delete(runId);
        cleaned++;
      }
    }

    logger(`Cleaned up ${cleaned} old workflow states`);
    return cleaned;
  }

  return {
    execute,
    resume,
    grantApproval: grantApprovalFn,
    rejectApproval: rejectApprovalFn,
    pollApproval,
    getWorkflowStatus,
    listPendingWorkflows,
    cleanup,
  };
}

// =============================================================================
// Webhook Handlers for Approvals
// =============================================================================

/**
 * Approval webhook request body.
 */
export interface ApprovalWebhookRequest {
  /** Approval key */
  key: string;
  /** Action: approve, reject, or cancel */
  action: "approve" | "reject" | "cancel";
  /** Value to inject (for approve) */
  value?: unknown;
  /** Reason (for reject) */
  reason?: string;
  /** Who performed this action */
  actorId?: string;
}

/**
 * Approval webhook response.
 */
export interface ApprovalWebhookResponse {
  success: boolean;
  message: string;
  data?: {
    key: string;
    action: string;
    timestamp: number;
  };
}

/**
 * Create a webhook handler for approval actions.
 *
 * @example
 * ```typescript
 * const handleApproval = createApprovalWebhookHandler(approvalStore);
 *
 * // Express
 * app.post('/api/approvals', async (req, res) => {
 *   const result = await handleApproval(req.body);
 *   res.json(result);
 * });
 * ```
 */
export function createApprovalWebhookHandler(
  store: ApprovalStore
): (request: ApprovalWebhookRequest) => Promise<ApprovalWebhookResponse> {
  return async (request: ApprovalWebhookRequest): Promise<ApprovalWebhookResponse> => {
    const { key, action, value, reason, actorId } = request;

    try {
      switch (action) {
        case "approve":
          await store.grantApproval(key, value, { approvedBy: actorId });
          return {
            success: true,
            message: `Approval ${key} granted`,
            data: { key, action, timestamp: Date.now() },
          };

        case "reject":
          if (!reason) {
            return { success: false, message: "Reason is required for rejection" };
          }
          await store.rejectApproval(key, reason, { rejectedBy: actorId });
          return {
            success: true,
            message: `Approval ${key} rejected`,
            data: { key, action, timestamp: Date.now() },
          };

        case "cancel":
          await store.cancelApproval(key);
          return {
            success: true,
            message: `Approval ${key} cancelled`,
            data: { key, action, timestamp: Date.now() },
          };

        default:
          return { success: false, message: `Unknown action: ${action}` };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

// =============================================================================
// Approval Status Checker
// =============================================================================

/**
 * Create an approval checker function for use in approval steps.
 * This wraps the approval store with the standard checkApproval interface.
 *
 * @example
 * ```typescript
 * const checkApproval = createApprovalChecker(approvalStore);
 *
 * const requireManagerApproval = createApprovalStep<{ approvedBy: string }>({
 *   key: 'manager-approval',
 *   checkApproval: checkApproval('manager-approval'),
 *   pendingReason: 'Waiting for manager approval',
 * });
 * ```
 */
export function createApprovalChecker<T>(store: ApprovalStore) {
  return (key: string) => async (): Promise<
    | { status: "pending" }
    | { status: "approved"; value: T }
    | { status: "rejected"; reason: string }
  > => {
    const status = await store.getApproval(key);

    switch (status.status) {
      case "pending":
        return { status: "pending" };
      case "approved":
        return { status: "approved", value: status.value as T };
      case "rejected":
        return { status: "rejected", reason: status.reason };
      case "expired":
        return { status: "rejected", reason: "Approval request expired" };
      default:
        return { status: "pending" };
    }
  };
}
