import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML client error handling", () => {
  it("keeps falsy errors by checking undefined instead of truthiness", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost",
      interactive: true,
      timeTravel: true,
      heatmap: false,
    });

    expect(script).toContain("node.error !== undefined");
  });
});
