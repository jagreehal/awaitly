/**
 * Tests for markdown documentation generator
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import { generateDocs } from "../../output/docs";

describe("Markdown Documentation Generator", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("generateDocs", () => {
    it("generates basic documentation", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step('getUser', () => deps.getUser('1'), {
              errors: ['NOT_FOUND'],
              out: 'user',
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const docs = generateDocs(results[0]);

      expect(docs).toContain("# workflow");
      expect(docs).toContain("## Overview");
      expect(docs).toContain("**Steps:** 1");
      expect(docs).toContain("## Steps");
      expect(docs).toContain("getUser");
      expect(docs).toContain("NOT_FOUND");
    });

    it("includes data flow section", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps, ctx }) => {
            await step('getUser', () => deps.a(), { out: 'user' });
            await step('getPosts', () => deps.b(ctx.ref('user')), { out: 'posts' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const docs = generateDocs(results[0]);

      expect(docs).toContain("## Data Flow");
      expect(docs).toContain("getUser");
      expect(docs).toContain("getPosts");
      expect(docs).toContain("user");
    });

    it("includes error flow section", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step('step1', () => deps.a(), { errors: ['ERROR_A', 'ERROR_B'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const docs = generateDocs(results[0]);

      expect(docs).toContain("## Error Types");
      expect(docs).toContain("ERROR_A");
      expect(docs).toContain("ERROR_B");
    });

    it("includes Mermaid diagram", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step('step1', () => deps.a());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const docs = generateDocs(results[0]);

      expect(docs).toContain("## Flow Diagram");
      expect(docs).toContain("```mermaid");
      expect(docs).toContain("flowchart TB");
    });

    it("can use custom title", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step('step1', () => deps.a());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const docs = generateDocs(results[0], { title: "My Custom Workflow" });

      expect(docs).toContain("# My Custom Workflow");
    });

    it("can disable sections", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step('step1', () => deps.a());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const docs = generateDocs(results[0], {
        includeDataFlow: false,
        includeErrorFlow: false,
        includeMermaid: false,
      });

      expect(docs).not.toContain("## Data Flow");
      expect(docs).not.toContain("## Error Types");
      expect(docs).not.toContain("```mermaid");
    });

    it("shows dependencies section", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}), getPosts: async () => ok([]) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step('step1', () => deps.getUser());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const docs = generateDocs(results[0]);

      expect(docs).toContain("## Dependencies");
      expect(docs).toContain("getUser");
      expect(docs).toContain("getPosts");
    });
  });
});
