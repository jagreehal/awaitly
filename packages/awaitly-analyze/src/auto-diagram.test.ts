import { describe, it, expect } from "vitest";
import { inferBestDiagramType } from "./auto-diagram";
import type { StaticWorkflowIR } from "./types";

function makeIR(children: unknown[]): StaticWorkflowIR {
  return {
    root: {
      type: "workflow",
      id: "test",
      workflowName: "testWorkflow",
      dependencies: [],
      errorTypes: [],
      children,
    },
  } as unknown as StaticWorkflowIR;
}

describe("inferBestDiagramType", () => {
  // Hard rules: structural nodes that force mermaid

  it("selects mermaid for workflows with parallel nodes", () => {
    const ir = makeIR([
      { type: "step", id: "s1", stepId: "a" },
      { type: "parallel", id: "p1", children: [
        { type: "step", id: "s2", stepId: "b" },
        { type: "step", id: "s3", stepId: "c" },
      ], mode: "all" },
    ]);
    expect(inferBestDiagramType(ir)).toBe("mermaid");
  });

  it("selects mermaid for workflows with race nodes", () => {
    const ir = makeIR([
      { type: "race", id: "r1", children: [
        { type: "step", id: "s1", stepId: "a" },
        { type: "step", id: "s2", stepId: "b" },
      ] },
    ]);
    expect(inferBestDiagramType(ir)).toBe("mermaid");
  });

  it("selects mermaid for workflows with switch nodes", () => {
    const ir = makeIR([
      { type: "switch", id: "sw1", expression: "status", cases: [
        { value: "'active'", isDefault: false, body: [{ type: "step", id: "s1", stepId: "a" }] },
        { isDefault: true, body: [{ type: "step", id: "s2", stepId: "b" }] },
      ] },
    ]);
    expect(inferBestDiagramType(ir)).toBe("mermaid");
  });

  it("selects mermaid for workflows with loop nodes", () => {
    const ir = makeIR([
      { type: "loop", id: "l1", loopType: "forEach", boundKnown: false, body: [
        { type: "step", id: "s1", stepId: "a" },
      ] },
    ]);
    expect(inferBestDiagramType(ir)).toBe("mermaid");
  });

  it("selects mermaid for deeply nested parallel nodes", () => {
    const ir = makeIR([
      { type: "sequence", id: "seq1", children: [
        { type: "step", id: "s1", stepId: "a" },
        { type: "sequence", id: "seq2", children: [
          { type: "parallel", id: "p1", children: [
            { type: "step", id: "s2", stepId: "b" },
          ], mode: "all" },
        ] },
      ] },
    ]);
    expect(inferBestDiagramType(ir)).toBe("mermaid");
  });

  // Saga detection

  it("selects railway for saga workflows", () => {
    const ir = makeIR([
      { type: "saga-step", id: "ss1", name: "reserve", hasCompensation: true },
      { type: "saga-step", id: "ss2", name: "charge", hasCompensation: true },
    ]);
    expect(inferBestDiagramType(ir)).toBe("railway");
  });

  // Soft heuristics: simple linear flows

  it("selects railway for single step workflow", () => {
    const ir = makeIR([
      { type: "step", id: "s1", stepId: "a" },
    ]);
    expect(inferBestDiagramType(ir)).toBe("railway");
  });

  it("selects railway for simple linear sequence", () => {
    const ir = makeIR([
      { type: "step", id: "s1", stepId: "a" },
      { type: "step", id: "s2", stepId: "b" },
      { type: "step", id: "s3", stepId: "c" },
    ]);
    expect(inferBestDiagramType(ir)).toBe("railway");
  });

  it("selects mermaid for workflows with many conditionals", () => {
    // Multiple conditionals increase cyclomatic complexity beyond threshold
    const ir = makeIR([
      { type: "conditional", id: "c1", condition: "a > 1",
        consequent: [{ type: "step", id: "s1", stepId: "a" }],
        alternate: [{ type: "step", id: "s2", stepId: "b" }] },
      { type: "conditional", id: "c2", condition: "b > 2",
        consequent: [{ type: "step", id: "s3", stepId: "c" }],
        alternate: [{ type: "step", id: "s4", stepId: "d" }] },
      { type: "conditional", id: "c3", condition: "c > 3",
        consequent: [{ type: "step", id: "s5", stepId: "e" }],
        alternate: [{ type: "step", id: "s6", stepId: "f" }] },
    ]);
    expect(inferBestDiagramType(ir)).toBe("mermaid");
  });

  it("selects mermaid for a single conditional workflow", () => {
    const ir = makeIR([
      {
        type: "conditional",
        id: "c1",
        condition: "flag",
        consequent: [{ type: "step", id: "s1", stepId: "a" }],
        alternate: [{ type: "step", id: "s2", stepId: "b" }],
      },
    ]);
    expect(inferBestDiagramType(ir)).toBe("mermaid");
  });

  it("selects mermaid when a workflow reference inlines unsupported structure", () => {
    const ir = makeIR([
      {
        type: "workflow-ref",
        id: "ref1",
        workflowName: "nestedWorkflow",
        resolved: true,
        inlinedIR: makeIR([
          {
            type: "parallel",
            id: "p1",
            mode: "all",
            children: [
              { type: "step", id: "s1", stepId: "a" },
              { type: "step", id: "s2", stepId: "b" },
            ],
          },
        ]),
      },
    ]);
    expect(inferBestDiagramType(ir)).toBe("mermaid");
  });

  it("selects railway for empty workflow", () => {
    const ir = makeIR([]);
    expect(inferBestDiagramType(ir)).toBe("railway");
  });
});
