/**
 * Smoke test: exercises every major feature of awaitly-visualizer in one place.
 * Run with: pnpm test src/features-smoke.test.ts
 */
import { describe, it, expect } from "vitest";
import { ok } from "awaitly/core";
import { createWorkflow } from "awaitly/workflow";
import {
  createVisualizer,
  createEventCollector,
  visualizeEvents,
  combineEventHandlers,
  createIRBuilder,
  createTimeTravelController,
  createPerformanceAnalyzer,
  getHeatLevel,
  createLiveVisualizer,
  trackIf,
  trackSwitch,
  asciiRenderer,
  mermaidRenderer,
  loggerRenderer,
  flowchartRenderer,
  htmlRenderer,
  renderToHTML,
  detectParallelGroups,
  createParallelDetector,
  toExportUrl,
  toKrokiUrl,
  toKrokiSvgUrl,
  toMermaidInkUrl,
  toMermaidInkSvgUrl,
  createUrlGenerator,
  createMermaidInkGenerator,
  encodeForMermaidInk,
} from "./index";
import { createWebhookNotifier } from "./notifiers/webhook";
import type { WorkflowEvent } from "awaitly/workflow";

const DONE = "done" as const;

async function stubStep(): Promise<{ id: string }> {
  return ok({ id: "1" });
}

describe("Features smoke: all major APIs work", () => {
  describe("1. Visualizer + output formats", () => {
    it("createVisualizer, handleEvent, render, renderAs(ascii|mermaid|json|logger|flowchart)", async () => {
      const viz = createVisualizer({ workflowName: "smoke" });
      const workflow = createWorkflow("smoke", { stubStep }, { onEvent: viz.handleEvent });
      await workflow.run(async ({ step, deps: { stubStep } }) => {
        await step("One", () => stubStep());
        return DONE;
      });

      expect(viz.render()).toContain("smoke");
      expect(viz.renderAs("ascii")).toContain("smoke");
      expect(viz.renderAs("mermaid")).toContain("flowchart");
      expect(JSON.parse(viz.renderAs("json"))).toHaveProperty("root");
      expect(viz.renderAs("logger")).toBeDefined();
      expect(viz.renderAs("flowchart")).toBeDefined();
    });
  });

  describe("2. Export URLs (Kroki / Mermaid.ink)", () => {
    it("toSvgUrl, toPngUrl, toPdfUrl with kroki and mermaid-ink", async () => {
      const viz = createVisualizer({
        workflowName: "export-smoke",
        export: { default: { provider: "kroki" } },
      });
      const workflow = createWorkflow("export-smoke", { stubStep }, { onEvent: viz.handleEvent });
      await workflow.run(async ({ step, deps: { stubStep } }) => {
        await step("A", () => stubStep());
        return DONE;
      });

      const svgKroki = viz.toSvgUrl({ provider: "kroki" });
      expect(svgKroki).toContain("kroki.io");
      expect(svgKroki).toContain("mermaid");

      const pngKroki = viz.toPngUrl({ provider: "kroki" });
      expect(pngKroki).toContain("kroki.io");

      const svgInk = viz.toSvgUrl({ provider: "mermaid-ink" });
      expect(svgInk).toContain("mermaid.ink");
      const pdfInk = viz.toPdfUrl({ provider: "mermaid-ink" });
      expect(pdfInk).toContain("mermaid.ink");
    });
  });

  describe("3. HTML renderer", () => {
    it("htmlRenderer, renderToHTML produce valid HTML", async () => {
      const viz = createVisualizer({ workflowName: "html-smoke" });
      const workflow = createWorkflow("html-smoke", { stubStep }, { onEvent: viz.handleEvent });
      await workflow.run(async ({ step, deps: { stubStep } }) => {
        await step("Step", () => stubStep());
        return DONE;
      });

      const ir = viz.getIR();
      const html = htmlRenderer();
      const opts = { showTimings: true, terminalWidth: 80, colors: {} };
      const fragment = html.render(ir, opts);
      expect(fragment).toContain("svg");
      expect(fragment).toContain("html-smoke");

      const fullDoc = renderToHTML(ir, {});
      expect(fullDoc).toContain("<!DOCTYPE html");
      expect(fullDoc).toContain("Workflow Visualizer");
    });
  });

  describe("4. Event collection and combineEventHandlers", () => {
    it("createEventCollector, visualizeEvents, combineEventHandlers", async () => {
      const collector = createEventCollector({ workflowName: "collect" });
      const workflow = createWorkflow("collect", { stubStep }, { onEvent: collector.handleEvent });
      await workflow.run(async ({ step, deps: { stubStep } }) => {
        await step("X", () => stubStep());
        return DONE;
      });

      expect(collector.getEvents().length).toBeGreaterThan(0);
      expect(collector.visualize()).toContain("X");
      expect(collector.visualizeAs("mermaid")).toContain("flowchart");

      const events: WorkflowEvent<unknown>[] = [];
      const viz2 = createVisualizer({ workflowName: "combined" });
      const combined = combineEventHandlers(viz2.handleEvent, (e) => events.push(e));
      const workflow2 = createWorkflow("combined", { stubStep }, { onEvent: combined });
      await workflow2.run(async ({ step, deps: { stubStep } }) => {
        await step("Y", () => stubStep());
        return DONE;
      });
      expect(events.length).toBeGreaterThan(0);
      expect(viz2.render()).toContain("Y");

      const out = visualizeEvents(events, { workflowName: "from-events" });
      expect(out).toContain("Y");
    });
  });

  describe("5. Decision tracking (trackIf, trackSwitch)", () => {
    it("trackIf and trackSwitch with handleDecisionEvent", async () => {
      const collector = createEventCollector({ workflowName: "decision-smoke" });
      const workflow = createWorkflow(
        "decision-smoke",
        { stubStep },
        { onEvent: collector.handleEvent }
      );
      await workflow.run(async ({ step, deps: { stubStep } }) => {
        await step("Pre", () => stubStep());
        const iff = trackIf("cond", true, { emit: collector.handleDecisionEvent });
        iff.takeBranch("then");
        await step("Then", () => stubStep());
        iff.end();

        const sw = trackSwitch("key", "a", { emit: collector.handleDecisionEvent });
        sw.takeBranch("a");
        sw.end();
        return DONE;
      });

      expect(collector.getDecisionEvents().length).toBeGreaterThan(0);
      expect(collector.visualize()).toBeDefined();
    });
  });

  describe("6. Time-travel controller", () => {
    it("createTimeTravelController, seek, stepForward, stepBackward, onStateChange", async () => {
      const tt = createTimeTravelController();
      const workflow = createWorkflow("tt-smoke", { stubStep }, { onEvent: tt.handleEvent });
      await workflow.run(async ({ step, deps: { stubStep } }) => {
        await step("A", () => stubStep());
        await step("B", () => stubStep());
        return DONE;
      });

      const ir0 = tt.seek(0);
      expect(ir0).toBeDefined();
      const irF = tt.stepForward();
      expect(irF).toBeDefined();
      tt.stepBackward();
      const state = tt.getState();
      expect(state).toBeDefined();

      let received = 0;
      const unsub = tt.onStateChange(() => {
        received += 1;
      });
      tt.stepForward();
      expect(received).toBeGreaterThan(0);
      unsub();
    });
  });

  describe("7. Performance analyzer", () => {
    it("createPerformanceAnalyzer, addRun, getHeatmap, getHeatLevel", async () => {
      const analyzer = createPerformanceAnalyzer();
      const builder = createIRBuilder();
      const events: WorkflowEvent<unknown>[] = [
        { type: "workflow_start", workflowId: "w1", ts: 0 },
        { type: "step_start", workflowId: "w1", stepKey: "s1", stepId: "id1", ts: 1, name: "S1" },
        { type: "step_success", workflowId: "w1", stepKey: "s1", stepId: "id1", ts: 11, durationMs: 10 },
        { type: "workflow_success", workflowId: "w1", ts: 12, durationMs: 12 },
      ];
      analyzer.addRun({ id: "r1", startTime: 0, events });
      events.forEach((e) => builder.handleEvent(e));
      const ir = builder.getIR();
      const heatmap = analyzer.getHeatmap(ir, "duration");
      expect(heatmap.heat.size).toBeGreaterThanOrEqual(0);

      const level = getHeatLevel(0.5);
      expect(["cold", "cool", "neutral", "warm", "hot", "critical"]).toContain(level);
    });
  });

  describe("8. Live visualizer (Node)", () => {
    it("createLiveVisualizer exists and returns object with handleEvent", () => {
      const live = createLiveVisualizer();
      expect(live).toBeDefined();
      expect(typeof live.handleEvent).toBe("function");
    });
  });

  describe("9. Kroki / Mermaid.ink URL helpers", () => {
    it("toKrokiUrl, toKrokiSvgUrl, createUrlGenerator, toMermaidInkUrl, encodeForMermaidInk", () => {
      const builder = createIRBuilder();
      const events: WorkflowEvent<unknown>[] = [
        { type: "workflow_start", workflowId: "w1", ts: 0 },
        { type: "step_start", workflowId: "w1", stepKey: "s1", ts: 1, name: "A" },
        { type: "step_success", workflowId: "w1", stepKey: "s1", ts: 2, durationMs: 1 },
        { type: "workflow_success", workflowId: "w1", ts: 3 },
      ];
      events.forEach((e) => builder.handleEvent(e));
      const ir = builder.getIR();

      const krokiUrl = toKrokiUrl(ir, "svg");
      expect(krokiUrl).toContain("kroki.io");
      const krokiSvg = toKrokiSvgUrl(ir);
      expect(krokiSvg).toContain("svg");

      const gen = createUrlGenerator({ baseUrl: "https://kroki.io" });
      expect(gen.toSvgUrl(ir)).toContain("kroki.io");
      expect(gen.toPngUrl(ir)).toContain("kroki.io");

      const mermaidText = mermaidRenderer().render(ir, { showTimings: false, terminalWidth: 80, colors: {} });
      const encoded = encodeForMermaidInk(mermaidText);
      expect(encoded).toBeDefined();
      const inkUrl = toMermaidInkUrl(ir, "svg");
      expect(inkUrl).toContain("mermaid.ink");
      const inkSvg = toMermaidInkSvgUrl(ir);
      expect(inkSvg).toContain("mermaid.ink");
    });
  });

  describe("10. toExportUrl (unified export)", () => {
    it("toExportUrl with kroki and mermaid-ink", () => {
      const source = { kind: "mermaid" as const, source: "flowchart LR\n  A-->B" };
      const rSvg = toExportUrl(source, "svg", { provider: "kroki" });
      expect(rSvg.ok).toBe(true);
      if (rSvg.ok) expect(rSvg.value).toContain("kroki.io");
      const rPng = toExportUrl(source, "png", { provider: "mermaid-ink" });
      expect(rPng.ok).toBe(true);
    });
  });

  describe("11. Standalone renderers and IR/parallel", () => {
    it("createIRBuilder, asciiRenderer, mermaidRenderer, loggerRenderer, flowchartRenderer", () => {
      const builder = createIRBuilder();
      const events: WorkflowEvent<unknown>[] = [
        { type: "workflow_start", workflowId: "w1", ts: 0 },
        { type: "step_start", workflowId: "w1", stepKey: "s1", ts: 1, name: "S1" },
        { type: "step_success", workflowId: "w1", stepKey: "s1", ts: 2, durationMs: 1 },
        { type: "workflow_success", workflowId: "w1", ts: 3 },
      ];
      events.forEach((e) => builder.handleEvent(e));
      const ir = builder.getIR();
      expect(ir.root).toBeDefined();

      const opts = { showTimings: false, terminalWidth: 80, colors: {} };
      expect(asciiRenderer().render(ir, opts)).toBeDefined();
      expect(mermaidRenderer().render(ir, opts)).toContain("flowchart");
      expect(loggerRenderer().render(ir, opts)).toBeDefined();
      expect(flowchartRenderer().render(ir, opts)).toBeDefined();
    });

    it("detectParallelGroups, createParallelDetector", () => {
      const detector = createParallelDetector();
      const stepA = {
        type: "step" as const,
        id: "a",
        state: "success" as const,
        startTs: 0,
        endTs: 10,
        durationMs: 10,
      };
      const stepB = {
        type: "step" as const,
        id: "b",
        state: "success" as const,
        startTs: 2,
        endTs: 8,
        durationMs: 6,
      };
      const nodes = [stepA, stepB];
      const result = detector.detect(nodes);
      expect(Array.isArray(result)).toBe(true);
      const groups = detectParallelGroups(nodes);
      expect(Array.isArray(groups)).toBe(true);
    });
  });

  describe("12. Webhook notifier (instantiate only)", () => {
    it("createWebhookNotifier with mock URL and diagramProvider", () => {
      const notifier = createWebhookNotifier({
        url: "https://example.com/webhook",
        diagramProvider: { provider: "kroki" },
      });
      expect(notifier).toBeDefined();
      expect(typeof notifier.notify).toBe("function");
    });
  });
});
