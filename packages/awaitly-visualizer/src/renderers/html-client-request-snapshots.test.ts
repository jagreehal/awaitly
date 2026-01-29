import { describe, it, expect } from "vitest";
import { generateClientScript } from "./html-client";

describe("HTML client time travel snapshot request", () => {
  it("requests snapshots from the server when time travel is enabled", () => {
    const script = generateClientScript({
      wsUrl: "ws://localhost:1234",
      interactive: true,
      timeTravel: true,
      heatmap: false,
    });

    expect(script).toContain("request_snapshots");
  });
});
