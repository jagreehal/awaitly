/**
 * Tests for Interactive HTML generator.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../index";
import { renderStaticMermaid } from "./mermaid";
import { extractNodeMetadata, generateInteractiveHTML } from "./html";

describe("extractNodeMetadata", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("extracts metadata for step nodes", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { fetch: async () => ok({}) });
      export async function run() {
        return await w(async (step) => {
          await step('fetchData', () => fetch());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const metadata = extractNodeMetadata(ir);

    expect(metadata.workflowName).toBe("w");
    expect(metadata.stats.totalSteps).toBeGreaterThanOrEqual(1);

    // Should have at least one step node
    const stepNodes = Object.values(metadata.nodes).filter((n) => n.type === "step");
    expect(stepNodes.length).toBeGreaterThanOrEqual(1);
    expect(stepNodes[0]!.mermaidId).toMatch(/^step_\d+$/);
  });

  it("extracts metadata for conditional nodes", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { a: async () => ok(1), b: async () => ok(2) });
      export async function run(flag: boolean) {
        return await w(async (step) => {
          if (flag) {
            await step('a', () => a());
          } else {
            await step('b', () => b());
          }
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const metadata = extractNodeMetadata(ir);

    const condNodes = Object.values(metadata.nodes).filter(
      (n) => n.type === "conditional" || n.type === "decision"
    );
    expect(condNodes.length).toBeGreaterThanOrEqual(1);
    expect(condNodes[0]!.condition).toBeTruthy();
  });

  it("extracts metadata for parallel nodes", () => {
    const source = `
      import { createWorkflow, ok, allAsync } from "awaitly";
      const w = createWorkflow("w", { a: async () => ok(1), b: async () => ok(2) });
      export async function run() {
        return await w(async (step) => {
          await allAsync(
            step('a', () => a()),
            step('b', () => b())
          );
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const metadata = extractNodeMetadata(ir);

    // Should have parallel-related nodes (fork and join)
    const forkNodes = Object.values(metadata.nodes).filter((n) => n.type === "parallel-fork");
    expect(forkNodes.length).toBeGreaterThanOrEqual(1);

    const joinNodes = Object.values(metadata.nodes).filter((n) => n.type === "parallel-join");
    expect(joinNodes.length).toBeGreaterThanOrEqual(1);
  });

  it("node IDs match renderStaticMermaid output", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { a: async () => ok(1), b: async () => ok(2) });
      export async function run() {
        return await w(async (step) => {
          await step('x', () => a());
          await step('y', () => b());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const metadata = extractNodeMetadata(ir);
    const mermaid = renderStaticMermaid(ir);

    // Every mermaid ID from metadata should appear in the mermaid text
    for (const nodeId of Object.keys(metadata.nodes)) {
      expect(mermaid).toContain(nodeId);
    }
  });
});

describe("generateInteractiveHTML", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("generates valid HTML with Mermaid CDN", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("checkout", { fetch: async () => ok({}) });
      export async function run() {
        return await w(async (step) => {
          await step('validate', () => fetch());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const mermaid = renderStaticMermaid(ir);
    const metadata = extractNodeMetadata(ir);
    const html = generateInteractiveHTML(mermaid, metadata);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("mermaid");
    expect(html).toContain("cdn.jsdelivr.net");
    expect(html).toContain("checkout");
    expect(html).toContain("WORKFLOW_DATA");
    expect(html).toContain("inspector");
    expect(html).toContain("Click a node to inspect");
  });

  it("embeds metadata JSON", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("payment", { charge: async () => ok({}) });
      export async function run() {
        return await w(async (step) => {
          await step('charge', () => charge());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const mermaid = renderStaticMermaid(ir);
    const metadata = extractNodeMetadata(ir);
    const html = generateInteractiveHTML(mermaid, metadata);

    // The metadata JSON should be embedded
    expect(html).toContain('"workflowName"');
    expect(html).toContain('"payment"');
    expect(html).toContain('"nodes"');
  });

  it("includes click handler JavaScript", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { f: async () => ok({}) });
      export async function run() {
        return await w(async (step) => {
          await step('x', () => f());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const mermaid = renderStaticMermaid(ir);
    const metadata = extractNodeMetadata(ir);
    const html = generateInteractiveHTML(mermaid, metadata);

    expect(html).toContain("attachHandlers");
    expect(html).toContain("extractNodeId");
    expect(html).toContain("renderInspector");
    expect(html).toContain("selectNode");
  });

  it("supports named theme override", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { f: async () => ok({}) });
      export async function run() {
        return await w(async (step) => {
          await step('x', () => f());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const mermaid = renderStaticMermaid(ir);
    const metadata = extractNodeMetadata(ir);
    const html = generateInteractiveHTML(mermaid, metadata, { theme: "daylight" });

    expect(html).toContain('"daylight"');
    // Should contain theme definitions
    expect(html).toContain("[data-theme=");
  });

  it("includes theme picker UI", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { f: async () => ok({}) });
      export async function run() {
        return await w(async (step) => {
          await step('x', () => f());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const mermaid = renderStaticMermaid(ir);
    const metadata = extractNodeMetadata(ir);
    const html = generateInteractiveHTML(mermaid, metadata);

    expect(html).toContain("theme-picker");
    expect(html).toContain("theme-menu");
    expect(html).toContain("midnight");
    expect(html).toContain("ocean");
    expect(html).toContain("daylight");
    expect(html).toContain("prefers-color-scheme");
  });

  it("embeds mermaid text in pre tag", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { f: async () => ok({}) });
      export async function run() {
        return await w(async (step) => {
          await step('x', () => f());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const ir = results[0]!;
    const mermaid = renderStaticMermaid(ir);
    const metadata = extractNodeMetadata(ir);
    const html = generateInteractiveHTML(mermaid, metadata);

    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("flowchart TB");
  });
});
