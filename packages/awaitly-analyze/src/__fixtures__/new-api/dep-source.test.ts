/**
 * Tests for dep source tracking
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";

describe("Dep Source Tracking", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("auto-detection from callee", () => {
    it("detects dep from deps.xxx() pattern", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getCart: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getCart', () => deps.getCart('123'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stepNode = results[0].root.children[0];

      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.depSource).toBe("getCart");
      }
    });

    it("detects dep from ctx.deps.xxx() pattern", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { fetchUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, ctx }) => {
            await step('getUser', () => ctx.deps.fetchUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stepNode = results[0].root.children[0];

      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.depSource).toBe("fetchUser");
      }
    });
  });

  describe("explicit dep option", () => {
    it("extracts dep from options object", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getCart: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getCart', () => {
              const id = transform('123');
              return deps.getCart(id);
            }, { dep: 'getCart' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stepNode = results[0].root.children[0];

      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.depSource).toBe("getCart");
      }
    });
  });

  describe("step.dep() wrapper", () => {
    it("extracts dep from step.dep() wrapper", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getCart: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getCart', step.dep('getCart', () => deps.getCart('123')));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stepNode = results[0].root.children[0];

      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.depSource).toBe("getCart");
      }
    });

    it("step.dep() takes precedence over auto-detection", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getCart: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getCart', step.dep('cartService', () => deps.getCart('123')));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stepNode = results[0].root.children[0];

      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        // step.dep() name should take precedence
        expect(stepNode.depSource).toBe("cartService");
      }
    });
  });

  describe("priority", () => {
    it("explicit dep option overrides auto-detection", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getCart: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getCart', () => deps.getCart('123'), { dep: 'cartRetrieval' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stepNode = results[0].root.children[0];

      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        // Explicit dep option should take precedence
        expect(stepNode.depSource).toBe("cartRetrieval");
      }
    });
  });
});
