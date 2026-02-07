/**
 * Raw event capture fidelity tests.
 *
 * Verifies that every event type is emitted and stored correctly
 * when running the kitchen-sink processOrder workflow.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { WorkflowEvent } from "awaitly/workflow";
import type { CollectableEvent } from "../index";
import {
  runProcessOrder,
  runProcessOrderError,
  resetChargeCardAttempt,
} from "./kitchen-sink-workflow";

describe("kitchen-sink: raw event capture", () => {
  let workflowEvents: WorkflowEvent<unknown>[];
  let decisionEvents: CollectableEvent[];

  beforeEach(() => {
    resetChargeCardAttempt();
    workflowEvents = [];
    decisionEvents = [];
  });

  async function runHappyPath(overrides: { singleItem?: boolean; paymentMethod?: string } = {}) {
    const { result } = await runProcessOrder(
      overrides,
      {
        onEvent: (e) => workflowEvents.push(e),
        onDecisionEvent: (e) => decisionEvents.push(e),
      }
    );
    return result;
  }

  // =========================================================================
  // Happy Path Event Capture
  // =========================================================================

  describe("happy path", () => {
    it("workflow_start is first event and workflow_success is last", async () => {
      await runHappyPath();

      expect(workflowEvents.length).toBeGreaterThan(0);
      expect(workflowEvents[0].type).toBe("workflow_start");
      expect(workflowEvents[workflowEvents.length - 1].type).toBe("workflow_success");
    });

    it("every step_start has a matching step_success or step_error", async () => {
      await runHappyPath();

      const starts = workflowEvents.filter((e) => e.type === "step_start");
      for (const start of starts) {
        if (start.type !== "step_start") continue;
        const matchEnd = workflowEvents.find(
          (e) =>
            (e.type === "step_success" || e.type === "step_error") &&
            "stepId" in e &&
            e.stepId === start.stepId
        );
        expect(matchEnd, `No end event for stepId ${start.stepId}`).toBeDefined();
      }
    });

    it("scope_start/scope_end paired by scopeId for parallel ops", async () => {
      await runHappyPath();

      const scopeStarts = workflowEvents.filter((e) => e.type === "scope_start");
      const scopeEnds = workflowEvents.filter((e) => e.type === "scope_end");

      expect(scopeStarts.length).toBeGreaterThanOrEqual(2); // validateOrder + sendNotifications
      for (const start of scopeStarts) {
        if (start.type !== "scope_start") continue;
        const end = scopeEnds.find(
          (e) => e.type === "scope_end" && e.scopeId === start.scopeId
        );
        expect(end, `No scope_end for scopeId ${start.scopeId}`).toBeDefined();
      }
    });

    it("scope_start(parallel) emitted for validateOrder", async () => {
      await runHappyPath();

      const parallelScopes = workflowEvents.filter(
        (e) => e.type === "scope_start" && e.scopeType === "parallel"
      );
      expect(parallelScopes.length).toBeGreaterThanOrEqual(2);
      const names = parallelScopes.map((e) =>
        e.type === "scope_start" ? e.name : undefined
      );
      expect(names).toContain("validateOrder");
      expect(names).toContain("sendNotifications");
    });

    it("scope_start(race) emitted for shippingEstimate", async () => {
      await runHappyPath();

      const raceScopes = workflowEvents.filter(
        (e) => e.type === "scope_start" && e.scopeType === "race"
      );
      expect(raceScopes.length).toBeGreaterThanOrEqual(1);
      const names = raceScopes.map((e) =>
        e.type === "scope_start" ? e.name : undefined
      );
      expect(names).toContain("shippingEstimate");
    });

    it("step_retry appears for chargeCard before eventual step_success", async () => {
      await runHappyPath();

      const retries = workflowEvents.filter(
        (e) => e.type === "step_retry" && "stepId" in e && e.stepId === "chargeCard"
      );
      expect(retries.length).toBeGreaterThanOrEqual(1);

      // Verify step_success comes after the retry
      const retryIndex = workflowEvents.findIndex(
        (e) => e.type === "step_retry" && "stepId" in e && e.stepId === "chargeCard"
      );
      const successIndex = workflowEvents.findIndex(
        (e) => e.type === "step_success" && "stepId" in e && e.stepId === "chargeCard"
      );
      expect(successIndex).toBeGreaterThan(retryIndex);
    });

    it("decision events captured for trackIf (isPremium)", async () => {
      await runHappyPath();

      const starts = decisionEvents.filter((e) => e.type === "decision_start");
      const branches = decisionEvents.filter((e) => e.type === "decision_branch");
      const ends = decisionEvents.filter((e) => e.type === "decision_end");

      // isPremium + paymentMethod = 2 decisions
      expect(starts.length).toBeGreaterThanOrEqual(2);
      expect(ends.length).toBeGreaterThanOrEqual(2);

      // isPremium decision should have "if" and "else" branches
      const isPremiumBranches = branches.filter(
        (e) => e.type === "decision_branch" && e.decisionId === "isPremium"
      );
      expect(isPremiumBranches.length).toBe(2);
      const labels = isPremiumBranches.map(
        (e) => e.type === "decision_branch" && e.branchLabel
      );
      expect(labels).toContain("if");
      expect(labels).toContain("else");
    });

    it("decision events captured for trackSwitch (paymentMethod)", async () => {
      await runHappyPath();

      const switchBranches = decisionEvents.filter(
        (e) => e.type === "decision_branch" && e.decisionId === "paymentMethod"
      );
      // card, wallet, crypto
      expect(switchBranches.length).toBe(3);
    });

    it("step_skipped emitted when conditional is false (single item cart)", async () => {
      await runHappyPath({ singleItem: true });

      const skipped = workflowEvents.filter((e) => e.type === "step_skipped");
      expect(skipped.length).toBeGreaterThanOrEqual(1);
      const skippedNames = skipped.map((e) =>
        e.type === "step_skipped" ? e.name : undefined
      );
      expect(skippedNames).toContain("bundleDiscount");
    });

    it("all events share the same workflowId", async () => {
      await runHappyPath();

      const ids = new Set(workflowEvents.map((e) => e.workflowId));
      expect(ids.size).toBe(1);
    });

    it("timestamps are monotonically non-decreasing", async () => {
      await runHappyPath();

      for (let i = 1; i < workflowEvents.length; i++) {
        expect(workflowEvents[i].ts).toBeGreaterThanOrEqual(
          workflowEvents[i - 1].ts
        );
      }
    });

    it("event sequence is deterministic across runs", async () => {
      await runHappyPath();
      const types1 = workflowEvents.map((e) => e.type);

      // Reset and run again
      workflowEvents = [];
      resetChargeCardAttempt();
      await runHappyPath();
      const types2 = workflowEvents.map((e) => e.type);

      expect(types1).toEqual(types2);
    });
  });

  // =========================================================================
  // Error Path Event Capture
  // =========================================================================

  describe("error path", () => {
    it("workflow_error emitted with error field for error path", async () => {
      const { result } = await runProcessOrderError({
        onEvent: (e) => workflowEvents.push(e),
      });

      expect(result.ok).toBe(false);

      const errorEvent = workflowEvents.find((e) => e.type === "workflow_error");
      expect(errorEvent).toBeDefined();
      if (errorEvent?.type === "workflow_error") {
        expect(errorEvent.error).toBeDefined();
      }
    });

    it("step_error emitted for failing step", async () => {
      await runProcessOrderError({
        onEvent: (e) => workflowEvents.push(e),
      });

      const stepError = workflowEvents.find((e) => e.type === "step_error");
      expect(stepError).toBeDefined();
      if (stepError?.type === "step_error") {
        expect(stepError.error).toBe("CART_NOT_FOUND");
      }
    });

    it("workflow_start still first event on error path", async () => {
      await runProcessOrderError({
        onEvent: (e) => workflowEvents.push(e),
      });

      expect(workflowEvents[0].type).toBe("workflow_start");
    });

    it("workflow_error is last event on error path", async () => {
      await runProcessOrderError({
        onEvent: (e) => workflowEvents.push(e),
      });

      expect(workflowEvents[workflowEvents.length - 1].type).toBe("workflow_error");
    });
  });
});
