import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML client heatmap messaging", () => {
  it("sends heatmap toggle and metric selection messages to the server", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost:1234",
      interactive: true,
      timeTravel: false,
      heatmap: true,
    });

    expect(script).toContain("toggle_heatmap");
    expect(script).toContain("set_heatmap_metric");
  });
});
