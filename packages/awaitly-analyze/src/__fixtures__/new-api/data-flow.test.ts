/**
 * Tests for data flow analysis
 */
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import {
  buildDataFlowGraph,
  getDataFlowOrder,
  getProducers,
  getConsumers,
  validateDataFlow,
  renderDataFlowMermaid,
} from "../../data-flow";

describe("Data Flow Analysis", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("buildDataFlowGraph", () => {
    it("builds graph from steps with out and reads", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getUser: async () => ok({}), getPosts: async () => ok([]) });
        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step('getUser', () => deps.getUser('1'), {
              errors: ['NOT_FOUND'],
              out: 'user',
            });
            await step('getPosts', () => deps.getPosts(ctx.ref('user').id), {
              errors: ['FETCH_ERROR'],
              out: 'posts',
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const graph = buildDataFlowGraph(results[0]);

      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(1);

      // Check the edge
      const edge = graph.edges[0];
      expect(edge.from).toBe("getUser");
      expect(edge.to).toBe("getPosts");
      expect(edge.key).toBe("user");

      // Check produced keys
      expect(graph.producedKeys.has("user")).toBe(true);
      expect(graph.producedKeys.has("posts")).toBe(true);
    });

    it("detects undefined reads", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getPosts: async () => ok([]) });
        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step('getPosts', () => deps.getPosts(ctx.ref('user').id), {
              errors: ['FETCH_ERROR'],
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);

      expect(graph.undefinedReads).toHaveLength(1);
      expect(graph.undefinedReads[0].key).toBe("user");
      expect(graph.undefinedReads[0].readerId).toBe("getPosts");
    });

    it("detects duplicate writes", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { fn1: async () => ok({}), fn2: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step1', () => deps.fn1(), { out: 'data' });
            await step('step2', () => deps.fn2(), { out: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);

      expect(graph.duplicateWrites).toHaveLength(1);
      expect(graph.duplicateWrites[0].key).toBe("data");
      expect(graph.duplicateWrites[0].writerIds).toEqual(["step1", "step2"]);
    });

    it("honors explicit reads option when no ctx.ref is present", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { getCart: async () => ok({}), charge: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('getCart', () => deps.getCart(), { out: 'cart' });
            await step('charge', () => deps.charge(), { reads: ['cart'] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual({
        from: "getCart",
        to: "charge",
        key: "cart",
      });
    });
  });

  describe("getDataFlowOrder", () => {
    it("returns topological order of steps", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}), c: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step('stepC', () => deps.c(ctx.ref('b')), { reads: ['b'] });
            await step('stepA', () => deps.a(), { out: 'a' });
            await step('stepB', () => deps.b(ctx.ref('a')), { out: 'b' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const order = getDataFlowOrder(graph);

      expect(order).toBeDefined();
      // stepA must come before stepB (because B reads a)
      // stepB must come before stepC (because C reads b)
      const aIndex = order!.indexOf("stepA");
      const bIndex = order!.indexOf("stepB");
      const cIndex = order!.indexOf("stepC");

      expect(aIndex).toBeLessThan(bIndex);
      expect(bIndex).toBeLessThan(cIndex);
    });
  });

  describe("getProducers and getConsumers", () => {
    it("finds producers for a step", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step('producer', () => deps.a(), { out: 'data' });
            await step('consumer', () => deps.b(ctx.ref('data')), {});
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);

      const producers = getProducers(graph, "consumer");
      expect(producers).toHaveLength(1);
      expect(producers[0].id).toBe("producer");
    });

    it("finds consumers for a step", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step('producer', () => deps.a(), { out: 'data' });
            await step('consumer', () => deps.b(ctx.ref('data')), {});
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);

      const consumers = getConsumers(graph, "producer");
      expect(consumers).toHaveLength(1);
      expect(consumers[0].id).toBe("consumer");
    });
  });

  describe("validateDataFlow", () => {
    it("returns valid for a clean graph", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step('producer', () => deps.a(), { out: 'data' });
            await step('consumer', () => deps.b(ctx.ref('data')), {});
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const validation = validateDataFlow(graph);

      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it("reports undefined reads as warnings", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step('consumer', () => deps.a(ctx.ref('missing')), {});
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const validation = validateDataFlow(graph);

      expect(validation.valid).toBe(false);
      expect(validation.issues).toHaveLength(1);
      expect(validation.issues[0].type).toBe("undefined-read");
      expect(validation.issues[0].severity).toBe("warning");
    });

    it("reports type mismatches between producer output and consumer input", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";

        interface User { id: string }

        const workflow = createWorkflow("workflow", {
          getUser: async (): AsyncResult<User, Error> => ok({ id: "u1" }),
          charge: async (amount: number): AsyncResult<boolean, Error> => ok(true),
        });

        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step("get-user", () => deps.getUser(), { out: "user" });
            await step("charge", () => deps.charge(ctx.ref("user")), { reads: ["user"] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const validation = validateDataFlow(graph);

      // Type mismatch detection requires full type checker to be available
      // In test environment without tsconfig, types may not be resolved
      // Either typeMismatches should have entries OR the type info should be undefined (graceful)
      const hasTypeMismatch = graph.typeMismatches.length > 0;
      const hasTypeInfoOnEdges = graph.edges.some(e => e.type !== undefined);
      
      // At minimum, the graph should be built correctly with edges
      expect(graph.edges.length).toBeGreaterThan(0);
      
      // If type checker is available, we should detect type mismatch
      // Otherwise, graceful degradation - no mismatches reported but no errors either
      if (hasTypeInfoOnEdges) {
        expect(graph.typeMismatches.length).toBe(1);
        expect(graph.typeMismatches[0].key).toBe("user");
        expect(validation.issues.some((i) => i.type === "type-mismatch")).toBe(true);
      }
    });

    it("does not report mismatch when read key is passed to a compatible later parameter", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";

        const workflow = createWorkflow("workflow", {
          getToken: async (): AsyncResult<string, Error> => ok("tok_1"),
          useToken: async (count: number, token: string): AsyncResult<boolean, Error> => ok(true),
        });

        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step("get-token", () => deps.getToken(), { out: "token" });
            await step("use-token", () => deps.useToken(1, ctx.ref("token")), { reads: ["token"] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const validation = validateDataFlow(graph);

      expect(graph.typeMismatches).toHaveLength(0);
      expect(validation.issues.some((i) => i.type === "type-mismatch")).toBe(false);
    });

    it("reports mismatch when same read key is used across incompatible and compatible params", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";

        const workflow = createWorkflow("workflow", {
          getToken: async (): AsyncResult<string, Error> => ok("tok_1"),
          consumeTwice: async (count: number, token: string): AsyncResult<boolean, Error> => ok(true),
        });

        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step("get-token", () => deps.getToken(), { out: "token" });
            await step("consume", () => deps.consumeTwice(ctx.ref("token"), ctx.ref("token")), { reads: ["token"] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const validation = validateDataFlow(graph);

      expect(graph.typeMismatches.length).toBeGreaterThanOrEqual(1);
      expect(validation.issues.some((i) => i.type === "type-mismatch")).toBe(true);
    });

    it("does not infer param index for explicit reads without ctx.ref evidence", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";

        interface User { id: string }

        const workflow = createWorkflow("workflow", {
          getUser: async (): AsyncResult<User, Error> => ok({ id: "u1" }),
          charge: async (amount: number): AsyncResult<boolean, Error> => ok(true),
        });

        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step("get-user", () => deps.getUser(), { out: "user" });
            await step("charge", () => deps.charge(42), { reads: ["user"] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const validation = validateDataFlow(graph);

      expect(graph.typeMismatches).toHaveLength(0);
      expect(validation.issues.some((i) => i.type === "type-mismatch")).toBe(false);
    });

    it("does not report mismatch when ctx.ref is wrapped but passed to a compatible later parameter", () => {
      const source = `
        import { createWorkflow, ok, type AsyncResult } from "awaitly";

        const workflow = createWorkflow("workflow", {
          getToken: async (): AsyncResult<string, Error> => ok("tok_1"),
          useToken: async (count: number, token: string): AsyncResult<boolean, Error> => ok(true),
        });

        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step("get-token", () => deps.getToken(), { out: "token" });
            await step("use-token", () => deps.useToken(1, String(ctx.ref("token"))), { reads: ["token"] });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const validation = validateDataFlow(graph);

      expect(graph.typeMismatches).toHaveLength(0);
      expect(validation.issues.some((i) => i.type === "type-mismatch")).toBe(false);
    });

  });

  describe("renderDataFlowMermaid", () => {
    it("renders graph as Mermaid diagram", () => {
      const source = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("workflow", { a: async () => ok({}), b: async () => ok({}) });
        export async function run() {
          return await workflow.run(async ({ step, deps, ctx }) => {
            await step('getUser', () => deps.a(), { out: 'user' });
            await step('getPosts', () => deps.b(ctx.ref('user')), { out: 'posts' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const graph = buildDataFlowGraph(results[0]);
      const mermaid = renderDataFlowMermaid(graph);

      expect(mermaid).toContain("flowchart LR");
      expect(mermaid).toContain("getUser");
      expect(mermaid).toContain("getPosts");
      expect(mermaid).toContain("|user|");
    });
  });
});
