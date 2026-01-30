/**
 * Mermaid.ink URL Generation Tests
 */

import { describe, it, expect } from "vitest";
import {
  toMermaidInkUrl,
  toMermaidInkSvgUrl,
  toMermaidInkPngUrl,
  toMermaidInkPdfUrl,
  createMermaidInkGenerator,
  encodeForMermaidInk,
  buildMermaidInkUrl,
} from "./kroki/mermaid-ink";
import type { WorkflowIR } from "./types";

const createTestIR = (): WorkflowIR => ({
  version: "1.0",
  root: {
    type: "workflow",
    name: "test-workflow",
    status: "completed",
    startTs: 1000,
    endTs: 2000,
    children: [
      {
        type: "step",
        name: "Step 1",
        key: "step-1",
        status: "completed",
        startTs: 1100,
        endTs: 1500,
        children: [],
      },
    ],
  },
});

describe("encodeForMermaidInk", () => {
  it("prefixes encoding with pako:", () => {
    const encoded = encodeForMermaidInk("flowchart TD\n  A-->B");
    expect(encoded).toMatch(/^pako:/);
  });

  it("produces valid base64url characters", () => {
    const encoded = encodeForMermaidInk("flowchart TD\n  A-->B");
    const payload = encoded.replace(/^pako:/, "");
    // base64url uses only alphanumerics, -, and _
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("buildMermaidInkUrl", () => {
  it("builds SVG URL", () => {
    const url = buildMermaidInkUrl("svg", "flowchart TD\n  A-->B");
    expect(url).toMatch(/^https:\/\/mermaid\.ink\/svg\/pako:/);
  });

  it("builds img URL", () => {
    const url = buildMermaidInkUrl("img", "flowchart TD\n  A-->B");
    expect(url).toMatch(/^https:\/\/mermaid\.ink\/img\/pako:/);
  });

  it("builds PDF URL", () => {
    const url = buildMermaidInkUrl("pdf", "flowchart TD\n  A-->B");
    expect(url).toMatch(/^https:\/\/mermaid\.ink\/pdf\/pako:/);
  });

  it("adds theme parameter", () => {
    const url = buildMermaidInkUrl("svg", "test", { theme: "dark" });
    expect(url).toContain("?theme=dark");
  });

  it("adds bgColor parameter", () => {
    const url = buildMermaidInkUrl("svg", "test", { bgColor: "FF0000" });
    expect(url).toContain("?bgColor=FF0000");
  });

  it("adds named bgColor parameter", () => {
    const url = buildMermaidInkUrl("svg", "test", { bgColor: "!white" });
    expect(url).toContain("bgColor=!white");
  });

  it("adds width and height parameters", () => {
    const url = buildMermaidInkUrl("svg", "test", { width: 800, height: 600 });
    expect(url).toContain("width=800");
    expect(url).toContain("height=600");
  });

  it("adds scale parameter only when width or height is set", () => {
    const urlWithSize = buildMermaidInkUrl("svg", "test", { width: 800, scale: 2 });
    expect(urlWithSize).toContain("scale=2");

    const urlNoSize = buildMermaidInkUrl("svg", "test", { scale: 2 });
    expect(urlNoSize).not.toContain("scale=");
  });

  it("adds image type parameter for img format", () => {
    const url = buildMermaidInkUrl("img", "test", { imageType: "png" });
    expect(url).toContain("?type=png");
  });

  it("does not add type=jpeg (default)", () => {
    const url = buildMermaidInkUrl("img", "test", { imageType: "jpeg" });
    expect(url).not.toContain("type=");
  });

  it("adds fit parameter for PDF", () => {
    const url = buildMermaidInkUrl("pdf", "test", { fit: true });
    expect(url).toContain("?fit");
  });

  it("adds paper and landscape for PDF", () => {
    const url = buildMermaidInkUrl("pdf", "test", { paper: "a3", landscape: true });
    expect(url).toContain("paper=a3");
    expect(url).toContain("landscape");
  });

  it("ignores paper/landscape when fit is true", () => {
    const url = buildMermaidInkUrl("pdf", "test", { fit: true, paper: "a3", landscape: true });
    expect(url).toContain("fit");
    expect(url).not.toContain("paper=");
    expect(url).not.toContain("landscape");
  });

  it("uses custom base URL", () => {
    const url = buildMermaidInkUrl("svg", "test", { baseUrl: "https://custom.mermaid.io" });
    expect(url).toMatch(/^https:\/\/custom\.mermaid\.io\/svg\/pako:/);
  });

  it("combines multiple parameters", () => {
    const url = buildMermaidInkUrl("svg", "test", {
      theme: "forest",
      bgColor: "FFFFFF",
      width: 1000,
    });
    expect(url).toContain("theme=forest");
    expect(url).toContain("bgColor=FFFFFF");
    expect(url).toContain("width=1000");
  });
});

describe("toMermaidInkUrl", () => {
  it("generates URL from workflow IR", () => {
    const ir = createTestIR();
    const url = toMermaidInkUrl(ir, "svg");
    expect(url).toMatch(/^https:\/\/mermaid\.ink\/svg\/pako:/);
  });

  it("applies options", () => {
    const ir = createTestIR();
    const url = toMermaidInkUrl(ir, "svg", { theme: "dark" });
    expect(url).toContain("theme=dark");
  });
});

describe("convenience functions", () => {
  const ir = createTestIR();

  it("toMermaidInkSvgUrl generates SVG URL", () => {
    const url = toMermaidInkSvgUrl(ir);
    expect(url).toMatch(/^https:\/\/mermaid\.ink\/svg\/pako:/);
  });

  it("toMermaidInkPngUrl generates PNG URL", () => {
    const url = toMermaidInkPngUrl(ir);
    expect(url).toMatch(/^https:\/\/mermaid\.ink\/img\/pako:/);
    expect(url).toContain("type=png");
  });

  it("toMermaidInkPdfUrl generates PDF URL", () => {
    const url = toMermaidInkPdfUrl(ir);
    expect(url).toMatch(/^https:\/\/mermaid\.ink\/pdf\/pako:/);
  });

  it("toMermaidInkPdfUrl with fit option", () => {
    const url = toMermaidInkPdfUrl(ir, { fit: true });
    expect(url).toContain("fit");
  });
});

describe("createMermaidInkGenerator", () => {
  const ir = createTestIR();

  it("creates generator with default options", () => {
    const gen = createMermaidInkGenerator();
    expect(gen.getBaseUrl()).toBe("https://mermaid.ink");
  });

  it("creates generator with custom base URL", () => {
    const gen = createMermaidInkGenerator({ baseUrl: "https://custom.io" });
    expect(gen.getBaseUrl()).toBe("https://custom.io");
  });

  it("applies default options to all URLs", () => {
    const gen = createMermaidInkGenerator({ theme: "dark", bgColor: "1b1b1f" });

    const svgUrl = gen.toSvgUrl(ir);
    const pngUrl = gen.toPngUrl(ir);

    expect(svgUrl).toContain("theme=dark");
    expect(svgUrl).toContain("bgColor=1b1b1f");
    expect(pngUrl).toContain("theme=dark");
    expect(pngUrl).toContain("bgColor=1b1b1f");
  });

  it("generates all format URLs", () => {
    const gen = createMermaidInkGenerator();

    expect(gen.toSvgUrl(ir)).toContain("/svg/");
    expect(gen.toPngUrl(ir)).toContain("/img/");
    expect(gen.toJpegUrl(ir)).toContain("/img/");
    expect(gen.toWebpUrl(ir)).toContain("/img/");
    expect(gen.toPdfUrl(ir)).toContain("/pdf/");
  });

  it("returns options", () => {
    const options = { theme: "forest" as const, width: 800 };
    const gen = createMermaidInkGenerator(options);
    expect(gen.getOptions()).toEqual(options);
  });
});
