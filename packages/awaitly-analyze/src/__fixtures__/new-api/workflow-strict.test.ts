/**
 * Tests for workflow strict option extraction
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";

describe("Workflow Strict Option", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("strict option", () => {
    it("extracts strict: true from workflow options", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({
          getUser: async () => ok({}),
          strict: true,
        });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getUser', () => deps.getUser('1'), { errors: [] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.strict).toBe(true);
    });

    it("extracts strict: false from workflow options", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({
          getUser: async () => ok({}),
          strict: false,
        });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getUser', () => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results[0].root.strict).toBe(false);
    });

    it("strict is undefined when not specified", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({
          getUser: async () => ok({}),
        });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getUser', () => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results[0].root.strict).toBeUndefined();
    });
  });

  describe("declared errors", () => {
    it("extracts declared errors from workflow options", () => {
      const source = `
        import { createWorkflow, ok, tags } from "awaitly";
        const workflow = createWorkflow({
          getUser: async () => ok({}),
          errors: ['NOT_FOUND', 'UNAUTHORIZED'],
          strict: true,
        });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getUser', () => deps.getUser('1'), { errors: ['NOT_FOUND'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results[0].root.declaredErrors).toEqual(['NOT_FOUND', 'UNAUTHORIZED']);
    });

    it("extracts declared errors using tags() helper", () => {
      const source = `
        import { createWorkflow, ok, tags } from "awaitly";
        const workflowErrors = tags('ERROR_A', 'ERROR_B');
        const workflow = createWorkflow({
          getUser: async () => ok({}),
          errors: workflowErrors,
          strict: true,
        });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getUser', () => deps.getUser('1'), { errors: ['ERROR_A'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results[0].root.declaredErrors).toEqual(['ERROR_A', 'ERROR_B']);
    });
  });
});
