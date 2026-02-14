/**
 * Tests for step.forEach() loop detection
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import type { StaticLoopNode } from "../../types";

describe("step.forEach() Detection", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("basic detection", () => {
    it("detects step.forEach with simple run form", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step.forEach('process-items', items, {
              maxIterations: 100,
              stepIdPattern: 'process-{i}',
              errors: ['PROCESS_ERROR'],
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const loopNode = results[0].root.children[0] as StaticLoopNode;
      expect(loopNode.type).toBe("loop");
      expect(loopNode.loopType).toBe("step.forEach");
      expect(loopNode.loopId).toBe("process-items");
      expect(loopNode.maxIterations).toBe(100);
      expect(loopNode.stepIdPattern).toBe("process-{i}");
      expect(loopNode.errors).toEqual(["PROCESS_ERROR"]);
      expect(loopNode.boundKnown).toBe(true);
    });

    it("extracts iteration source", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            const items = [1, 2, 3];
            await step.forEach('process', items, {
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const loopNode = results[0].root.children[0] as StaticLoopNode;

      expect(loopNode.iterSource).toBe("items");
    });
  });

  describe("complex item form", () => {
    it("detects step.forEach with step.item form", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { validate: async () => ok({}), process: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step.forEach('process-items', items, {
              maxIterations: 50,
              item: step.item((item, i, innerStep) => {
                await innerStep('validate', () => deps.validate(item));
                await innerStep('process', () => deps.process(item));
              }),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const loopNode = results[0].root.children[0] as StaticLoopNode;

      expect(loopNode.type).toBe("loop");
      expect(loopNode.loopType).toBe("step.forEach");
      expect(loopNode.loopId).toBe("process-items");
      expect(loopNode.maxIterations).toBe(50);
      // Note: Inner step detection requires more sophisticated context tracking
      // The loop structure itself is properly detected
    });
  });

  describe("without maxIterations", () => {
    it("marks boundKnown as false when maxIterations not specified", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step.forEach('process', items, {
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const loopNode = results[0].root.children[0] as StaticLoopNode;

      expect(loopNode.boundKnown).toBe(false);
      expect(loopNode.maxIterations).toBeUndefined();
    });
  });

  describe("out and collect options", () => {
    it("extracts out key for data flow", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step.forEach('process', items, {
              out: 'results',
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const loopNode = results[0].root.children[0] as StaticLoopNode;

      expect(loopNode.out).toBe("results");
    });

    it("extracts collect: array option", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step.forEach('process', items, {
              out: 'allResults',
              collect: 'array',
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const loopNode = results[0].root.children[0] as StaticLoopNode;

      expect(loopNode.out).toBe("allResults");
      expect(loopNode.collect).toBe("array");
    });

    it("extracts collect: last option", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step.forEach('process', items, {
              out: 'lastResult',
              collect: 'last',
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const loopNode = results[0].root.children[0] as StaticLoopNode;

      expect(loopNode.out).toBe("lastResult");
      expect(loopNode.collect).toBe("last");
    });
  });
});
