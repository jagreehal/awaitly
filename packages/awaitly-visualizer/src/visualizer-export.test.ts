import { describe, it, expect } from "vitest";
import { createVisualizer } from "./index";
import type { WorkflowEvent } from "awaitly/workflow";

describe("WorkflowVisualizer export methods", () => {
  // Helper to create a visualizer with some events
  function createVisualizerWithEvents(options = {}) {
    const viz = createVisualizer({ workflowName: "test-workflow", ...options });

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-1", ts: 0 },
      { type: "step_start", workflowId: "wf-1", stepKey: "step-1", ts: 1, name: "Step 1" },
      { type: "step_success", workflowId: "wf-1", stepKey: "step-1", ts: 10, durationMs: 9 },
      { type: "workflow_success", workflowId: "wf-1", ts: 15, durationMs: 15 },
    ];

    events.forEach((e) => viz.handleEvent(e));
    return viz;
  }

  describe("toSvgUrl", () => {
    it("generates SVG URL with explicit kroki provider", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toSvgUrl({ provider: "kroki" });

      expect(url).toContain("https://kroki.io");
      expect(url).toContain("/mermaid/svg/");
    });

    it("generates SVG URL with explicit mermaid-ink provider", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toSvgUrl({ provider: "mermaid-ink" });

      expect(url).toContain("https://mermaid.ink");
      expect(url).toContain("/svg/");
    });

    it("applies mermaid-ink theme option", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toSvgUrl({ provider: "mermaid-ink", mermaidTheme: "dark" });

      expect(url).toContain("theme=dark");
    });

    it("throws when no provider configured", () => {
      const viz = createVisualizerWithEvents();

      expect(() => viz.toSvgUrl()).toThrow(
        "toSvgUrl(): No export provider configured"
      );
    });

    it("uses default provider when configured", () => {
      const viz = createVisualizerWithEvents({
        export: { default: { provider: "kroki" } },
      });

      const url = viz.toSvgUrl();

      expect(url).toContain("https://kroki.io");
      expect(url).toContain("/mermaid/svg/");
    });

    it("overrides default provider when explicit provider passed", () => {
      const viz = createVisualizerWithEvents({
        export: { default: { provider: "kroki" } },
      });

      const url = viz.toSvgUrl({ provider: "mermaid-ink" });

      expect(url).toContain("https://mermaid.ink");
    });
  });

  describe("toPngUrl", () => {
    it("generates PNG URL with kroki provider", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toPngUrl({ provider: "kroki" });

      expect(url).toContain("https://kroki.io");
      expect(url).toContain("/mermaid/png/");
    });

    it("generates PNG URL with mermaid-ink provider", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toPngUrl({ provider: "mermaid-ink" });

      expect(url).toContain("https://mermaid.ink");
      expect(url).toContain("/img/");
    });

    it("throws when no provider configured", () => {
      const viz = createVisualizerWithEvents();

      expect(() => viz.toPngUrl()).toThrow(
        "toPngUrl(): No export provider configured"
      );
    });
  });

  describe("toPdfUrl", () => {
    it("generates PDF URL with mermaid-ink provider", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toPdfUrl({ provider: "mermaid-ink" });

      expect(url).toContain("https://mermaid.ink");
      expect(url).toContain("/pdf/");
    });

    it("throws for kroki provider (PDF not supported for mermaid)", () => {
      const viz = createVisualizerWithEvents();

      expect(() => viz.toPdfUrl({ provider: "kroki" })).toThrow(
        "toPdfUrl: Export failed - UNSUPPORTED_FORMAT"
      );
    });

    it("throws when no provider configured", () => {
      const viz = createVisualizerWithEvents();

      expect(() => viz.toPdfUrl()).toThrow(
        "toPdfUrl(): No export provider configured"
      );
    });
  });

  describe("toUrl", () => {
    it("delegates to toSvgUrl for svg format", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toUrl("svg", { provider: "kroki" });

      expect(url).toContain("/mermaid/svg/");
    });

    it("delegates to toPngUrl for png format", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toUrl("png", { provider: "kroki" });

      expect(url).toContain("/mermaid/png/");
    });

    it("delegates to toPdfUrl for pdf format", () => {
      const viz = createVisualizerWithEvents();

      const url = viz.toUrl("pdf", { provider: "mermaid-ink" });

      expect(url).toContain("/pdf/");
    });
  });

  describe("default provider with custom base URL", () => {
    it("uses custom kroki base URL from default config", () => {
      const viz = createVisualizerWithEvents({
        export: {
          default: { provider: "kroki", baseUrl: "https://kroki.internal" },
        },
      });

      const url = viz.toSvgUrl();

      expect(url).toContain("https://kroki.internal");
    });
  });

  describe("export.default is treated as immutable", () => {
    it("export options cannot affect later calls", () => {
      const defaultConfig = { provider: "kroki" as const, baseUrl: "https://kroki.io" };
      const viz = createVisualizerWithEvents({
        export: { default: defaultConfig },
      });

      const url1 = viz.toSvgUrl();
      expect(url1).toContain("https://kroki.io");

      // Even if someone tries to mutate the config (which they shouldn't)
      // the URL should still work
      const url2 = viz.toSvgUrl();
      expect(url2).toContain("https://kroki.io");
    });
  });
});
