/**
 * Full pipeline tests for createEventCollector and combineEventHandlers.
 *
 * Verifies the collector API surface and the combined handler pipeline
 * using the kitchen-sink workflow.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { WorkflowEvent } from "awaitly/workflow";
import {
  createEventCollector,
  createVisualizer,
  combineEventHandlers,
  visualizeEvents,
  type CollectableEvent,
  type DecisionStartEvent,
  type DecisionBranchEvent,
  type DecisionEndEvent,
} from "../index";
import {
  runProcessOrder,
  resetChargeCardAttempt,
} from "./kitchen-sink-workflow";

describe("collector-pipeline: Full Pipeline", () => {
  beforeEach(() => {
    resetChargeCardAttempt();
  });

  // =========================================================================
  // createEventCollector
  // =========================================================================

  describe("createEventCollector", () => {
    it("collector.getEvents() stores all events", async () => {
      const collector = createEventCollector({
        workflowName: "processOrder",
        detectParallel: false,
      });

      await runProcessOrder(
        {},
        {
          onEvent: collector.handleEvent,
          onDecisionEvent: collector.handleDecisionEvent,
        }
      );

      const events = collector.getEvents();
      expect(events.length).toBeGreaterThan(0);
      // Should have both workflow events and decision events
      const hasWorkflowStart = events.some((e) => e.type === "workflow_start");
      const hasDecisionStart = events.some((e) => e.type === "decision_start");
      expect(hasWorkflowStart).toBe(true);
      expect(hasDecisionStart).toBe(true);
    });

    it("collector.getWorkflowEvents() excludes decision events", async () => {
      const collector = createEventCollector({
        workflowName: "processOrder",
        detectParallel: false,
      });

      await runProcessOrder(
        {},
        {
          onEvent: collector.handleEvent,
          onDecisionEvent: collector.handleDecisionEvent,
        }
      );

      const workflowEvents = collector.getWorkflowEvents();
      const hasDecision = workflowEvents.some((e) =>
        e.type.startsWith("decision_")
      );
      expect(hasDecision).toBe(false);
      expect(workflowEvents.length).toBeGreaterThan(0);
    });

    it("collector.getDecisionEvents() includes only decision_* events", async () => {
      const collector = createEventCollector({
        workflowName: "processOrder",
        detectParallel: false,
      });

      await runProcessOrder(
        {},
        {
          onEvent: collector.handleEvent,
          onDecisionEvent: collector.handleDecisionEvent,
        }
      );

      const decisionEvents = collector.getDecisionEvents();
      for (const e of decisionEvents) {
        expect(e.type).toMatch(/^decision_/);
      }
      expect(decisionEvents.length).toBeGreaterThan(0);
    });

    it("collector.visualize() produces ASCII output", async () => {
      const collector = createEventCollector({
        workflowName: "processOrder",
        detectParallel: false,
      });

      await runProcessOrder(
        {},
        {
          onEvent: collector.handleEvent,
          onDecisionEvent: collector.handleDecisionEvent,
        }
      );

      const output = collector.visualize();
      expect(output).toContain("processOrder");
      expect(output).toContain("fetchCart");
    });

    it("collector.visualizeAs('mermaid') produces mermaid output", async () => {
      const collector = createEventCollector({
        workflowName: "processOrder",
        detectParallel: false,
      });

      await runProcessOrder(
        {},
        {
          onEvent: collector.handleEvent,
          onDecisionEvent: collector.handleDecisionEvent,
        }
      );

      const mermaid = collector.visualizeAs("mermaid");
      expect(mermaid).toContain("flowchart TD");
      expect(mermaid).toContain("fetchCart");
    });

    it("collector.clear() removes all events", async () => {
      const collector = createEventCollector({
        workflowName: "processOrder",
        detectParallel: false,
      });

      await runProcessOrder(
        {},
        {
          onEvent: collector.handleEvent,
          onDecisionEvent: collector.handleDecisionEvent,
        }
      );

      expect(collector.getEvents().length).toBeGreaterThan(0);

      collector.clear();

      expect(collector.getEvents().length).toBe(0);
      expect(collector.getWorkflowEvents().length).toBe(0);
      expect(collector.getDecisionEvents().length).toBe(0);
    });

    it("interleaved decision + workflow events handled correctly", async () => {
      const collector = createEventCollector({
        workflowName: "processOrder",
        detectParallel: false,
      });

      await runProcessOrder(
        {},
        {
          onEvent: collector.handleEvent,
          onDecisionEvent: collector.handleDecisionEvent,
        }
      );

      const all = collector.getEvents();
      const workflow = collector.getWorkflowEvents();
      const decision = collector.getDecisionEvents();

      // Sum of filtered events equals total
      expect(workflow.length + decision.length).toBe(all.length);
    });
  });

  // =========================================================================
  // combineEventHandlers
  // =========================================================================

  describe("combineEventHandlers", () => {
    it("feeds same events to viz and collector simultaneously", async () => {
      const viz = createVisualizer({
        workflowName: "processOrder",
        detectParallel: false,
      });

      const collectedEvents: WorkflowEvent<unknown>[] = [];

      const combined = combineEventHandlers(
        viz.handleEvent,
        (e: WorkflowEvent<unknown>) => collectedEvents.push(e)
      );

      await runProcessOrder(
        {},
        {
          onEvent: combined,
        }
      );

      // Both should have received events
      const ir = viz.getIR();
      expect(ir.root.state).toBe("success");
      expect(ir.root.children.length).toBeGreaterThan(0);
      expect(collectedEvents.length).toBeGreaterThan(0);
      expect(collectedEvents[0].type).toBe("workflow_start");
    });
  });

  // =========================================================================
  // visualizeEvents
  // =========================================================================

  describe("visualizeEvents", () => {
    it("produces same output as collector.visualize()", async () => {
      const collector = createEventCollector({
        workflowName: "processOrder",
        detectParallel: false,
      });

      await runProcessOrder(
        {},
        {
          onEvent: collector.handleEvent,
          onDecisionEvent: collector.handleDecisionEvent,
        }
      );

      const collectorOutput = collector.visualize();
      const directOutput = visualizeEvents(collector.getEvents(), {
        workflowName: "processOrder",
        detectParallel: false,
      });

      expect(collectorOutput).toBe(directOutput);
    });
  });
});
