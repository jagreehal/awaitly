/**
 * Phase 0 Tests: Test Harness Verification
 *
 * These tests verify that the deterministic test utilities work correctly
 * and produce stable, reproducible outputs.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { analyzeFixtureSource, loadFixture } from "./test-utils.js";
import { resetIdCounter } from "./static-analyzer/index.js";

describe("Test Harness", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("normalizeAnalysisOutput", () => {
    it("normalizes generated IDs to stable values", () => {
      resetIdCounter();
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("test", { fn: async () => ok(1) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("a", () => deps.fn());
          });
        }
      `;

      const result1 = analyzeFixtureSource(source);
      resetIdCounter();
      const result2 = analyzeFixtureSource(source);

      expect(result1.root).toEqual(result2.root);
    });

    it("normalizes file paths", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("test", { fn: async () => ok(1) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("a", () => deps.fn());
          });
        }
      `;

      const result = analyzeFixtureSource(source);

      expect(result.metadata.filePath).toBe("<source>");
    });

    it("normalizes timestamps", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("test", { fn: async () => ok(1) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("a", () => deps.fn());
          });
        }
      `;

      const result = analyzeFixtureSource(source);

      expect(result.metadata.analyzedAt).toBe(0);
    });

    it("normalizes TypeScript version", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("test", { fn: async () => ok(1) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("a", () => deps.fn());
          });
        }
      `;

      const result = analyzeFixtureSource(source);

      expect(result.metadata.tsVersion).toBe("<ts-version>");
    });

    it("preserves stepId and workflow names", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("my-workflow", { fn: async () => ok(1) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("step-one", () => deps.fn());
            await step("step-two", () => deps.fn());
          });
        }
      `;

      const result = analyzeFixtureSource(source);
      const root = result.root as { 
        workflowName: string; 
        children: unknown[] 
      };

      expect(root.workflowName).toBe("my-workflow");

      const collectSteps = (nodes: unknown[]): Array<{ type?: string; stepId?: string }> => {
        const steps: Array<{ type?: string; stepId?: string }> = [];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const n = node as Record<string, unknown>;
          if (n.type === "step") {
            steps.push(n as { type?: string; stepId?: string });
          }
          if (Array.isArray(n.children)) {
            steps.push(...collectSteps(n.children));
          }
          if (Array.isArray(n.body)) {
            steps.push(...collectSteps(n.body));
          }
          if (Array.isArray(n.consequent)) {
            steps.push(...collectSteps(n.consequent));
          }
          if (Array.isArray(n.alternate)) {
            steps.push(...collectSteps(n.alternate));
          }
        }
        return steps;
      };

      const steps = collectSteps(root.children);
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps[0]?.stepId).toBe("step-one");
      expect(steps[1]?.stepId).toBe("step-two");
    });

    it("produces stable JSON output across multiple runs", () => {
      resetIdCounter();
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("test", { fn: async () => ok(1) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("a", () => deps.fn());
            await step("b", () => deps.fn());
          });
        }
      `;

      const result1 = analyzeFixtureSource(source);
      const json1 = JSON.stringify(result1, null, 2);

      resetIdCounter();
      const result2 = analyzeFixtureSource(source);
      const json2 = JSON.stringify(result2, null, 2);

      expect(json1).toBe(json2);
    });
  });

  describe("loadFixture", () => {
    it("loads and normalizes workflow-basic fixture", () => {
      const fixture = loadFixture("workflow-basic");

      expect(fixture.ir).toBeDefined();
      expect(fixture.normalized).toBeDefined();
      // When using analyzeWorkflowSource (in-memory), filePath is "<source>"
      // This is correct behavior for deterministic testing
      expect(fixture.normalized.metadata.filePath).toBe("<source>");
    });

    it("throws for non-existent fixture", () => {
      expect(() => loadFixture("non-existent")).toThrow("Fixture not found");
    });
  });

  describe("Determinism verification", () => {
    it("produces identical output for same source on different machines", () => {
      resetIdCounter();
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("determinism-test", { 
          fn: async () => ok({ value: 42 }) 
        });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            const result = await step("fetch", () => deps.fn(), { out: "data" });
            return result;
          });
        }
      `;

      const result = analyzeFixtureSource(source);

      const expectedStructure = {
        metadata: {
          analyzedAt: 0,
          filePath: "<source>",
          tsVersion: "<ts-version>",
        },
      };

      expect(result.metadata.analyzedAt).toBe(expectedStructure.metadata.analyzedAt);
      expect(result.metadata.filePath).toBe(expectedStructure.metadata.filePath);
      expect(result.metadata.tsVersion).toBe(expectedStructure.metadata.tsVersion);
    });
  });
});
