import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML heatmap data shape", () => {
  it("supports Map heat data by using heat.get(nodeId)", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost",
      interactive: true,
      timeTravel: false,
      heatmap: true,
    });

    expect(script).toContain("heat.get(nodeId)");
  });
});
