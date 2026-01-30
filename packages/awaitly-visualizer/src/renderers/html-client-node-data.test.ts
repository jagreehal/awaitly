import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML client node data", () => {
  it("includes input/output in live buildWorkflowDataFromIR", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost",
      interactive: true,
      timeTravel: true,
      heatmap: false,
    });

    expect(script).toContain("input:");
    expect(script).toContain("output:");
  });

  it("includes decision and stream fields in live buildWorkflowDataFromIR", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost",
      interactive: true,
      timeTravel: true,
      heatmap: false,
    });

    expect(script).toContain("decisionValue:");
    expect(script).toContain("namespace:");
  });
});
