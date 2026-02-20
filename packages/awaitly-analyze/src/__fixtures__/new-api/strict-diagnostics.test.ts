/**
 * Tests for strict mode diagnostics
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import {
  validateStrict,
  formatDiagnostics,
  getSummary,
} from "../../strict-diagnostics";

describe("Strict Mode Diagnostics", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("validateStrict", () => {
    it("passes for fully compliant workflow", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), {
              errors: ['NOT_FOUND'],
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("warns on legacy step signature", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step(() => deps.getUser('1'), { name: 'getUser' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const legacyWarning = validation.diagnostics.find(
        (d) => d.rule === "missing-step-id"
      );
      expect(legacyWarning).toBeDefined();
      expect(legacyWarning?.severity).toBe("warning");
    });

    it("warns on missing errors declaration", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const missingErrorsWarning = validation.diagnostics.find(
        (d) => d.rule === "missing-errors"
      );
      expect(missingErrorsWarning).toBeDefined();
      expect(missingErrorsWarning?.fix).toContain("errors:");
    });

    it("does not warn when errors are explicitly empty", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), { errors: [] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const missingErrorsWarning = validation.diagnostics.find(
        (d) => d.rule === "missing-errors"
      );
      expect(missingErrorsWarning).toBeUndefined();
    });

    it("can treat warnings as errors", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0], { warningsAsErrors: true });

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it("can disable specific checks", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step(() => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0], {
        requireStepId: false,
        requireErrors: false,
      });

      expect(validation.diagnostics).toHaveLength(0);
    });
  });

  describe("formatDiagnostics", () => {
    it("formats passing result", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), { errors: [] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);
      const formatted = formatDiagnostics(validation);

      expect(formatted).toContain("✓");
      expect(formatted).toContain("passes");
    });

    it("formats failing result with fix suggestions", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step(() => deps.getUser('1'));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);
      const formatted = formatDiagnostics(validation);

      expect(formatted).toContain("Fix:");
    });
  });

  describe("getSummary", () => {
    it("returns concise summary", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), { errors: [] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);
      const summary = getSummary(validation);

      expect(summary).toContain("✓");
      expect(summary.toLowerCase()).toContain("passed");
    });
  });

  describe("parallel-missing-errors", () => {
    it("warns on parallel branches without errors in shorthand form", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { fetchUser: async () => ok({}), fetchPosts: async () => ok([]) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            const { user, posts } = await step.parallel("Fetch user and posts", {
              user: () => deps.fetchUser("1"),
              posts: () => deps.fetchPosts("1"),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const parallelWarnings = validation.diagnostics.filter(
        (d) => d.rule === "parallel-missing-errors"
      );
      expect(parallelWarnings.length).toBeGreaterThan(0);
      expect(parallelWarnings[0].fix).toContain("{ fn:");
    });

    it("passes for parallel branches with canonical { fn, errors } form", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { fetchUser: async () => ok({}), fetchPosts: async () => ok([]) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            const { user, posts } = await step.parallel("Fetch user and posts", {
              user: { fn: () => deps.fetchUser("1"), errors: ['NOT_FOUND'] },
              posts: { fn: () => deps.fetchPosts("1"), errors: ['FETCH_ERROR'] },
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const parallelWarnings = validation.diagnostics.filter(
        (d) => d.rule === "parallel-missing-errors"
      );
      expect(parallelWarnings).toHaveLength(0);
    });
  });

  describe("loop-missing-collect", () => {
    it("warns on step.forEach with out but no collect option", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step.forEach('process', items, {
              errors: ['PROCESS_ERROR'],
              out: 'results',
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const loopWarning = validation.diagnostics.find(
        (d) => d.rule === "loop-missing-collect"
      );
      expect(loopWarning).toBeDefined();
      expect(loopWarning?.fix).toContain("collect:");
    });

    it("passes for step.forEach with out and collect option", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step.forEach('process', items, {
              errors: ['PROCESS_ERROR'],
              out: 'results',
              collect: 'array',
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const loopWarning = validation.diagnostics.find(
        (d) => d.rule === "loop-missing-collect"
      );
      expect(loopWarning).toBeUndefined();
    });

    it("passes for step.forEach without out option", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { processItem: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step.forEach('process', items, {
              errors: ['PROCESS_ERROR'],
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const validation = validateStrict(results[0]);

      const loopWarning = validation.diagnostics.find(
        (d) => d.rule === "loop-missing-collect"
      );
      expect(loopWarning).toBeUndefined();
    });
  });
});
