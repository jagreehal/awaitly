/**
 * Tests for new API patterns in the analyzer
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";

describe("New API patterns", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("step('id', fn, opts) signature", () => {
    it("extracts stepId from first argument", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchUser: async () => ok({}) });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getUser', () => deps.fetchUser('1'), { errors: ['NOT_FOUND'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const stepNode = results[0].root.children[0];
      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.stepId).toBe("getUser");
        expect(stepNode.name).toBe("getUser");
      }
    });

    it("extracts errors array from options", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchUser: async () => ok({}) });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getUser', () => deps.fetchUser('1'), {
              errors: ['NOT_FOUND', 'UNAUTHORIZED'],
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const stepNode = results[0].root.children[0];
      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.errors).toEqual(["NOT_FOUND", "UNAUTHORIZED"]);
      }
    });

    it("extracts out key for data flow", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchUser: async () => ok({}) });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getUser', () => deps.fetchUser('1'), {
              errors: ['NOT_FOUND'],
              out: 'user',
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const stepNode = results[0].root.children[0];
      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.out).toBe("user");
      }
    });

    it("extracts ctx.ref() reads", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchPosts: async () => ok([]) });
        export async function run() {
          return await workflow(async (step, deps, ctx) => {
            await step('getPosts', () => deps.fetchPosts(ctx.ref('user').id), {
              errors: ['FETCH_ERROR'],
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const stepNode = results[0].root.children[0];
      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.reads).toEqual(["user"]);
      }
    });

    it("treats non-literal stepId as dynamic but still parses operation", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchUser: async () => ok({}) });
        const stepId = "getUser";
        export async function run() {
          return await workflow(async (step, deps) => {
            await step(stepId, () => deps.fetchUser('1'), { errors: ['NOT_FOUND'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const stepNode = results[0].root.children[0];
      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.stepId).toBe("<dynamic>");
        expect(stepNode.callee).toBe("deps.fetchUser");
      }
    });

    it("accepts no-substitution template literal as stepId", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchUser: async () => ok({}) });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step(\`getUser\`, () => deps.fetchUser('1'), { errors: ['NOT_FOUND'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const stepNode = results[0].root.children[0];
      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.stepId).toBe("getUser");
        expect(stepNode.name).toBe("getUser");
      }
    });
  });

  describe("step.if() for labelled conditionals", () => {
    it("extracts decision node with id and conditionLabel", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchUser: async () => ok({ isPremium: true }) });
        export async function run() {
          return await workflow(async (step, deps) => {
            const user = { isPremium: true };
            if (step.if('user-type', 'user.isPremium', () => user.isPremium)) {
              await step('premium', () => ok(1));
            } else {
              await step('free', () => ok(2));
            }
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      // Find the decision node
      const decisionNode = results[0].root.children.find(n => n.type === "decision");
      expect(decisionNode).toBeDefined();

      if (decisionNode && decisionNode.type === "decision") {
        expect(decisionNode.decisionId).toBe("user-type");
        expect(decisionNode.conditionLabel).toBe("user.isPremium");
        expect(decisionNode.consequent.length).toBeGreaterThan(0);
        expect(decisionNode.alternate?.length).toBeGreaterThan(0);
      }
    });
  });

  describe("step.label() for labelled conditionals (alias for step.if)", () => {
    it("extracts decision node with id and conditionLabel using step.label", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchUser: async () => ok({ isPremium: true }) });
        export async function run() {
          return await workflow(async (step, deps) => {
            const user = { isPremium: true };
            if (step.label('premium-check', 'user.isPremium', () => user.isPremium)) {
              await step('premium', () => ok(1));
            } else {
              await step('free', () => ok(2));
            }
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      // Find the decision node
      const decisionNode = results[0].root.children.find(n => n.type === "decision");
      expect(decisionNode).toBeDefined();

      if (decisionNode && decisionNode.type === "decision") {
        expect(decisionNode.decisionId).toBe("premium-check");
        expect(decisionNode.conditionLabel).toBe("user.isPremium");
        expect(decisionNode.consequent.length).toBeGreaterThan(0);
        expect(decisionNode.alternate?.length).toBeGreaterThan(0);
      }
    });
  });

  describe("step.branch() for explicit conditional metadata", () => {
    it("extracts decision node with conditionLabel and branches", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ chargeCard: async () => ok({}), skipPayment: async () => ok({}) });
        export async function run() {
          return await workflow(async (step, deps) => {
            const cart = { total: 100 };
            const charge = await step.branch('payment', {
              conditionLabel: 'cart.total > 0',
              condition: () => cart.total > 0,
              then: () => deps.chargeCard(cart.total),
              thenErrors: ['CARD_DECLINED'],
              else: () => deps.skipPayment(),
              elseErrors: [],
            });
            return charge;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      // Find the decision node
      const decisionNode = results[0].root.children.find(n => n.type === "decision");
      expect(decisionNode).toBeDefined();

      if (decisionNode && decisionNode.type === "decision") {
        expect(decisionNode.decisionId).toBe("payment");
        expect(decisionNode.conditionLabel).toBe("cart.total > 0");
        expect(decisionNode.consequent.length).toBeGreaterThan(0);
        expect(decisionNode.alternate?.length).toBeGreaterThan(0);

        // Check that errors are attached to branch steps
        if (decisionNode.consequent[0]?.type === "step") {
          expect(decisionNode.consequent[0].errors).toEqual(["CARD_DECLINED"]);
        }
        // Empty elseErrors: [] is an explicit declaration of no errors (not "undefined")
        if (decisionNode.alternate?.[0]?.type === "step") {
          expect(decisionNode.alternate[0].errors).toEqual([]);
        }
      }
    });

    it("extracts out key for data flow from step.branch", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ process: async () => ok(1), skip: async () => ok(0) });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step.branch('decide', {
              conditionLabel: 'shouldProcess',
              condition: () => true,
              out: 'result',
              then: () => deps.process(),
              else: () => deps.skip(),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const decisionNode = results[0].root.children.find(n => n.type === "decision");
      expect(decisionNode).toBeDefined();

      if (decisionNode && decisionNode.type === "decision") {
        // Check that out is attached to branch steps
        if (decisionNode.consequent[0]?.type === "step") {
          expect(decisionNode.consequent[0].out).toBe("result");
        }
        if (decisionNode.alternate?.[0]?.type === "step") {
          expect(decisionNode.alternate[0].out).toBe("result");
        }
      }
    });
  });

  describe("tags() helper for errors", () => {
    it("extracts errors from tags() call", () => {
      const source = `
        import { createWorkflow, ok, tags } from "awaitly";
        const cartErrors = tags('CART_NOT_FOUND', 'CART_EMPTY');
        const workflow = createWorkflow({ getCart: async () => ok({}) });
        export async function run() {
          return await workflow(async (step, deps) => {
            await step('getCart', () => deps.getCart('1'), { errors: cartErrors });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const stepNode = results[0].root.children[0];
      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.errors).toEqual(["CART_NOT_FOUND", "CART_EMPTY"]);
      }
    });
  });

  describe("explicit ID API", () => {
    it("extracts stepId from step(id, fn, opts?) signature", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow({ fetchUser: async () => ok({}) });
        export async function run() {
          return await workflow(async (step, deps) => {
            // New API: step(id, fn, opts?)
            await step('getUser', () => deps.fetchUser('1'), { key: 'user:1' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const stepNode = results[0].root.children[0];
      expect(stepNode.type).toBe("step");
      if (stepNode.type === "step") {
        expect(stepNode.name).toBe("getUser");
        expect(stepNode.key).toBe("user:1");
        // stepId should be "getUser" for new API with explicit ID
        expect(stepNode.stepId).toBe("getUser");
      }
    });
  });
});
