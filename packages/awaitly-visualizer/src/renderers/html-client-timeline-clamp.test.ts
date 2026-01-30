import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML client timeline", () => {
  it("clamps slider value to 0 when no snapshot is selected", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost",
      interactive: true,
      timeTravel: true,
      heatmap: false,
    });

    expect(script).toContain("Math.max(0, currentSnapshotIndex)");
  });
});
