/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Tests for hitl.ts - Human-in-the-Loop support
 */
import { describe, it, expect, vi } from "vitest";
import { AsyncResult, err, isErr, isOk, ok, Result } from "../core";
import { createWorkflow } from "../workflow-entry";
import { ResumeState, createResumeStateCollector } from "../workflow";
import {
  PendingApproval,
  ApprovalRejected,
  isPendingApproval,
  isApprovalRejected,
  pendingApproval,
  createApprovalStep,
  injectApproval,
  clearStep,
  hasPendingApproval,
  getPendingApprovals,
  createApprovalStateCollector,
} from "../hitl-entry";

describe("HITL - Human-in-the-Loop Support", () => {
  describe("Type guards", () => {
    it("isPendingApproval identifies PendingApproval errors", () => {
      const pending: PendingApproval = {
        type: "PENDING_APPROVAL",
        stepKey: "approval:123",
      };
      expect(isPendingApproval(pending)).toBe(true);
      expect(isPendingApproval({ type: "OTHER" })).toBe(false);
      expect(isPendingApproval(null)).toBe(false);
      expect(isPendingApproval("string")).toBe(false);
    });

    it("isApprovalRejected identifies ApprovalRejected errors", () => {
      const rejected: ApprovalRejected = {
        type: "APPROVAL_REJECTED",
        stepKey: "approval:123",
        reason: "Not authorized",
      };
      expect(isApprovalRejected(rejected)).toBe(true);
      expect(isApprovalRejected({ type: "OTHER" })).toBe(false);
      expect(isApprovalRejected(null)).toBe(false);
    });
  });

  describe("pendingApproval()", () => {
    it("creates a PendingApproval error result", () => {
      const result = pendingApproval("approval:123");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("PENDING_APPROVAL");
        expect(result.error.stepKey).toBe("approval:123");
        expect(result.error.reason).toBeUndefined();
      }
    });

    it("includes optional reason and metadata", () => {
      const result = pendingApproval("approval:123", {
        reason: "Requires manager sign-off",
        metadata: { requestedBy: "user:456" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.reason).toBe("Requires manager sign-off");
        expect(result.error.metadata).toEqual({ requestedBy: "user:456" });
      }
    });
  });

  describe("createApprovalStep()", () => {
    it("returns ok when approved", async () => {
      const checkApproval = createApprovalStep<{ approvedBy: string }>({
        key: "test-approval",
        checkApproval: async () => ({
          status: "approved",
          value: { approvedBy: "admin" },
        }),
      });

      const result = await checkApproval();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.approvedBy).toBe("admin");
      }
    });

    it("returns PendingApproval when pending", async () => {
      const checkApproval = createApprovalStep<{ approvedBy: string }>({
        key: "test-approval",
        checkApproval: async () => ({ status: "pending" }),
        pendingReason: "Awaiting manager approval",
      });

      const result = await checkApproval();
      expect(result.ok).toBe(false);
      if (!result.ok && isPendingApproval(result.error)) {
        expect(result.error.stepKey).toBe("test-approval");
        expect(result.error.reason).toBe("Awaiting manager approval");
      }
    });

    it("returns ApprovalRejected when rejected", async () => {
      const checkApproval = createApprovalStep<{ approvedBy: string }>({
        key: "test-approval",
        checkApproval: async () => ({
          status: "rejected",
          reason: "Budget exceeded",
        }),
      });

      const result = await checkApproval();
      expect(result.ok).toBe(false);
      if (!result.ok && isApprovalRejected(result.error)) {
        expect(result.error.stepKey).toBe("test-approval");
        expect(result.error.reason).toBe("Budget exceeded");
      }
    });
  });

  describe("State helpers", () => {
    it("injectApproval adds approval to resume state", () => {
      const state: ResumeState = { steps: new Map() };
      const updated = injectApproval(state, {
        stepKey: "approval:123",
        value: { approvedBy: "admin" },
      });

      expect(updated.steps.has("approval:123")).toBe(true);
      const entry = updated.steps.get("approval:123")!;
      expect(entry.result.ok).toBe(true);
      if (entry.result.ok) {
        expect(entry.result.value).toEqual({ approvedBy: "admin" });
      }
    });

    it("injectApproval does not mutate original state", () => {
      const state: ResumeState = { steps: new Map() };
      const updated = injectApproval(state, {
        stepKey: "approval:123",
        value: { approvedBy: "admin" },
      });

      expect(state.steps.has("approval:123")).toBe(false);
      expect(updated.steps.has("approval:123")).toBe(true);
    });

    it("clearStep removes a step from resume state", () => {
      const state: ResumeState = {
        steps: new Map([
          ["step:1", { result: ok("value1") }],
          ["step:2", { result: ok("value2") }],
        ]),
      };
      const updated = clearStep(state, "step:1");

      expect(updated.steps.has("step:1")).toBe(false);
      expect(updated.steps.has("step:2")).toBe(true);
    });

    it("hasPendingApproval detects pending approval in state", () => {
      const pendingResult = pendingApproval("approval:123");
      const state: ResumeState = {
        steps: new Map([
          ["approval:123", { result: pendingResult }],
          ["other:456", { result: ok("done") }],
        ]),
      };

      expect(hasPendingApproval(state, "approval:123")).toBe(true);
      expect(hasPendingApproval(state, "other:456")).toBe(false);
      expect(hasPendingApproval(state, "nonexistent")).toBe(false);
    });

    it("getPendingApprovals returns all pending step keys", () => {
      const pending1 = pendingApproval("approval:1");
      const pending2 = pendingApproval("approval:2");
      const state: ResumeState = {
        steps: new Map([
          ["approval:1", { result: pending1 }],
          ["completed:1", { result: ok("done") }],
          ["approval:2", { result: pending2 }],
        ]),
      };

      const pendingKeys = getPendingApprovals(state);
      expect(pendingKeys).toContain("approval:1");
      expect(pendingKeys).toContain("approval:2");
      expect(pendingKeys).not.toContain("completed:1");
      expect(pendingKeys.length).toBe(2);
    });
  });

  describe("createApprovalStateCollector()", () => {
    it("collects step_complete events", async () => {
      const collector = createApprovalStateCollector();

      // Simulate step_complete events
      collector.handleEvent({
        type: "step_complete",
        workflowId: "wf-1",
        stepKey: "step:1",
        ts: Date.now(),
        durationMs: 100,
        result: ok("value1"),
      });

      const state = collector.getResumeState();
      expect(state.steps.has("step:1")).toBe(true);
    });

    it("detects pending approvals", async () => {
      const collector = createApprovalStateCollector();

      collector.handleEvent({
        type: "step_complete",
        workflowId: "wf-1",
        stepKey: "approval:1",
        ts: Date.now(),
        durationMs: 100,
        result: pendingApproval("approval:1"),
      });

      expect(collector.hasPendingApprovals()).toBe(true);
      const pending = collector.getPendingApprovals();
      expect(pending.length).toBe(1);
      expect(pending[0].stepKey).toBe("approval:1");
    });

    it("injectApproval updates collector state and returns resumeState", async () => {
      const collector = createApprovalStateCollector();

      // Add a pending approval
      collector.handleEvent({
        type: "step_complete",
        workflowId: "wf-1",
        stepKey: "approval:1",
        ts: Date.now(),
        durationMs: 100,
        result: pendingApproval("approval:1"),
      });

      expect(collector.hasPendingApprovals()).toBe(true);

      // Inject approval - should update internal state
      const resumeState = collector.injectApproval("approval:1", {
        approvedBy: "admin",
      });

      // Returned state has approval
      expect(resumeState.steps.has("approval:1")).toBe(true);
      const entry = resumeState.steps.get("approval:1")!;
      expect(entry.result.ok).toBe(true);

      // Collector state is also updated (no longer pending)
      expect(collector.hasPendingApprovals()).toBe(false);
      expect(collector.getResumeState().steps.get("approval:1")!.result.ok).toBe(true);
    });

    it("clear removes all collected state", async () => {
      const collector = createApprovalStateCollector();

      collector.handleEvent({
        type: "step_complete",
        workflowId: "wf-1",
        stepKey: "step:1",
        ts: Date.now(),
        durationMs: 100,
        result: ok("value1"),
      });

      expect(collector.getResumeState().steps.size).toBe(1);
      collector.clear();
      expect(collector.getResumeState().steps.size).toBe(0);
    });
  });

  describe("Full HITL workflow integration", () => {
    it("pauses on pending approval and resumes with injected result", async () => {
      // Approval checker that always returns pending (external state simulation)
      const requireApproval = createApprovalStep<{ approvedBy: string }>({
        key: "manager-approval",
        checkApproval: async () => {
          // In real usage, this would check external state
          return { status: "pending" };
        },
      });

      const fetchData = async (
        id: string
      ): AsyncResult<{ data: string }, "NOT_FOUND"> => {
        return ok({ data: `data-${id}` });
      };

      // First run: workflow should pause at approval
      const collector1 = createApprovalStateCollector();
      const workflow1 = createWorkflow(
        "workflow",
        { fetchData, requireApproval },
        { onEvent: collector1.handleEvent }
      );

      const result1 = await workflow1(async (step) => {
        const data = await step('fetchData', () => fetchData("123"));
        // Use step key matching the approval key for proper resume
        const approval = await step('manager-approval', () => requireApproval());
        return { data, approval };
      });

      // Should fail with pending approval
      expect(result1.ok).toBe(false);
      if (!result1.ok) {
        expect(isPendingApproval(result1.error)).toBe(true);
      }

      // Collector should have pending approvals
      expect(collector1.hasPendingApprovals()).toBe(true);

      // Simulate approval being granted externally
      const resumeState = collector1.injectApproval("manager-approval", {
        approvedBy: "manager",
      });

      // Second run: resume with approval
      const workflow2 = createWorkflow(
        "workflow",
        { fetchData, requireApproval },
        { resumeState }
      );

      const result2 = await workflow2(async (step) => {
        const data = await step('fetchData', () => fetchData("123"));
        // Use step key matching the approval key for proper resume
        const approval = await step('manager-approval', () => requireApproval());
        return { data, approval };
      });

      // Should succeed with both data and approval
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.data).toEqual({ data: "data-123" });
        expect(result2.value.approval).toEqual({ approvedBy: "manager" });
      }
    });

    it("handles rejected approvals", async () => {
      const requireApproval = createApprovalStep<{ approvedBy: string }>({
        key: "manager-approval",
        checkApproval: async () => ({
          status: "rejected",
          reason: "Insufficient budget",
        }),
      });

      const workflow = createWorkflow("workflow", { requireApproval });

      const result = await workflow(async (step) => {
        return await step('requireApproval', () => requireApproval());
      });

      expect(result.ok).toBe(false);
      if (!result.ok && isApprovalRejected(result.error)) {
        expect(result.error.reason).toBe("Insufficient budget");
      }
    });
  });
});

// =============================================================================
// HITL Orchestrator Tests (from hitl.ts)
// =============================================================================

import {
  createMemoryApprovalStore,
  createMemoryWorkflowStateStore,
  createHITLOrchestrator,
  createApprovalWebhookHandler,
  createApprovalChecker,
  type NotificationChannel,
  type ApprovalNeededContext,
  type ApprovalResolvedContext,
  type ApprovalStore,
} from ".";

describe("HITL Orchestrator", () => {
  describe("createMemoryApprovalStore", () => {
    it("creates pending approval", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key", { metadata: { foo: "bar" } });

      const status = await store.getApproval("test-key");
      expect(status.status).toBe("pending");
    });

    it("grants approval with value", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");
      await store.grantApproval("test-key", { amount: 100 }, { approvedBy: "admin" });

      const status = await store.getApproval("test-key");
      expect(status.status).toBe("approved");
      if (status.status === "approved") {
        expect(status.value).toEqual({ amount: 100 });
        expect(status.approvedBy).toBe("admin");
      }
    });

    it("rejects approval with reason", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");
      await store.rejectApproval("test-key", "Budget exceeded", { rejectedBy: "manager" });

      const status = await store.getApproval("test-key");
      expect(status.status).toBe("rejected");
      if (status.status === "rejected") {
        expect(status.reason).toBe("Budget exceeded");
        expect(status.rejectedBy).toBe("manager");
      }
    });

    it("edits approval with original and edited values", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");
      await store.editApproval(
        "test-key",
        { amount: 5000 },
        { amount: 4500 },
        { editedBy: "manager" }
      );

      const status = await store.getApproval("test-key");
      expect(status.status).toBe("edited");
      if (status.status === "edited") {
        expect(status.originalValue).toEqual({ amount: 5000 });
        expect(status.editedValue).toEqual({ amount: 4500 });
        expect(status.editedBy).toBe("manager");
      }
    });

    it("cancels approval", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");
      await store.cancelApproval("test-key");

      const status = await store.getApproval("test-key");
      // After cancellation, approval is removed, so status is pending (default)
      expect(status.status).toBe("pending");
    });

    it("lists pending approvals", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("pending-1");
      await store.createApproval("pending-2");
      await store.createApproval("approved-1");
      await store.grantApproval("approved-1", {});

      const pending = await store.listPending();
      expect(pending).toContain("pending-1");
      expect(pending).toContain("pending-2");
      expect(pending).not.toContain("approved-1");
    });

    it("handles expiration", async () => {
      const store = createMemoryApprovalStore();
      // Create approval that already expired
      await store.createApproval("test-key", { expiresAt: Date.now() - 1000 });

      const status = await store.getApproval("test-key");
      expect(status.status).toBe("expired");
    });
  });

  describe("createApprovalChecker", () => {
    it("returns pending for pending approvals", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");

      const checker = createApprovalChecker(store);
      const check = checker("test-key");
      const result = await check();

      expect(result.status).toBe("pending");
    });

    it("returns approved with value for approved approvals", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");
      await store.grantApproval("test-key", { amount: 100 });

      const checker = createApprovalChecker<{ amount: number }>(store);
      const check = checker("test-key");
      const result = await check();

      expect(result.status).toBe("approved");
      if (result.status === "approved") {
        expect(result.value).toEqual({ amount: 100 });
      }
    });

    it("returns approved with editedValue for edited approvals", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");
      await store.editApproval("test-key", { amount: 5000 }, { amount: 4500 });

      const checker = createApprovalChecker<{ amount: number }>(store);
      const check = checker("test-key");
      const result = await check();

      // Edited should be treated as approved, using editedValue
      expect(result.status).toBe("approved");
      if (result.status === "approved") {
        expect(result.value).toEqual({ amount: 4500 });
      }
    });

    it("returns rejected for rejected approvals", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");
      await store.rejectApproval("test-key", "Not allowed");

      const checker = createApprovalChecker(store);
      const check = checker("test-key");
      const result = await check();

      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBe("Not allowed");
      }
    });

    it("returns rejected for expired approvals", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key", { expiresAt: Date.now() - 1000 });

      const checker = createApprovalChecker(store);
      const check = checker("test-key");
      const result = await check();

      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBe("Approval request expired");
      }
    });
  });

  describe("NotificationChannel", () => {
    it("calls onApprovalNeeded when workflow pauses", async () => {
      const onApprovalNeeded = vi.fn();
      const notificationChannel: NotificationChannel = {
        onApprovalNeeded,
      };

      const approvalStore = createMemoryApprovalStore();
      const workflowStateStore = createMemoryWorkflowStateStore();

      const orchestrator = createHITLOrchestrator({
        approvalStore,
        workflowStateStore,
        notificationChannel,
      });

      const fetchData = async () => ok({ id: "123" });
      const requireApproval = createApprovalStep({
        key: "test-approval",
        checkApproval: async () => ({ status: "pending" }),
      });

      await orchestrator.execute(
        "test-workflow",
        ({ resumeState, onEvent }) =>
          createWorkflow("workflow", { fetchData, requireApproval }, { resumeState, onEvent }),
        async (step, deps) => {
          await step('fetchData', () => fetchData());
          // Use step ID matching the approval key for proper orchestration
          return await step('test-approval', () => requireApproval());
        },
        {}
      );

      expect(onApprovalNeeded).toHaveBeenCalledTimes(1);
      expect(onApprovalNeeded).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalKey: "test-approval",
          workflowName: "test-workflow",
        })
      );
    });

    it("calls onApprovalResolved when approval is granted", async () => {
      const onApprovalResolved = vi.fn();
      const notificationChannel: NotificationChannel = {
        onApprovalNeeded: vi.fn(),
        onApprovalResolved,
      };

      const orchestrator = createHITLOrchestrator({
        approvalStore: createMemoryApprovalStore(),
        workflowStateStore: createMemoryWorkflowStateStore(),
        notificationChannel,
      });

      await orchestrator.grantApproval("test-key", { approved: true }, { approvedBy: "admin" });

      expect(onApprovalResolved).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalKey: "test-key",
          action: "approved",
          actorId: "admin",
          value: { approved: true },
        })
      );
    });

    it("calls onApprovalResolved when approval is rejected", async () => {
      const onApprovalResolved = vi.fn();
      const notificationChannel: NotificationChannel = {
        onApprovalNeeded: vi.fn(),
        onApprovalResolved,
      };

      const orchestrator = createHITLOrchestrator({
        approvalStore: createMemoryApprovalStore(),
        workflowStateStore: createMemoryWorkflowStateStore(),
        notificationChannel,
      });

      await orchestrator.rejectApproval("test-key", "Not allowed", { rejectedBy: "manager" });

      expect(onApprovalResolved).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalKey: "test-key",
          action: "rejected",
          actorId: "manager",
          reason: "Not allowed",
        })
      );
    });

    it("calls onApprovalResolved when approval is edited", async () => {
      const onApprovalResolved = vi.fn();
      const notificationChannel: NotificationChannel = {
        onApprovalNeeded: vi.fn(),
        onApprovalResolved,
      };

      const orchestrator = createHITLOrchestrator({
        approvalStore: createMemoryApprovalStore(),
        workflowStateStore: createMemoryWorkflowStateStore(),
        notificationChannel,
      });

      await orchestrator.editApproval(
        "test-key",
        { amount: 5000 },
        { amount: 4500 },
        { editedBy: "manager" }
      );

      expect(onApprovalResolved).toHaveBeenCalledWith(
        expect.objectContaining({
          approvalKey: "test-key",
          action: "edited",
          actorId: "manager",
          value: { amount: 4500 },
          originalValue: { amount: 5000 },
        })
      );
    });

    it("notification failures do not abort execute()", async () => {
      const failingChannel: NotificationChannel = {
        onApprovalNeeded: vi.fn().mockRejectedValue(new Error("Slack API error")),
      };

      const orchestrator = createHITLOrchestrator({
        approvalStore: createMemoryApprovalStore(),
        workflowStateStore: createMemoryWorkflowStateStore(),
        notificationChannel: failingChannel,
      });

      const requireApproval = createApprovalStep({
        key: "test-approval",
        checkApproval: async () => ({ status: "pending" }),
      });

      // Should not throw despite notification failure
      const result = await orchestrator.execute(
        "test-workflow",
        ({ resumeState, onEvent }) =>
          createWorkflow("workflow", { requireApproval }, { resumeState, onEvent }),
        async (step) => {
          return await step('requireApproval', () => requireApproval());
        },
        {}
      );

      // Workflow should still pause successfully
      expect(result.status).toBe("paused");
      expect(failingChannel.onApprovalNeeded).toHaveBeenCalled();
    });
  });

  describe("editApproval in orchestrator", () => {
    it("editApproval stores original and edited values", async () => {
      const approvalStore = createMemoryApprovalStore();
      const orchestrator = createHITLOrchestrator({
        approvalStore,
        workflowStateStore: createMemoryWorkflowStateStore(),
      });

      const { editedAt } = await orchestrator.editApproval(
        "budget-approval",
        { amount: 10000, note: "Q4 budget" },
        { amount: 8500, note: "Reduced per policy" },
        { editedBy: "cfo@company.com" }
      );

      expect(editedAt).toBeGreaterThan(0);

      const status = await approvalStore.getApproval("budget-approval");
      expect(status.status).toBe("edited");
      if (status.status === "edited") {
        expect(status.originalValue).toEqual({ amount: 10000, note: "Q4 budget" });
        expect(status.editedValue).toEqual({ amount: 8500, note: "Reduced per policy" });
        expect(status.editedBy).toBe("cfo@company.com");
      }
    });
  });

  describe("createApprovalWebhookHandler", () => {
    it("handles approve action", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");

      const handler = createApprovalWebhookHandler(store);
      const response = await handler({
        key: "test-key",
        action: "approve",
        value: { approved: true },
        actorId: "admin",
      });

      expect(response.success).toBe(true);
      expect(response.message).toContain("granted");

      const status = await store.getApproval("test-key");
      expect(status.status).toBe("approved");
    });

    it("handles reject action", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");

      const handler = createApprovalWebhookHandler(store);
      const response = await handler({
        key: "test-key",
        action: "reject",
        reason: "Not allowed",
        actorId: "manager",
      });

      expect(response.success).toBe(true);
      expect(response.message).toContain("rejected");

      const status = await store.getApproval("test-key");
      expect(status.status).toBe("rejected");
    });

    it("handles edit action", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");

      const handler = createApprovalWebhookHandler(store);
      const response = await handler({
        key: "test-key",
        action: "edit",
        originalValue: { amount: 5000 },
        editedValue: { amount: 4500 },
        actorId: "manager",
      });

      expect(response.success).toBe(true);
      expect(response.message).toContain("edited");

      const status = await store.getApproval("test-key");
      expect(status.status).toBe("edited");
    });

    it("rejects edit without originalValue or editedValue", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");

      const handler = createApprovalWebhookHandler(store);

      const response1 = await handler({
        key: "test-key",
        action: "edit",
        originalValue: { amount: 5000 },
        // missing editedValue
      });
      expect(response1.success).toBe(false);

      const response2 = await handler({
        key: "test-key",
        action: "edit",
        editedValue: { amount: 4500 },
        // missing originalValue
      });
      expect(response2.success).toBe(false);
    });

    it("handles cancel action", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");

      const handler = createApprovalWebhookHandler(store);
      const response = await handler({
        key: "test-key",
        action: "cancel",
      });

      expect(response.success).toBe(true);
      expect(response.message).toContain("cancelled");
    });

    it("requires reason for reject", async () => {
      const store = createMemoryApprovalStore();
      await store.createApproval("test-key");

      const handler = createApprovalWebhookHandler(store);
      const response = await handler({
        key: "test-key",
        action: "reject",
        // missing reason
      });

      expect(response.success).toBe(false);
      expect(response.message).toContain("Reason is required");
    });
  });

  describe("Metadata handling", () => {
    it("does not allow pendingMetadata to overwrite runId/workflowName", async () => {
      const approvalStore = createMemoryApprovalStore();
      const workflowStateStore = createMemoryWorkflowStateStore();

      // Create a custom store that captures the metadata
      let capturedMetadata: Record<string, unknown> | undefined;
      const trackingStore: ApprovalStore = {
        ...approvalStore,
        async createApproval(key, options) {
          capturedMetadata = options?.metadata;
          return approvalStore.createApproval(key, options);
        },
        async getApproval(key) {
          return approvalStore.getApproval(key);
        },
        async grantApproval(key, value, options) {
          return approvalStore.grantApproval(key, value, options);
        },
        async rejectApproval(key, reason, options) {
          return approvalStore.rejectApproval(key, reason, options);
        },
        async editApproval(key, orig, edited, options) {
          return approvalStore.editApproval(key, orig, edited, options);
        },
        async cancelApproval(key) {
          return approvalStore.cancelApproval(key);
        },
        async listPending(options) {
          return approvalStore.listPending(options);
        },
      };

      const orchestrator = createHITLOrchestrator({
        approvalStore: trackingStore,
        workflowStateStore,
      });

      // Create a step that returns PendingApproval with malicious metadata
      const maliciousApproval = async (): AsyncResult<unknown, PendingApproval> => {
        return err({
          type: "PENDING_APPROVAL",
          stepKey: "test-approval",
          metadata: {
            runId: "MALICIOUS_RUN_ID",
            workflowName: "MALICIOUS_WORKFLOW",
            legitimateField: "this is fine",
          },
        });
      };

      await orchestrator.execute(
        "real-workflow-name",
        ({ resumeState, onEvent }) =>
          createWorkflow("workflow", { maliciousApproval }, { resumeState, onEvent }),
        async (step) => {
          return await step('maliciousApproval', () => maliciousApproval());
        },
        {},
        { runId: "real-run-id" }
      );

      // runId and workflowName should be the real values, not overwritten
      expect(capturedMetadata).toBeDefined();
      expect(capturedMetadata!.runId).toBe("real-run-id");
      expect(capturedMetadata!.workflowName).toBe("real-workflow-name");
      expect(capturedMetadata!.legitimateField).toBe("this is fine");
    });
  });
});

// =============================================================================
// gatedStep Tests (Pre-execution gating)
// =============================================================================

import { gatedStep, type GatedStepOptions } from "../workflow";

describe("gatedStep - Pre-execution gating", () => {
  describe("basic gating", () => {
    it("executes immediately when requiresApproval is false", async () => {
      const operation = vi.fn().mockResolvedValue(ok({ sent: true }));

      const gatedOp = gatedStep(operation, {
        key: "email",
        requiresApproval: false,
        description: "Send email",
      });

      const result = await gatedOp({ to: "test@example.com" });

      expect(result.ok).toBe(true);
      expect(operation).toHaveBeenCalledWith({ to: "test@example.com" });
    });

    it("returns PendingApproval when requiresApproval is true", async () => {
      const operation = vi.fn().mockResolvedValue(ok({ sent: true }));

      const gatedOp = gatedStep(operation, {
        key: "email",
        requiresApproval: true,
        description: "Send email",
      });

      const result = await gatedOp({ to: "external@other.com" });

      expect(result.ok).toBe(false);
      if (!result.ok && isPendingApproval(result.error)) {
        expect(result.error.stepKey).toBe("email");
        expect(result.error.reason).toBe("Send email");
        expect(result.error.metadata?.pendingArgs).toEqual({ to: "external@other.com" });
        expect(result.error.metadata?.gatedOperation).toBe(true);
      }
      expect(operation).not.toHaveBeenCalled();
    });

    it("does not execute operation when gated", async () => {
      const operation = vi.fn().mockResolvedValue(ok({ deleted: true }));

      const gatedOp = gatedStep(operation, {
        key: "delete",
        requiresApproval: true,
        description: "Delete file",
      });

      await gatedOp({ path: "/important/data.json" });

      // Operation should NOT be called - that's the point of gating
      expect(operation).not.toHaveBeenCalled();
    });
  });

  describe("conditional gating with function", () => {
    it("gates based on args when requiresApproval is a function", async () => {
      const operation = vi.fn().mockResolvedValue(ok({ sent: true }));

      const gatedOp = gatedStep(operation, {
        key: "email",
        requiresApproval: (args) => !args.to.endsWith("@mycompany.com"),
        description: (args) => `Send email to ${args.to}`,
      });

      // Internal email - no gating
      const result1 = await gatedOp({ to: "alice@mycompany.com" });
      expect(result1.ok).toBe(true);
      expect(operation).toHaveBeenCalledTimes(1);

      // External email - should gate
      const result2 = await gatedOp({ to: "external@other.com" });
      expect(result2.ok).toBe(false);
      if (!result2.ok && isPendingApproval(result2.error)) {
        expect(result2.error.reason).toBe("Send email to external@other.com");
      }
      expect(operation).toHaveBeenCalledTimes(1); // Still only 1 call
    });

    it("supports async requiresApproval function", async () => {
      const operation = vi.fn().mockResolvedValue(ok({ sent: true }));

      const gatedOp = gatedStep(operation, {
        key: "email",
        requiresApproval: async (args) => {
          // Simulate async check (e.g., database lookup)
          await new Promise((r) => setTimeout(r, 1));
          return args.to.includes("external");
        },
        description: "Send email",
      });

      const result = await gatedOp({ to: "external@other.com" });
      expect(result.ok).toBe(false);
      expect(isPendingApproval(result.ok === false ? result.error : null)).toBe(true);
    });
  });

  describe("dynamic description", () => {
    it("generates description from args", async () => {
      const operation = vi.fn().mockResolvedValue(ok({}));

      const gatedOp = gatedStep(operation, {
        key: "delete",
        requiresApproval: true,
        description: (args) => `Delete file: ${args.path} (${args.reason})`,
      });

      const result = await gatedOp({ path: "/data/users.db", reason: "cleanup" });

      expect(result.ok).toBe(false);
      if (!result.ok && isPendingApproval(result.error)) {
        expect(result.error.reason).toBe("Delete file: /data/users.db (cleanup)");
      }
    });
  });

  describe("with checkApproval", () => {
    it("executes when checkApproval returns approved", async () => {
      const operation = vi.fn().mockResolvedValue(ok({ sent: true }));

      const gatedOp = gatedStep(operation, {
        key: "email",
        requiresApproval: true,
        description: "Send email",
        checkApproval: async () => ({ status: "approved", value: { approvedBy: "admin" } }),
      });

      const result = await gatedOp({ to: "external@other.com" });

      expect(result.ok).toBe(true);
      expect(operation).toHaveBeenCalled();
    });

    it("returns ApprovalRejected when checkApproval returns rejected", async () => {
      const operation = vi.fn().mockResolvedValue(ok({ sent: true }));

      const gatedOp = gatedStep(operation, {
        key: "email",
        requiresApproval: true,
        description: "Send email",
        checkApproval: async () => ({ status: "rejected", reason: "Policy violation" }),
      });

      const result = await gatedOp({ to: "external@other.com" });

      expect(result.ok).toBe(false);
      if (!result.ok && isApprovalRejected(result.error)) {
        expect(result.error.stepKey).toBe("email");
        expect(result.error.reason).toBe("Policy violation");
      }
      expect(operation).not.toHaveBeenCalled();
    });

    it("returns PendingApproval when checkApproval returns pending", async () => {
      const operation = vi.fn().mockResolvedValue(ok({ sent: true }));

      const gatedOp = gatedStep(operation, {
        key: "email",
        requiresApproval: true,
        description: "Send email",
        checkApproval: async () => ({ status: "pending" }),
      });

      const result = await gatedOp({ to: "external@other.com" });

      expect(result.ok).toBe(false);
      expect(isPendingApproval(result.ok === false ? result.error : null)).toBe(true);
      expect(operation).not.toHaveBeenCalled();
    });
  });

  describe("metadata", () => {
    it("includes custom metadata in PendingApproval", async () => {
      const operation = vi.fn().mockResolvedValue(ok({}));

      const gatedOp = gatedStep(operation, {
        key: "payment",
        requiresApproval: true,
        description: "Process payment",
        metadata: { priority: "high", department: "finance" },
      });

      const result = await gatedOp({ amount: 10000 });

      expect(result.ok).toBe(false);
      if (!result.ok && isPendingApproval(result.error)) {
        expect(result.error.metadata?.priority).toBe("high");
        expect(result.error.metadata?.department).toBe("finance");
        expect(result.error.metadata?.pendingArgs).toEqual({ amount: 10000 });
      }
    });
  });

  describe("workflow integration", () => {
    it("pauses workflow when gatedStep returns PendingApproval", async () => {
      const sendEmail = vi.fn().mockImplementation(async (args: { to: string; body: string }) =>
        ok({ messageId: "123" })
      );

      const gatedSendEmail = gatedStep(sendEmail, {
        key: "email-approval",
        requiresApproval: (args) => !args.to.endsWith("@internal.com"),
        description: (args) => `Send email to ${args.to}`,
      });

      const workflow = createWorkflow("workflow", { gatedSendEmail });

      const result = await workflow(async (step) => {
        return await step(
          'gatedSendEmail',
          () => gatedSendEmail({ to: "external@other.com", body: "Hello" })
        );
      });

      expect(result.ok).toBe(false);
      if (!result.ok && isPendingApproval(result.error)) {
        expect(result.error.stepKey).toBe("email-approval");
        expect(result.error.metadata?.pendingArgs).toEqual({
          to: "external@other.com",
          body: "Hello",
        });
      }
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it("executes operation in workflow when not gated", async () => {
      const sendEmail = vi.fn().mockImplementation(async (args: { to: string }) =>
        ok({ messageId: "123" })
      );

      const gatedSendEmail = gatedStep(sendEmail, {
        key: "email-approval",
        requiresApproval: (args) => !args.to.endsWith("@internal.com"),
        description: "Send email",
      });

      const workflow = createWorkflow("workflow", { gatedSendEmail });

      const result = await workflow(async (step) => {
        return await step(
          'gatedSendEmail',
          () => gatedSendEmail({ to: "alice@internal.com" })
        );
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ messageId: "123" });
      }
      expect(sendEmail).toHaveBeenCalledWith({ to: "alice@internal.com" });
    });
  });
});

// =============================================================================
// Retry and Timeout Tests
// =============================================================================

