import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { HTMLRenderOptions, WorkflowIR } from "../types";

describe("htmlRenderer showKeys", () => {
  it("includes step keys in SVG labels when showKeys is enabled", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        children: [
          {
            type: "step",
            id: "step-1",
            name: "Load data",
            key: "load-key",
            state: "success",
            durationMs: 10,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, {
      showKeys: true,
    } as HTMLRenderOptions);

    // Expect the SVG label to include the key (not just in embedded JSON)
    expect(html).toMatch(/<text[^>]*>[^<]*load-key[^<]*<\/text>/);
  });
});
