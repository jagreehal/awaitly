/**
 * Tests for step.parallel() strict mode form
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import type { StaticParallelNode, StaticStepNode } from "../../types";

describe("step.parallel() Strict Mode", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("{ fn, errors } form", () => {
    it("extracts errors from strict parallel form", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { fetchUser: async () => ok({}), fetchPosts: async () => ok([]) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            const { user, posts } = await step.parallel("Fetch user and posts", {
              user: { fn: () => deps.fetchUser("1"), errors: ['NOT_FOUND'] },
              posts: { fn: () => deps.fetchPosts("1"), errors: ['FETCH_ERROR'] },
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const parallelNode = results[0].root.children[0] as StaticParallelNode;
      expect(parallelNode.type).toBe("parallel");
      expect(parallelNode.children).toHaveLength(2);

      const userStep = parallelNode.children.find(c => c.name === "user") as StaticStepNode;
      expect(userStep).toBeDefined();
      expect(userStep.errors).toEqual(["NOT_FOUND"]);

      const postsStep = parallelNode.children.find(c => c.name === "posts") as StaticStepNode;
      expect(postsStep).toBeDefined();
      expect(postsStep.errors).toEqual(["FETCH_ERROR"]);
    });

    it("works with tags() helper in errors", () => {
      const source = `
        import { createWorkflow, ok, tags } from "awaitly";
        const userErrors = tags('NOT_FOUND', 'UNAUTHORIZED');
        const workflow = createWorkflow("workflow", { fetchUser: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            const { user } = await step.parallel("Fetch user", {
              user: { fn: () => deps.fetchUser("1"), errors: userErrors },
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const parallelNode = results[0].root.children[0] as StaticParallelNode;
      const userStep = parallelNode.children[0] as StaticStepNode;

      expect(userStep.errors).toEqual(["NOT_FOUND", "UNAUTHORIZED"]);
    });
  });

  describe("mixed forms", () => {
    it("handles shorthand form without errors", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { fetchUser: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            const { user } = await step.parallel("Fetch user", {
              user: () => deps.fetchUser("1"),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const parallelNode = results[0].root.children[0] as StaticParallelNode;
      const userStep = parallelNode.children[0] as StaticStepNode;

      expect(userStep.name).toBe("user");
      expect(userStep.errors).toBeUndefined();
    });
  });

  describe("with parallel name", () => {
    it("extracts parallel name from options", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow(async ({ step, deps }) => {
            await step.parallel("Fetch user data", {
              a: { fn: () => deps.a(), errors: [] },
              b: { fn: () => deps.b(), errors: [] },
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const parallelNode = results[0].root.children[0] as StaticParallelNode;

      expect(parallelNode.name).toBe("Fetch user data");
    });
  });
});
