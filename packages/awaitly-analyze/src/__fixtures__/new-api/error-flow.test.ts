/**
 * Tests for error flow analysis
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import {
  analyzeErrorFlow,
  getErrorProducers,
  validateWorkflowErrors,
  renderErrorFlowMermaid,
  formatErrorSummary,
} from "../../error-flow";

describe("Error Flow Analysis", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("analyzeErrorFlow", () => {
    it("collects all errors from steps", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.a(), { errors: ['NOT_FOUND', 'UNAUTHORIZED'] });
            await step('getPosts', () => deps.b(), { errors: ['FETCH_ERROR'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);

      expect(analysis.allErrors).toEqual(["FETCH_ERROR", "NOT_FOUND", "UNAUTHORIZED"]);
      expect(analysis.stepErrors).toHaveLength(2);
      expect(analysis.allStepsDeclareErrors).toBe(true);
    });

    it("tracks steps without declared errors", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('withErrors', () => deps.a(), { errors: ['ERROR1'] });
            await step('withoutErrors', () => deps.b());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);

      expect(analysis.stepsWithoutErrors).toContain("withoutErrors");
      expect(analysis.allStepsDeclareErrors).toBe(false);
    });

    it("maps errors to producing steps", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step1', () => deps.a(), { errors: ['SHARED_ERROR', 'ERROR1'] });
            await step('step2', () => deps.b(), { errors: ['SHARED_ERROR', 'ERROR2'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);

      expect(analysis.errorToSteps.get("SHARED_ERROR")).toEqual(["step1", "step2"]);
      expect(analysis.errorToSteps.get("ERROR1")).toEqual(["step1"]);
      expect(analysis.errorToSteps.get("ERROR2")).toEqual(["step2"]);
    });
  });

  describe("getErrorProducers", () => {
    it("returns steps that can produce a specific error", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step1', () => deps.a(), { errors: ['TARGET_ERROR'] });
            await step('step2', () => deps.b(), { errors: ['OTHER_ERROR'] });
            await step('step3', () => deps.a(), { errors: ['TARGET_ERROR'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);

      const producers = getErrorProducers(analysis, "TARGET_ERROR");
      expect(producers).toHaveLength(2);
      expect(producers.map(p => p.stepId)).toEqual(["step1", "step3"]);
    });
  });

  describe("validateWorkflowErrors", () => {
    it("validates matching declared and computed errors", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step1', () => deps.a(), { errors: ['ERROR_A', 'ERROR_B'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);

      const validation = validateWorkflowErrors(analysis, ["ERROR_A", "ERROR_B"]);
      expect(validation.valid).toBe(true);
      expect(validation.unusedDeclared).toHaveLength(0);
      expect(validation.undeclaredErrors).toHaveLength(0);
    });

    it("detects undeclared errors", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step1', () => deps.a(), { errors: ['ERROR_A', 'ERROR_B'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);

      const validation = validateWorkflowErrors(analysis, ["ERROR_A"]); // Missing ERROR_B
      expect(validation.valid).toBe(false);
      expect(validation.undeclaredErrors).toContain("ERROR_B");
    });

    it("detects unused declared errors", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step1', () => deps.a(), { errors: ['ERROR_A'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);

      const validation = validateWorkflowErrors(analysis, ["ERROR_A", "ERROR_X"]); // ERROR_X not used
      expect(validation.valid).toBe(false);
      expect(validation.unusedDeclared).toContain("ERROR_X");
    });
  });

  describe("renderErrorFlowMermaid", () => {
    it("renders error flow as Mermaid diagram", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.a(), { errors: ['NOT_FOUND'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);
      const mermaid = renderErrorFlowMermaid(analysis);

      expect(mermaid).toContain("flowchart LR");
      expect(mermaid).toContain("getUser");
      expect(mermaid).toContain("NOT_FOUND");
      expect(mermaid).toContain("throws");
    });
  });

  describe("formatErrorSummary", () => {
    it("formats error analysis as markdown", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.a(), { errors: ['NOT_FOUND', 'UNAUTHORIZED'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const analysis = analyzeErrorFlow(results[0]);
      const summary = formatErrorSummary(analysis);

      expect(summary).toContain("## Error Flow Summary");
      expect(summary).toContain("**Total Steps:** 1");
      expect(summary).toContain("**Total Error Types:** 2");
      expect(summary).toContain("`NOT_FOUND`");
      expect(summary).toContain("`UNAUTHORIZED`");
    });
  });
});
