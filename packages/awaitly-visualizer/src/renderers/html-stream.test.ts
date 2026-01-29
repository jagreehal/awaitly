import { describe, it, expect } from "vitest";
import { renderToHTML } from "./html";
import type { WorkflowIR } from "../types";

describe("renderToHTML stream", () => {
  it("renders stream namespace label", () => {
    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        startTs: 0,
        endTs: 1,
        children: [
          {
            type: "stream",
            id: "stream-1",
            namespace: "orders",
            state: "success",
            startTs: 0,
            endTs: 1,
            durationMs: 1,
            writeCount: 2,
            readCount: 1,
            finalPosition: 2,
            streamState: "closed",
            backpressureOccurred: false,
          },
        ],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    const html = renderToHTML(ir, { showTimings: false });

    expect(html).toContain("stream:orders");
  });
});
