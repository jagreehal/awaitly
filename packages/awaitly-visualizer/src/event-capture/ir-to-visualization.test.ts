/**
 * IR -> Visualization format tests.
 *
 * Verifies all 5 renderers (ascii, mermaid, json, logger, flowchart)
 * produce valid output from the kitchen-sink workflow IR.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { WorkflowEvent } from "awaitly/workflow";
import {
  createVisualizer,
  type CollectableEvent,
  type DecisionStartEvent,
  type DecisionBranchEvent,
  type DecisionEndEvent,
  type OutputFormat,
} from "../index";
import { stripAnsi } from "../renderers/colors";
import {
  runProcessOrder,
  runProcessOrderError,
  resetChargeCardAttempt,
} from "./kitchen-sink-workflow";

describe("ir-to-visualization: IR -> Formats", () => {
  beforeEach(() => {
    resetChargeCardAttempt();
  });

  function createVizAndCollect() {
    const viz = createVisualizer({
      workflowName: "processOrder",
      detectParallel: false,
    });

    return {
      viz,
      onEvent: viz.handleEvent as (event: WorkflowEvent<unknown>) => void,
      onDecisionEvent: (e: CollectableEvent) => {
        if (e.type.startsWith("decision_")) {
          viz.handleDecisionEvent(e as DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent);
        }
      },
    };
  }

  // =========================================================================
  // Happy Path - All Formats
  // =========================================================================

  describe("happy path rendering", () => {
    it("ASCII: contains workflow name, step names, success symbols", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrder({}, { onEvent, onDecisionEvent });

      const ascii = viz.renderAs("ascii");
      expect(ascii).toContain("processOrder");
      expect(ascii).toContain("fetchCart");
      expect(ascii).toContain("finalizeOrder");
      expect(ascii).toContain("\u2713"); // checkmark
    });

    it("Mermaid: starts with flowchart TD, has classDef, step names, success classes", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrder({}, { onEvent, onDecisionEvent });

      const mermaid = viz.renderAs("mermaid");
      expect(mermaid).toContain("flowchart TD");
      expect(mermaid).toContain("classDef");
      expect(mermaid).toContain("fetchCart");
      expect(mermaid).toContain(":::success");
    });

    it("JSON: parses to valid WorkflowIR with root.type=workflow", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrder({}, { onEvent, onDecisionEvent });

      const json = viz.renderAs("json");
      const parsed = JSON.parse(json);
      expect(parsed.root.type).toBe("workflow");
      expect(parsed.root.children).toBeInstanceOf(Array);
      expect(parsed.root.children.length).toBeGreaterThan(0);
      expect(parsed.metadata).toBeDefined();
    });

    it("Logger: non-empty, contains step names", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrder({}, { onEvent, onDecisionEvent });

      const logger = viz.renderAs("logger");
      expect(logger.length).toBeGreaterThan(0);
      expect(logger).toContain("fetchCart");
    });

    it("Flowchart: non-empty, contains step names", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrder({}, { onEvent, onDecisionEvent });

      const flowchart = viz.renderAs("flowchart");
      expect(flowchart.length).toBeGreaterThan(0);
      // Flowchart embeds ANSI color codes per-character, so strip them first
      const plain = stripAnsi(flowchart);
      expect(plain).toContain("fetchCart");
    });

    it("all 5 formats produce non-empty output from the same IR", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrder({}, { onEvent, onDecisionEvent });

      const formats: OutputFormat[] = ["ascii", "mermaid", "json", "logger", "flowchart"];
      for (const format of formats) {
        const output = viz.renderAs(format);
        expect(output.length, `${format} output is empty`).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Error Path - All Formats
  // =========================================================================

  describe("error path rendering", () => {
    it("ASCII: renders error indicator for error workflow", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrderError({ onEvent, onDecisionEvent });

      const ascii = viz.renderAs("ascii");
      expect(ascii).toContain("\u2717"); // X mark for error
    });

    it("Mermaid: renders error class for error workflow", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrderError({ onEvent, onDecisionEvent });

      const mermaid = viz.renderAs("mermaid");
      expect(mermaid).toContain(":::error");
    });

    it("JSON: root.state=error for error workflow", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrderError({ onEvent, onDecisionEvent });

      const json = viz.renderAs("json");
      const parsed = JSON.parse(json);
      expect(parsed.root.state).toBe("error");
      expect(parsed.root.error).toBeDefined();
    });

    it("Logger: non-empty for error workflow", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrderError({ onEvent, onDecisionEvent });

      const logger = viz.renderAs("logger");
      expect(logger.length).toBeGreaterThan(0);
    });

    it("Flowchart: non-empty for error workflow", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrderError({ onEvent, onDecisionEvent });

      const flowchart = viz.renderAs("flowchart");
      expect(flowchart.length).toBeGreaterThan(0);
    });

    it("all 5 formats produce non-empty output for error workflow", async () => {
      const { viz, onEvent, onDecisionEvent } = createVizAndCollect();
      await runProcessOrderError({ onEvent, onDecisionEvent });

      const formats: OutputFormat[] = ["ascii", "mermaid", "json", "logger", "flowchart"];
      for (const format of formats) {
        const output = viz.renderAs(format);
        expect(output.length, `${format} output is empty for error path`).toBeGreaterThan(0);
      }
    });
  });
});
