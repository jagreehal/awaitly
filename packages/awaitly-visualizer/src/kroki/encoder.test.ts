import { describe, it, expect } from "vitest";
import { encodeForKroki, decodeFromKroki } from "./encoder";
import { encodeForMermaidInk } from "./mermaid-ink";

describe("kroki encoder", () => {
  it("roundtrips encoded text in Node environments", () => {
    const text = "flowchart TD\n  A-->B";
    const encoded = encodeForKroki(text);
    const decoded = decodeFromKroki(encoded);

    expect(decoded).toBe(text);
  });

  it("supports mermaid.ink encoding in Node environments", () => {
    const text = "flowchart TD\n  A-->B";
    const encoded = encodeForMermaidInk(text);

    expect(encoded.startsWith("pako:")).toBe(true);
  });
});
