import { describe, expect, it } from "vitest";
import { analyzeWorkflowSource } from "../static-analyzer";
import type { StaticWorkflowIR } from "../types";
import { renderStaticMermaid } from "./mermaid";
import { generateTestMatrix } from "./test-matrix";

describe("output regressions", () => {
  it("uses unique Mermaid subgraph IDs when grouping by domain", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const workflow = createWorkflow("workflow", { a: async () => ok(1), b: async () => ok(2) });
      export async function run() {
        return workflow.run(async ({ step, deps }) => {
          await step("first", () => deps.a(), { domain: "payments-api" });
          await step("second", () => deps.b(), { domain: "payments api" });
          return ok(undefined);
        });
      }
    `;

    const ir = analyzeWorkflowSource(source)[0]!;
    const mermaid = renderStaticMermaid(ir, { groupByDomain: true });
    const domainSubgraphIds = [...mermaid.matchAll(/subgraph\s+(domain_[^[]+)/g)].map(
      (m) => m[1]
    );

    expect(domainSubgraphIds).toHaveLength(2);
    expect(new Set(domainSubgraphIds).size).toBe(2);
  });

  it("does not mark a path low-priority unless all path errors are known retryable infrastructure", () => {
    const paths = [
      {
        id: "path-1",
        description: "guard=true path",
        steps: [
          { nodeId: "step_1", name: "flakyCall", repeated: false },
          { nodeId: "step_2", name: "domainValidation", repeated: false },
        ],
        conditions: [{ expression: "guard", mustBe: true }],
        hasLoops: false,
        hasUnresolvedRefs: false,
      },
    ];

    const ir = {
      root: {
        children: [
          {
            type: "step",
            id: "step_1",
            errorMeta: {
              TRANSIENT: { severity: "infrastructure", retryable: true },
            },
          },
          {
            type: "step",
            id: "step_2",
            errors: ["VALIDATION_FAILED"],
          },
        ],
      },
    } as unknown as StaticWorkflowIR;

    const matrix = generateTestMatrix(paths, {}, ir);
    expect(matrix.paths[0]!.priority).toBe("medium");
  });
});
