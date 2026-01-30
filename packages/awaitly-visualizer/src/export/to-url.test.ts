import { describe, it, expect } from "vitest";
import { toExportUrl } from "./to-url";
import type { DiagramSource, ExportFormat } from "../types";

describe("toExportUrl", () => {
  const mermaidDiagram: DiagramSource = {
    kind: "mermaid",
    source: "flowchart TD\n  A-->B",
  };

  describe("Kroki provider", () => {
    it("generates SVG URL with kroki provider", () => {
      const result = toExportUrl(mermaidDiagram, "svg", { provider: "kroki" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("https://kroki.io");
        expect(result.value).toContain("/mermaid/svg/");
      }
    });

    it("generates PNG URL with kroki provider", () => {
      const result = toExportUrl(mermaidDiagram, "png", { provider: "kroki" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("https://kroki.io");
        expect(result.value).toContain("/mermaid/png/");
      }
    });

    it("supports custom base URL", () => {
      const result = toExportUrl(mermaidDiagram, "svg", {
        provider: "kroki",
        baseUrl: "https://kroki.internal",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("https://kroki.internal");
        expect(result.value).toContain("/mermaid/svg/");
      }
    });

    it("returns error for PDF format", () => {
      const result = toExportUrl(mermaidDiagram, "pdf", { provider: "kroki" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("UNSUPPORTED_FORMAT");
      }
    });

    it("returns error for PDF format with caller context", () => {
      const result = toExportUrl(mermaidDiagram, "pdf", { provider: "kroki" }, { caller: "toPdfUrl" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("UNSUPPORTED_FORMAT");
      }
    });
  });

  describe("mermaid-ink provider", () => {
    it("generates SVG URL with mermaid-ink provider", () => {
      const result = toExportUrl(mermaidDiagram, "svg", { provider: "mermaid-ink" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("https://mermaid.ink");
        expect(result.value).toContain("/svg/");
      }
    });

    it("generates PNG URL with mermaid-ink provider", () => {
      const result = toExportUrl(mermaidDiagram, "png", { provider: "mermaid-ink" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("https://mermaid.ink");
        expect(result.value).toContain("/img/");
      }
    });

    it("generates PDF URL with mermaid-ink provider", () => {
      const result = toExportUrl(mermaidDiagram, "pdf", { provider: "mermaid-ink" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("https://mermaid.ink");
        expect(result.value).toContain("/pdf/");
      }
    });

    it("applies mermaid theme option", () => {
      const result = toExportUrl(mermaidDiagram, "svg", {
        provider: "mermaid-ink",
        mermaidTheme: "dark",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("theme=dark");
      }
    });

    it("applies background option", () => {
      const result = toExportUrl(mermaidDiagram, "svg", {
        provider: "mermaid-ink",
        background: "1b1b1f",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain("bgColor=1b1b1f");
      }
    });
  });

  describe("unsupported diagram kinds", () => {
    it("returns error for graphviz diagrams", () => {
      const graphvizDiagram: DiagramSource = {
        kind: "graphviz",
        source: "digraph { A -> B }",
      };

      const result = toExportUrl(graphvizDiagram, "svg", { provider: "kroki" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("UNSUPPORTED_DIAGRAM_KIND");
      }
    });

    it("returns error for plantuml diagrams", () => {
      const plantumlDiagram: DiagramSource = {
        kind: "plantuml",
        source: "@startuml\nA -> B\n@enduml",
      };

      const result = toExportUrl(plantumlDiagram, "svg", { provider: "kroki" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("UNSUPPORTED_DIAGRAM_KIND");
      }
    });
  });

  describe("format validation", () => {
    const formats: ExportFormat[] = ["svg", "png", "pdf"];

    formats.forEach((format) => {
      it(`validates ${format} format for mermaid-ink`, () => {
        // mermaid-ink supports all formats for mermaid
        const result = toExportUrl(mermaidDiagram, format, { provider: "mermaid-ink" });
        expect(result.ok).toBe(true);
      });
    });

    it("kroki supports svg and png for mermaid", () => {
      const svgResult = toExportUrl(mermaidDiagram, "svg", { provider: "kroki" });
      const pngResult = toExportUrl(mermaidDiagram, "png", { provider: "kroki" });

      expect(svgResult.ok).toBe(true);
      expect(pngResult.ok).toBe(true);
    });
  });
});
