import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;

function getNodePosition(html: string, id: string): { x: number; y: number } {
  const re = new RegExp(
    `data-node-id="${id}"[^>]*transform="translate\\(([-\\d.]+),\\s*([-\\d.]+)\\)"`,
    "i"
  );
  const match = html.match(re);
  if (!match) {
    throw new Error(`Node ${id} not found`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

describe("renderToHTML decision sequencing", () => {
  it("connects sequential steps within a decision branch", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-decision",
        workflowId: "wf-decision",
        state: "success",
        children: [
          {
            type: "decision",
            id: "decision-1",
            state: "success",
            branches: [
              {
                label: "if",
                taken: true,
                children: [
                  { type: "step", id: "step-1", name: "first", state: "success" },
                  { type: "step", id: "step-2", name: "second", state: "success" },
                ],
              },
            ],
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { showTimings: false });

    const step1 = getNodePosition(html, "step-1");
    const step2 = getNodePosition(html, "step-2");

    const x1 = step1.x + NODE_WIDTH;
    const y1 = step1.y + NODE_HEIGHT / 2;
    const x2 = step2.x;
    const y2 = step2.y + NODE_HEIGHT / 2;

    // Expected edge between step-1 and step-2 (horizontal)
    const expected = `M ${x1} ${y1} L ${x2 - 8} ${y2}`;

    expect(html).toContain(expected);
  });
});
