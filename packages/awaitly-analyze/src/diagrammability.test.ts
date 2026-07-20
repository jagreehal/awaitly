import { describe, it, expect } from "vitest";
import { computeDiagrammability, formatDiagrammability } from "./diagrammability";
import { analyzeWorkflowSource } from "./static-analyzer";
import type { StaticFlowNode, StaticWorkflowIR } from "./types";

function makeIR(children: StaticFlowNode[]): StaticWorkflowIR {
  return {
    root: {
      type: "workflow",
      id: "root",
      workflowName: "testWorkflow",
      dependencies: [],
      errorTypes: [],
      children,
    },
    metadata: {
      analyzedAt: 0,
      filePath: "test.ts",
      warnings: [],
      stats: {
        totalSteps: 0,
        conditionalCount: 0,
        parallelCount: 0,
        raceCount: 0,
        loopCount: 0,
        workflowRefCount: 0,
        unknownCount: 0,
      },
    },
    references: new Map(),
  };
}

const step = (id: string, stepId: string): StaticFlowNode =>
  ({ type: "step", id, stepId, name: stepId }) as StaticFlowNode;

describe("computeDiagrammability", () => {
  it("reports a fully deterministic workflow as diagrammable (100)", () => {
    const ir = makeIR([
      step("s1", "fetchUser"),
      {
        type: "decision",
        id: "d1",
        decisionId: "is-admin",
        conditionLabel: "user.role === 'admin'",
        condition: "user.role === 'admin'",
        consequent: [step("s2", "grantAccess")],
      } as StaticFlowNode,
      {
        type: "loop",
        id: "l1",
        loopType: "step.forEach",
        loopId: "process-items",
        body: [step("s3", "processItem")],
        boundKnown: true,
        boundCount: 3,
      } as StaticFlowNode,
    ]);

    const report = computeDiagrammability(ir);
    expect(report.deterministic).toBe(true);
    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);
  });

  it("flags a dynamic step id", () => {
    const ir = makeIR([step("s1", "fetchUser"), step("s2", "<dynamic>")]);
    const report = computeDiagrammability(ir);
    expect(report.deterministic).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].kind).toBe("dynamic-step-id");
    expect(report.score).toBe(50); // 1 of 2 nodes clean
  });

  it("flags a raw if/else that contains steps", () => {
    const ir = makeIR([
      {
        type: "conditional",
        id: "c1",
        condition: "user.premium",
        helper: null,
        consequent: [step("s1", "sendPremiumEmail")],
      } as StaticFlowNode,
    ]);
    const report = computeDiagrammability(ir);
    expect(report.issues.map((i) => i.kind)).toContain("raw-conditional");
  });

  it("does NOT flag when()/unless() helpers (first-class, analyzable)", () => {
    const ir = makeIR([
      {
        type: "conditional",
        id: "c1",
        condition: "user.premium",
        helper: "when",
        consequent: [step("s1", "sendPremiumEmail")],
      } as StaticFlowNode,
    ]);
    const report = computeDiagrammability(ir);
    expect(report.deterministic).toBe(true);
  });

  it("flags a native loop that contains steps", () => {
    const ir = makeIR([
      {
        type: "loop",
        id: "l1",
        loopType: "for-of",
        iterSource: "items",
        body: [step("s1", "processItem")],
        boundKnown: false,
      } as StaticFlowNode,
    ]);
    const report = computeDiagrammability(ir);
    expect(report.issues.map((i) => i.kind)).toContain("raw-loop");
  });

  it("flags an unbounded step.forEach", () => {
    const ir = makeIR([
      {
        type: "loop",
        id: "l1",
        loopType: "step.forEach",
        loopId: "process",
        body: [step("s1", "processItem")],
        boundKnown: false,
      } as StaticFlowNode,
    ]);
    const report = computeDiagrammability(ir);
    expect(report.issues.map((i) => i.kind)).toContain("unbounded-loop");
  });

  it("flags an unknown node", () => {
    const ir = makeIR([
      { type: "unknown", id: "u1", reason: "unsupported expression" } as StaticFlowNode,
    ]);
    const report = computeDiagrammability(ir);
    expect(report.issues.map((i) => i.kind)).toContain("unknown-node");
  });

  it("every issue names a fix", () => {
    const ir = makeIR([step("s1", "<dynamic>")]);
    const report = computeDiagrammability(ir);
    expect(report.issues[0].suggestion.length).toBeGreaterThan(0);
  });

  it("formats a passing report as a single line", () => {
    const ir = makeIR([step("s1", "fetchUser")]);
    expect(formatDiagrammability(computeDiagrammability(ir))).toContain("Fully diagrammable");
  });
});

describe("computeDiagrammability (integration)", () => {
  it("flags a raw if/else in real analyzed source", () => {
    const source = `
      import { createWorkflow } from "awaitly";

      const wf = createWorkflow("wf");

      export async function runIt(premium: boolean) {
        return await wf.run(async ({ step }) => {
          const user = await step("fetchUser", () => fetchUser());
          if (premium) {
            await step("sendPremiumEmail", () => sendEmail(user));
          }
          return user;
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    expect(results.length).toBeGreaterThan(0);
    const report = computeDiagrammability(results[0]);
    expect(report.deterministic).toBe(false);
    expect(report.issues.map((i) => i.kind)).toContain("raw-conditional");
  });
});
