import { describe, it, expect } from "vitest";
import { renderPathsMermaid, renderStaticMermaid } from "./mermaid";

describe("renderPathsMermaid", () => {
  it("should not merge distinct steps that share the same name", () => {
    const mermaid = renderPathsMermaid([
      {
        id: "path-1",
        steps: [
          { name: "Fetch", nodeId: "step-1" },
          { name: "Process", nodeId: "step-2" },
        ],
        conditions: [],
      },
      {
        id: "path-2",
        steps: [
          { name: "Fetch", nodeId: "step-3" },
          { name: "Finalize", nodeId: "step-4" },
        ],
        conditions: [],
      },
    ]);

    const stepNodeLines = mermaid
      .split("\n")
      .filter((line) => line.includes("[Fetch]"));

    expect(stepNodeLines.length).toBe(2);
  });
});

describe("renderStaticMermaid", () => {
  it("should include parallel node names in labels", () => {
    const mermaid = renderStaticMermaid({
      root: {
        id: "workflow-1",
        type: "workflow",
        workflowName: "testWorkflow",
        source: "createWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "parallel-1",
            type: "parallel",
            name: "Fetch all",
            mode: "all",
            children: [
              { id: "step-1", type: "step", name: "fetchPosts" },
            ],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "<source>",
        warnings: [],
        stats: {
          totalSteps: 1,
          conditionalCount: 0,
          parallelCount: 1,
          raceCount: 0,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    });

    expect(mermaid).toContain("Fetch all");
  });

  it("should include race node names in labels", () => {
    const mermaid = renderStaticMermaid({
      root: {
        id: "workflow-1",
        type: "workflow",
        workflowName: "testWorkflow",
        source: "createWorkflow",
        dependencies: [],
        errorTypes: [],
        children: [
          {
            id: "race-1",
            type: "race",
            name: "Fastest source",
            children: [
              { id: "step-1", type: "step", name: "cache" },
              { id: "step-2", type: "step", name: "db" },
            ],
          },
        ],
      },
      metadata: {
        analyzedAt: Date.now(),
        filePath: "<source>",
        warnings: [],
        stats: {
          totalSteps: 2,
          conditionalCount: 0,
          parallelCount: 0,
          raceCount: 1,
          loopCount: 0,
          workflowRefCount: 0,
          unknownCount: 0,
        },
      },
      references: new Map(),
    });

    expect(mermaid).toContain("Fastest source");
  });
});
