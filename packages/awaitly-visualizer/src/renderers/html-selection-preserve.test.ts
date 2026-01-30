import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML selection preservation", () => {
  it("re-applies selected class after renderIR updates", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost",
      interactive: true,
      timeTravel: false,
      heatmap: false,
    });

    expect(script).toContain("selectNode(selectedNodeId)");
  });
});
