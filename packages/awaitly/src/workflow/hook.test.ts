/**
 * Tests for hook primitive: pendingHook, createHook, injectHook, guards.
 */
import { describe, it, expect } from "vitest";
import { err, ok } from "../core";
import { createWorkflow, createResumeStateCollector } from "../workflow";
import type { ResumeState } from "../workflow";
import {
  pendingHook,
  createHook,
  isPendingHook,
  injectHook,
  hasPendingHook,
  getPendingHooks,
  pendingApproval,
} from "../workflow";

describe("hook primitive", () => {
  describe("pendingHook()", () => {
    it("returns Err with type PENDING_HOOK, hookId, and stepKey hook:${hookId}", () => {
      const hookId = "my-hook-123";
      const result = pendingHook(hookId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe("PENDING_HOOK");
        expect(result.error.hookId).toBe(hookId);
        expect(result.error.stepKey).toBe("hook:" + hookId);
      }
    });

    it("includes optional metadata", () => {
      const result = pendingHook("h1", { metadata: { source: "test" } });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.metadata).toEqual({ source: "test" });
      }
    });
  });

  describe("isPendingHook()", () => {
    it("returns true for PendingHook errors", () => {
      const result = pendingHook("h1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(isPendingHook(result.error)).toBe(true);
    });

    it("returns false for PendingApproval and other errors", () => {
      const approval = pendingApproval("approval:1");
      expect(approval.ok).toBe(false);
      if (!approval.ok) expect(isPendingHook(approval.error)).toBe(false);
      expect(isPendingHook({ type: "OTHER" })).toBe(false);
      expect(isPendingHook(null)).toBe(false);
      expect(isPendingHook("string")).toBe(false);
    });
  });

  describe("injectHook()", () => {
    it("returns new state with step hook:${hookId} set to ok(value)", () => {
      const state: ResumeState = { steps: new Map() };
      const updated = injectHook(state, { hookId: "h1", value: { paid: true } });
      expect(updated.steps.get("hook:h1")).toBeDefined();
      expect(updated.steps.get("hook:h1")!.result.ok).toBe(true);
      if (updated.steps.get("hook:h1")!.result.ok) {
        expect(updated.steps.get("hook:h1")!.result.value).toEqual({ paid: true });
      }
    });

    it("does not mutate input state", () => {
      const state: ResumeState = { steps: new Map() };
      const updated = injectHook(state, { hookId: "h1", value: 42 });
      expect(state.steps.size).toBe(0);
      expect(updated.steps.size).toBe(1);
    });
  });

  describe("hasPendingHook()", () => {
    it("returns true when state has step hook:${hookId} with PendingHook error", () => {
      const state: ResumeState = {
        steps: new Map([["hook:h1", { result: err({ type: "PENDING_HOOK", hookId: "h1", stepKey: "hook:h1" }) }]]),
      };
      expect(hasPendingHook(state, "h1")).toBe(true);
    });

    it("returns false when step has ok result or different error", () => {
      const stateOk: ResumeState = {
        steps: new Map([["hook:h1", { result: ok(42) }]]),
      };
      expect(hasPendingHook(stateOk, "h1")).toBe(false);
      const stateOther: ResumeState = {
        steps: new Map([["hook:h1", { result: err("OTHER") }]]),
      };
      expect(hasPendingHook(stateOther, "h1")).toBe(false);
    });
  });

  describe("getPendingHooks()", () => {
    it("returns array of hookIds that are pending", () => {
      const state: ResumeState = {
        steps: new Map([
          ["hook:h1", { result: err({ type: "PENDING_HOOK", hookId: "h1", stepKey: "hook:h1" }) }],
          ["hook:h2", { result: err({ type: "PENDING_HOOK", hookId: "h2", stepKey: "hook:h2" }) }],
          ["other", { result: ok(1) }],
        ]),
      };
      const ids = getPendingHooks(state);
      expect(ids).toContain("h1");
      expect(ids).toContain("h2");
      expect(ids).toHaveLength(2);
    });

    it("returns empty array when no pending hooks", () => {
      const state: ResumeState = { steps: new Map([["a", { result: ok(1) }]]) };
      expect(getPendingHooks(state)).toEqual([]);
    });
  });

  describe("createHook()", () => {
    it("returns hookId and stepKey with stepKey === hook:${hookId}", () => {
      const { hookId, stepKey } = createHook();
      expect(typeof hookId).toBe("string");
      expect(hookId.length).toBeGreaterThan(0);
      expect(stepKey).toBe("hook:" + hookId);
    });

    it("generates unique hookIds", () => {
      const a = createHook();
      const b = createHook();
      expect(a.hookId).not.toBe(b.hookId);
    });
  });

  describe("integration: workflow suspend and resume via injectHook", () => {
    it("workflow returns err PendingHook when step returns pendingHook(hookId)", async () => {
      const { hookId, stepKey } = createHook();
      const workflow = createWorkflow("hook-demo", {
        waitForCallback: async () => pendingHook(hookId),
      });
      const result = await workflow(async ({ step, deps: { waitForCallback } }) => {
        const value = await step("wait", () => waitForCallback(), { key: stepKey });
        return value;
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isPendingHook(result.error)).toBe(true);
        if (isPendingHook(result.error)) {
          expect(result.error.hookId).toBe(hookId);
        }
      }
    });

    it("after injectHook, re-run with resumeState completes with injected value", async () => {
      const { hookId, stepKey } = createHook();
      const collector = createResumeStateCollector();
      const workflow = createWorkflow(
        "hook-resume",
        { waitForCallback: async () => pendingHook(hookId) },
        { onEvent: collector.handleEvent }
      );

      const run1 = await workflow(async ({ step, deps: { waitForCallback } }) => {
        return await step("wait", () => waitForCallback(), { key: stepKey });
      });
      expect(run1.ok).toBe(false);
      const state = collector.getResumeState();
      const stateWithHook = injectHook(state, { hookId, value: { callback: "done" } });

      const workflow2 = createWorkflow(
        "hook-resume",
        { waitForCallback: async () => pendingHook(hookId) },
        { resumeState: stateWithHook }
      );
      const run2 = await workflow2(async ({ step, deps: { waitForCallback } }) => {
        return await step("wait", () => waitForCallback(), { key: stepKey });
      });
      expect(run2.ok).toBe(true);
      if (run2.ok) {
        expect(run2.value).toEqual({ callback: "done" });
      }
    });
  });
});
