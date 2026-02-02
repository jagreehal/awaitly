/**
 * Tests for enhanced Mermaid rendering with data flow and errors
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import { renderEnhancedMermaid } from "../../output/mermaid";

describe("Enhanced Mermaid Rendering", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("renders basic workflow with data flow annotations", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const workflow = createWorkflow({ a: async () => ok({}), b: async () => ok({}) });
      export async function run() {
        return await workflow(async (step, deps, ctx) => {
          await step('getUser', () => deps.a(), { out: 'user', errors: ['NOT_FOUND'] });
          await step('getPosts', () => deps.b(ctx.ref('user')), { out: 'posts', errors: ['FETCH_ERROR'] });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const mermaid = renderEnhancedMermaid(results[0]);

    expect(mermaid).toContain("flowchart TB");
    expect(mermaid).toContain("getUser");
    expect(mermaid).toContain("getPosts");
    expect(mermaid).toContain("out: user");
    expect(mermaid).toContain("out: posts");
    expect(mermaid).toContain("errors: NOT_FOUND");
    expect(mermaid).toContain("errors: FETCH_ERROR");
    // Data flow edge
    expect(mermaid).toContain("|user|");
  });

  it("shows error nodes when enabled", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const workflow = createWorkflow({ a: async () => ok({}) });
      export async function run() {
        return await workflow(async (step, deps) => {
          await step('doSomething', () => deps.a(), { errors: ['ERROR_A', 'ERROR_B'] });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const mermaid = renderEnhancedMermaid(results[0], { showErrorNodes: true });

    expect(mermaid).toContain("subgraph Errors");
    expect(mermaid).toContain("ERROR_A");
    expect(mermaid).toContain("ERROR_B");
    expect(mermaid).toContain("|throws|");
  });

  it("highlights steps without declared errors", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const workflow = createWorkflow({ a: async () => ok({}), b: async () => ok({}) });
      export async function run() {
        return await workflow(async (step, deps) => {
          await step('withErrors', () => deps.a(), { errors: ['ERROR'] });
          await step('withoutErrors', () => deps.b());
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const mermaid = renderEnhancedMermaid(results[0], { highlightMissingErrors: true });

    // Should have noErrorStyle class for step without errors
    expect(mermaid).toContain("noErrorStyle");
  });

  it("respects direction option", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const workflow = createWorkflow({ a: async () => ok({}) });
      export async function run() {
        return await workflow(async (step, deps) => {
          await step('step1', () => deps.a());
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const mermaid = renderEnhancedMermaid(results[0], { direction: "LR" });

    expect(mermaid).toContain("flowchart LR");
  });

  it("can disable data flow display", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const workflow = createWorkflow({ a: async () => ok({}) });
      export async function run() {
        return await workflow(async (step, deps) => {
          await step('step1', () => deps.a(), { out: 'data' });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const mermaid = renderEnhancedMermaid(results[0], { showDataFlow: false });

    // Should not contain "out:" annotation when data flow is disabled
    expect(mermaid).not.toContain("out: data");
  });

  it("can disable error display", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const workflow = createWorkflow({ a: async () => ok({}) });
      export async function run() {
        return await workflow(async (step, deps) => {
          await step('step1', () => deps.a(), { errors: ['MY_ERROR'] });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const mermaid = renderEnhancedMermaid(results[0], { showErrors: false });

    // Should not contain error annotation when errors are disabled
    expect(mermaid).not.toContain("errors: MY_ERROR");
  });
});
