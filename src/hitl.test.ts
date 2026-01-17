/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Tests for hitl.ts - Human-in-the-Loop support
 */
import { describe, it, expect, vi } from "vitest";
import {
  AsyncResult,
  createWorkflow,
  err,
  isErr,
  isOk,
  ok,
  Result,
  ResumeState,
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
  createHITLCollector,
  createStepCollector,
} from "./index";

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

  describe("createHITLCollector()", () => {
    it("collects step_complete events", async () => {
      const collector = createHITLCollector();

      // Simulate step_complete events
      collector.handleEvent({
        type: "step_complete",
        workflowId: "wf-1",
        stepKey: "step:1",
        ts: Date.now(),
        durationMs: 100,
        result: ok("value1"),
      });

      const state = collector.getState();
      expect(state.steps.has("step:1")).toBe(true);
    });

    it("detects pending approvals", async () => {
      const collector = createHITLCollector();

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
      const collector = createHITLCollector();

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
      expect(collector.getState().steps.get("approval:1")!.result.ok).toBe(true);
    });

    it("clear removes all collected state", async () => {
      const collector = createHITLCollector();

      collector.handleEvent({
        type: "step_complete",
        workflowId: "wf-1",
        stepKey: "step:1",
        ts: Date.now(),
        durationMs: 100,
        result: ok("value1"),
      });

      expect(collector.getState().steps.size).toBe(1);
      collector.clear();
      expect(collector.getState().steps.size).toBe(0);
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
      const collector1 = createHITLCollector();
      const workflow1 = createWorkflow(
        { fetchData, requireApproval },
        { onEvent: collector1.handleEvent }
      );

      const result1 = await workflow1(async (step) => {
        const data = await step(() => fetchData("123"), { key: "data:123" });
        const approval = await step(requireApproval, {
          key: "manager-approval",
        });
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
        { fetchData, requireApproval },
        { resumeState }
      );

      const result2 = await workflow2(async (step) => {
        const data = await step(() => fetchData("123"), { key: "data:123" });
        const approval = await step(requireApproval, {
          key: "manager-approval",
        });
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

      const workflow = createWorkflow({ requireApproval });

      const result = await workflow(async (step) => {
        return await step(requireApproval, { key: "manager-approval" });
      });

      expect(result.ok).toBe(false);
      if (!result.ok && isApprovalRejected(result.error)) {
        expect(result.error.reason).toBe("Insufficient budget");
      }
    });
  });
});

// =============================================================================
// Retry and Timeout Tests
// =============================================================================

