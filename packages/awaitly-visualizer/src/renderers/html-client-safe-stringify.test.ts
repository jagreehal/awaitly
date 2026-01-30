import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML client safe stringify", () => {
  it("uses a safe stringify helper for input/output values", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost",
      interactive: true,
      timeTravel: true,
      heatmap: false,
    });

    expect(script).toContain("safeStringify(");
    expect(script).not.toContain("JSON.stringify(node.input");
    expect(script).not.toContain("JSON.stringify(node.output");
  });
});
