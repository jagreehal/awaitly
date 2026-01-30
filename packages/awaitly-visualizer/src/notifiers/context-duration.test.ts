import { describe, it, expect } from "vitest";
import { createNotifierContext } from "./context";
import type { WorkflowIR } from "../types";

describe("Notifier context duration", () => {
  it("uses workflow durationMs even when start/end timestamps are missing", () => {
    const ctx = createNotifierContext({ provider: "kroki" });

    const ir: WorkflowIR = {
      root: {
        type: "workflow",
        id: "wf-1",
        workflowId: "wf-1",
        state: "success",
        durationMs: 123,
        children: [],
      },
      metadata: { createdAt: 0, lastUpdatedAt: 0 },
    };

    expect(ctx.formatDuration(ir)).toBe("123ms");
  });
});
