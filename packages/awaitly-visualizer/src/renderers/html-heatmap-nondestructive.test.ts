import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML heatmap styling", () => {
  it("does not remove existing node state classes when applying heatmap", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost",
      interactive: true,
      timeTravel: false,
      heatmap: true,
    });

    expect(script).not.toContain("node.className = node.className.replace(/wv-node--\\w+/g, '')");
  });
});
