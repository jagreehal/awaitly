/**
 * Flowchart Renderer Tests
 */

import { describe, it, expect } from "vitest";
import { flowchartRenderer } from "./flowchart";
import type { WorkflowIR, StepNode, ParallelNode, DecisionNode } from "../types";

function createMockIR(children: (StepNode | ParallelNode | DecisionNode)[]): WorkflowIR {
  return {
    root: {
      id: "root",
      type: "workflow",
      workflowId: "test-workflow",
      name: "test-workflow",
      state: "success",
      children,
      durationMs: 100,
    },
    metadata: {
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    },
  };
}

function createStepNode(name: string, state: StepNode["state"] = "success"): StepNode {
  return {
    type: "step",
    id: `step-${name}`,
    name,
    state,
    durationMs: 50,
  };
}

describe("flowchartRenderer", () => {
  const renderer = flowchartRenderer();
  const defaultOptions = {
    showTimings: true,
    showKeys: false,
    terminalWidth: 60,
    colors: {
      pending: "",
      running: "",
      success: "",
      error: "",
      aborted: "",
      cached: "",
      skipped: "",
    },
  };

  it("should render a single step workflow", () => {
    const ir = createMockIR([createStepNode("Fetch user")]);
    const output = renderer.render(ir, defaultOptions);

    expect(output).toContain("Start");
    expect(output).toContain("Fetch user");
    expect(output).toContain("Done");
    expect(output).toContain("┌");
    expect(output).toContain("┘");
  });

  it("should render sequential steps", () => {
    const ir = createMockIR([
      createStepNode("Step 1"),
      createStepNode("Step 2"),
      createStepNode("Step 3"),
    ]);
    const output = renderer.render(ir, defaultOptions);

    expect(output).toContain("Step 1");
    expect(output).toContain("Step 2");
    expect(output).toContain("Step 3");
    // Should have arrows between steps
    expect(output).toContain("▼");
  });

  it("should render parallel operations", () => {
    const ir = createMockIR([
      {
        type: "parallel",
        id: "parallel-1",
        name: "parallel",
        state: "success",
        mode: "all",
        children: [
          createStepNode("Validate"),
          createStepNode("Process"),
        ],
      } as ParallelNode,
    ]);
    const output = renderer.render(ir, defaultOptions);

    expect(output).toContain("parallel");
    expect(output).toContain("Validate");
    expect(output).toContain("Process");
  });

  it("should render decision nodes", () => {
    const ir = createMockIR([
      {
        type: "decision",
        id: "decision-1",
        name: "check role",
        condition: "role === admin",
        state: "success",
        branchTaken: "if",
        branches: [
          {
            label: "if",
            condition: "role === admin",
            taken: true,
            children: [createStepNode("Admin action")],
          },
          {
            label: "else",
            taken: false,
            children: [],
          },
        ],
      } as DecisionNode,
    ]);
    const output = renderer.render(ir, defaultOptions);

    expect(output).toContain("check role");
    expect(output).toContain("Admin action");
    // Should have diamond symbol for decisions
    expect(output).toContain("◇");
  });

  it("should show timing information when enabled", () => {
    const ir = createMockIR([createStepNode("Fetch")]);
    const output = renderer.render(ir, { ...defaultOptions, showTimings: true });

    expect(output).toContain("[50ms]");
  });

  it("should hide timing when disabled", () => {
    const ir = createMockIR([createStepNode("Fetch")]);
    const output = renderer.render(ir, { ...defaultOptions, showTimings: false });

    expect(output).not.toContain("[50ms]");
  });

  it("should respect showStartEnd option", () => {
    const ir = createMockIR([createStepNode("Step")]);

    const withStartEnd = renderer.render(ir, {
      ...defaultOptions,
      showStartEnd: true,
    });
    expect(withStartEnd).toContain("Start");
    expect(withStartEnd).toContain("Done");

    const withoutStartEnd = renderer.render(ir, {
      ...defaultOptions,
      showStartEnd: false,
    });
    expect(withoutStartEnd).not.toContain("▶ Start");
    expect(withoutStartEnd).not.toContain("✓ Done");
  });

  it("should render error state correctly", () => {
    const ir = createMockIR([createStepNode("Failed step", "error")]);
    ir.root.state = "error";
    const output = renderer.render(ir, defaultOptions);

    expect(output).toContain("✗");
    expect(output).toContain("Failed");
  });

  it("should render boxes with proper box-drawing characters", () => {
    const ir = createMockIR([createStepNode("Test")]);
    const output = renderer.render(ir, defaultOptions);

    // Check for box corners
    expect(output).toContain("┌");
    expect(output).toContain("┐");
    expect(output).toContain("└");
    expect(output).toContain("┘");
    // Check for box sides
    expect(output).toContain("│");
    expect(output).toContain("─");
  });

  it("should use success symbol for successful steps", () => {
    const ir = createMockIR([createStepNode("Success step", "success")]);
    const output = renderer.render(ir, defaultOptions);

    expect(output).toContain("✓");
  });

  it("should use running symbol for running steps", () => {
    const ir = createMockIR([createStepNode("Running step", "running")]);
    ir.root.state = "running";
    const output = renderer.render(ir, defaultOptions);

    expect(output).toContain("⟳");
  });
});

describe("flowchartRenderer integration with logger", () => {
  it("should be usable as logger diagram format", async () => {
    // Import dynamically to test the integration
    const { loggerRenderer } = await import("./logger");
    const logger = loggerRenderer();

    const ir = createMockIR([createStepNode("Test step")]);
    const output = logger.render(ir, {
      ...{
        showTimings: true,
        showKeys: false,
        terminalWidth: 60,
        colors: {
          pending: "",
          running: "",
          success: "",
          error: "",
          aborted: "",
          cached: "",
          skipped: "",
        },
      },
      diagramFormat: "flowchart",
      includeDiagram: true,
      stripAnsiColors: true,
    });

    const parsed = JSON.parse(output);
    expect(parsed.diagram).toContain("┌");
    expect(parsed.diagram).toContain("Test step");
    expect(parsed.diagram).toContain("Start");
  });
});
