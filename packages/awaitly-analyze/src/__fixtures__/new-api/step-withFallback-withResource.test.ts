/**
 * Static Analyzer Tests for step.withFallback() and step.withResource()
 *
 * Tests detection, callee assignment, label rendering (Mermaid/DSL),
 * and interaction with other step methods.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import { renderStaticMermaid } from "../../output/mermaid";
import { renderWorkflowDSL } from "../../output/dsl";
import type {
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticConditionalNode,
  StaticLoopNode,
} from "../../types";
import { getStaticChildren } from "../../types";

function collectStepNodes(root: { children: StaticFlowNode[] }): StaticStepNode[] {
  const steps: StaticStepNode[] = [];
  function walk(n: StaticFlowNode) {
    if (n.type === "step") steps.push(n as StaticStepNode);
    for (const c of getStaticChildren(n)) walk(c);
  }
  for (const c of root.children) walk(c);
  return steps;
}

function collectAllNodes(root: { children: StaticFlowNode[] }): StaticFlowNode[] {
  const nodes: StaticFlowNode[] = [];
  function walk(n: StaticFlowNode) {
    nodes.push(n);
    for (const c of getStaticChildren(n)) walk(c);
  }
  for (const c of root.children) walk(c);
  return nodes;
}

// =============================================================================
// step.withFallback
// =============================================================================

describe("step.withFallback static analysis", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("detects basic step.withFallback and sets callee", () => {
    const source = `
      const workflow = createWorkflow("fallback-test", {
        fetchUser: async (id: string) => ({ id, name: "Alice" }),
        fetchUserFromCache: async (id: string) => ({ id, name: "Alice (cached)" }),
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const user = await step.withFallback(
            "getUser",
            () => deps.fetchUser("1"),
            { fallback: () => deps.fetchUserFromCache("1") }
          );
          return user;
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    expect(results).toHaveLength(1);

    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe("step");
    expect(steps[0].stepId).toBe("getUser");
    expect(steps[0].callee).toBe("step.withFallback");
  });

  it("detects step.withFallback with on filter", () => {
    const source = `
      const workflow = createWorkflow("fallback-on-test", {
        fetchUser: async (id: string) => ({ id }),
        fetchDefault: async () => ({ id: "default" }),
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const user = await step.withFallback(
            "getUserWithFilter",
            () => deps.fetchUser("1"),
            {
              on: "NOT_FOUND",
              fallback: () => deps.fetchDefault(),
            }
          );
          return user;
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepId).toBe("getUserWithFilter");
    expect(steps[0].callee).toBe("step.withFallback");
  });

  it("detects step.withFallback with cache key option", () => {
    const source = `
      const workflow = createWorkflow("fallback-cache-test", {
        primary: async () => "result",
        secondary: async () => "fallback",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.withFallback(
            "cachedFallback",
            () => deps.primary(),
            {
              fallback: () => deps.secondary(),
              key: "user-cache",
            }
          );
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepId).toBe("cachedFallback");
    expect(steps[0].callee).toBe("step.withFallback");
    expect(steps[0].key).toBe("user-cache");
  });

  it("detects step.withFallback with dep source", () => {
    const source = `
      const workflow = createWorkflow("fallback-dep-test", {
        fetchUser: async (id: string) => ({ id }),
        fetchUserFallback: async (id: string) => ({ id }),
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.withFallback(
            "getUserDep",
            () => deps.fetchUser("1"),
            { fallback: () => deps.fetchUserFallback("1") }
          );
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].depSource).toBe("fetchUser");
  });

  it("detects multiple step.withFallback calls in sequence", () => {
    const source = `
      const workflow = createWorkflow("multi-fallback", {
        fetchUser: async () => ({ id: "1" }),
        fetchUserFallback: async () => ({ id: "default" }),
        fetchPosts: async () => [],
        fetchPostsFallback: async () => [],
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const user = await step.withFallback(
            "getUser",
            () => deps.fetchUser(),
            { fallback: () => deps.fetchUserFallback() }
          );
          const posts = await step.withFallback(
            "getPosts",
            () => deps.fetchPosts(),
            { fallback: () => deps.fetchPostsFallback() }
          );
          return { user, posts };
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(2);
    expect(steps[0].stepId).toBe("getUser");
    expect(steps[0].callee).toBe("step.withFallback");
    expect(steps[1].stepId).toBe("getPosts");
    expect(steps[1].callee).toBe("step.withFallback");
  });

  it("detects step.withFallback inside if/else", () => {
    const source = `
      const workflow = createWorkflow("fallback-conditional", {
        fetchPremium: async () => "premium",
        fetchPremiumFallback: async () => "cached-premium",
        fetchFree: async () => "free",
        fetchFreeFallback: async () => "cached-free",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const isPremium = true;
          if (isPremium) {
            return await step.withFallback(
              "premiumData",
              () => deps.fetchPremium(),
              { fallback: () => deps.fetchPremiumFallback() }
            );
          } else {
            return await step.withFallback(
              "freeData",
              () => deps.fetchFree(),
              { fallback: () => deps.fetchFreeFallback() }
            );
          }
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.stepId).sort()).toEqual(["freeData", "premiumData"]);
    expect(steps.every((s) => s.callee === "step.withFallback")).toBe(true);
  });

  it("detects step.withFallback inside step.parallel", () => {
    const source = `
      const workflow = createWorkflow("fallback-parallel", {
        fetchA: async () => "a",
        fetchAFallback: async () => "a-fallback",
        fetchB: async () => "b",
        fetchBFallback: async () => "b-fallback",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.parallel("parallel-fallbacks", {
            a: () => step.withFallback("getA", () => deps.fetchA(), { fallback: () => deps.fetchAFallback() }),
            b: () => step.withFallback("getB", () => deps.fetchB(), { fallback: () => deps.fetchBFallback() }),
          });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    const fallbackSteps = steps.filter((s) => s.callee === "step.withFallback");
    expect(fallbackSteps.length).toBeGreaterThanOrEqual(2);
  });

  it("detects step.withFallback inside for loop", () => {
    const source = `
      const workflow = createWorkflow("fallback-loop", {
        fetchItem: async (id: number) => ({ id }),
        fetchItemFallback: async (id: number) => ({ id, cached: true }),
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          for (let i = 0; i < 3; i++) {
            await step.withFallback(
              "getItem",
              () => deps.fetchItem(i),
              { fallback: () => deps.fetchItemFallback(i) }
            );
          }
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const allNodes = collectAllNodes(results[0].root);
    const loopNodes = allNodes.filter((n) => n.type === "loop");
    expect(loopNodes.length).toBe(1);

    const loopBody = (loopNodes[0] as StaticLoopNode).body;
    const stepsInLoop = collectStepNodes({ children: loopBody });
    expect(stepsInLoop.length).toBe(1);
    expect(stepsInLoop[0].callee).toBe("step.withFallback");
  });

  it("counts step.withFallback in totalSteps stat", () => {
    const source = `
      const workflow = createWorkflow("fallback-stats", {
        primary: async () => "ok",
        fallback: async () => "fallback",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          await step.withFallback(
            "op1",
            () => deps.primary(),
            { fallback: () => deps.fallback() }
          );
          await step.withFallback(
            "op2",
            () => deps.primary(),
            { fallback: () => deps.fallback() }
          );
          await step("regular", () => deps.primary());
          return "done";
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    expect(results[0].metadata.stats.totalSteps).toBe(3);
  });

  it("Mermaid output includes (Fallback) suffix", () => {
    const source = `
      const workflow = createWorkflow("fallback-mermaid", {
        primary: async () => "ok",
        secondary: async () => "fallback",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.withFallback(
            "getUser",
            () => deps.primary(),
            { fallback: () => deps.secondary() }
          );
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const mermaid = renderStaticMermaid(results[0]);
    expect(mermaid).toContain("(Fallback)");
    expect(mermaid).toContain("getUser");
  });

  it("DSL output includes (Fallback) suffix in label", () => {
    const source = `
      const workflow = createWorkflow("fallback-dsl", {
        primary: async () => "ok",
        secondary: async () => "fallback",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.withFallback(
            "getUser",
            () => deps.primary(),
            { fallback: () => deps.secondary() }
          );
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const dsl = renderWorkflowDSL(results[0]);
    const stepStates = dsl.states.filter((s) => s.type === "step");
    expect(stepStates.some((s) => s.label.includes("(Fallback)"))).toBe(true);
  });

  it("mixed step methods: withFallback alongside try, retry, withTimeout", () => {
    const source = `
      const { createWorkflow } = await import("awaitly");
      const w = createWorkflow("mixed", {});
      async function run() {
        return await w(async ({ step, deps }) => {
          await step.try("try-op", () => deps.risky());
          await step.retry("retry-op", () => deps.fetch(), { attempts: 3 });
          await step.withTimeout("timeout-op", () => deps.slow(), { ms: 5000 });
          await step.withFallback("fallback-op", () => deps.primary(), { fallback: () => deps.secondary() });
          await step("plain-step", () => deps.basic());
        });
      }
    `;

    const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(5);

    const callees = steps.map((s) => s.callee);
    expect(callees).toContain("step.try");
    expect(callees).toContain("step.retry");
    expect(callees).toContain("step.withTimeout");
    expect(callees).toContain("step.withFallback");

    const mermaid = renderStaticMermaid(results[0]);
    expect(mermaid).toContain("(Try)");
    expect(mermaid).toContain("(Retry: 3)");
    expect(mermaid).toContain("(Timeout: 5000ms)");
    expect(mermaid).toContain("(Fallback)");
  });

  it("detects step.withFallback with dynamic step id (template literal)", () => {
    const source = `
      const workflow = createWorkflow("dynamic-id", {
        primary: async () => "ok",
        secondary: async () => "fallback",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const userId = "123";
          return await step.withFallback(
            \`getUser-\${userId}\`,
            () => deps.primary(),
            { fallback: () => deps.secondary() }
          );
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].callee).toBe("step.withFallback");
    expect(steps[0].stepId).toBe("<dynamic>");
  });

  it("detects step.withFallback in try/catch block", () => {
    const source = `
      const workflow = createWorkflow("fallback-trycatch", {
        primary: async () => "ok",
        fallback: async () => "fallback",
        cleanup: async () => "cleaned",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          try {
            return await step.withFallback(
              "tryFallback",
              () => deps.primary(),
              { fallback: () => deps.fallback() }
            );
          } catch {
            return await step("cleanup", () => deps.cleanup());
          }
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.some((s) => s.callee === "step.withFallback" && s.stepId === "tryFallback")).toBe(true);
    expect(steps.some((s) => s.stepId === "cleanup")).toBe(true);
  });
});

// =============================================================================
// step.withResource
// =============================================================================

describe("step.withResource static analysis", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("detects basic step.withResource and sets callee", () => {
    const source = `
      const workflow = createWorkflow("resource-test", {
        openConnection: async () => ({ conn: "db-123" }),
        query: async (conn: string) => ({ results: [] }),
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const result = await step.withResource("useDb", {
            acquire: () => deps.openConnection(),
            use: (db) => deps.query(db.conn),
            release: (db) => { /* close connection */ },
          });
          return result;
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    expect(results).toHaveLength(1);

    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].type).toBe("step");
    expect(steps[0].stepId).toBe("useDb");
    expect(steps[0].callee).toBe("step.withResource");
  });

  it("detects step.withResource with async release", () => {
    const source = `
      const workflow = createWorkflow("resource-async-release", {
        acquire: async () => "resource",
        use: async (r: string) => "result",
        release: async (r: string) => {},
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.withResource("managedResource", {
            acquire: () => deps.acquire(),
            use: (resource) => deps.use(resource),
            release: async (resource) => { await deps.release(resource); },
          });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].stepId).toBe("managedResource");
    expect(steps[0].callee).toBe("step.withResource");
  });

  it("detects step.withResource with inline functions", () => {
    const source = `
      const workflow = createWorkflow("resource-inline", {});

      export async function run() {
        return await workflow.run(async ({ step }) => {
          return await step.withResource("inlineResource", {
            acquire: async () => {
              const conn = await fetch("http://db");
              return { ok: true, value: conn };
            },
            use: async (conn) => {
              return { ok: true, value: "queried" };
            },
            release: (conn) => {
              conn.close();
            },
          });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].callee).toBe("step.withResource");
  });

  it("detects multiple step.withResource calls", () => {
    const source = `
      const workflow = createWorkflow("multi-resource", {
        openDb: async () => "db",
        openCache: async () => "cache",
        queryDb: async (db: string) => "data",
        queryCache: async (cache: string) => "cached",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const dbResult = await step.withResource("useDb", {
            acquire: () => deps.openDb(),
            use: (db) => deps.queryDb(db),
            release: () => {},
          });
          const cacheResult = await step.withResource("useCache", {
            acquire: () => deps.openCache(),
            use: (cache) => deps.queryCache(cache),
            release: () => {},
          });
          return { dbResult, cacheResult };
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(2);
    expect(steps[0].stepId).toBe("useDb");
    expect(steps[0].callee).toBe("step.withResource");
    expect(steps[1].stepId).toBe("useCache");
    expect(steps[1].callee).toBe("step.withResource");
  });

  it("detects step.withResource inside if/else", () => {
    const source = `
      const workflow = createWorkflow("resource-conditional", {
        openPremiumDb: async () => "premium-db",
        openFreeDb: async () => "free-db",
        query: async (db: string) => "data",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const isPremium = true;
          if (isPremium) {
            return await step.withResource("premiumDb", {
              acquire: () => deps.openPremiumDb(),
              use: (db) => deps.query(db),
              release: () => {},
            });
          } else {
            return await step.withResource("freeDb", {
              acquire: () => deps.openFreeDb(),
              use: (db) => deps.query(db),
              release: () => {},
            });
          }
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.stepId).sort()).toEqual(["freeDb", "premiumDb"]);
    expect(steps.every((s) => s.callee === "step.withResource")).toBe(true);
  });

  it("detects step.withResource inside for loop", () => {
    const source = `
      const workflow = createWorkflow("resource-loop", {
        openDb: async (shard: number) => ({ shard }),
        query: async (db: { shard: number }) => "data",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          for (let shard = 0; shard < 3; shard++) {
            await step.withResource("queryShard", {
              acquire: () => deps.openDb(shard),
              use: (db) => deps.query(db),
              release: () => {},
            });
          }
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const allNodes = collectAllNodes(results[0].root);
    const loopNodes = allNodes.filter((n) => n.type === "loop");
    expect(loopNodes.length).toBe(1);

    const loopBody = (loopNodes[0] as StaticLoopNode).body;
    const stepsInLoop = collectStepNodes({ children: loopBody });
    expect(stepsInLoop.length).toBe(1);
    expect(stepsInLoop[0].callee).toBe("step.withResource");
  });

  it("counts step.withResource in totalSteps stat", () => {
    const source = `
      const workflow = createWorkflow("resource-stats", {
        acquire: async () => "resource",
        use: async (r: string) => "result",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          await step.withResource("r1", {
            acquire: () => deps.acquire(),
            use: (r) => deps.use(r),
            release: () => {},
          });
          await step.withResource("r2", {
            acquire: () => deps.acquire(),
            use: (r) => deps.use(r),
            release: () => {},
          });
          await step("plain", () => deps.use("x"));
          return "done";
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    expect(results[0].metadata.stats.totalSteps).toBe(3);
  });

  it("Mermaid output includes (Resource) suffix", () => {
    const source = `
      const workflow = createWorkflow("resource-mermaid", {
        acquire: async () => "conn",
        use: async (conn: string) => "result",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.withResource("useDb", {
            acquire: () => deps.acquire(),
            use: (conn) => deps.use(conn),
            release: () => {},
          });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const mermaid = renderStaticMermaid(results[0]);
    expect(mermaid).toContain("(Resource)");
    expect(mermaid).toContain("useDb");
  });

  it("DSL output includes (Resource) suffix in label", () => {
    const source = `
      const workflow = createWorkflow("resource-dsl", {
        acquire: async () => "conn",
        use: async (conn: string) => "result",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.withResource("useDb", {
            acquire: () => deps.acquire(),
            use: (conn) => deps.use(conn),
            release: () => {},
          });
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const dsl = renderWorkflowDSL(results[0]);
    const stepStates = dsl.states.filter((s) => s.type === "step");
    expect(stepStates.some((s) => s.label.includes("(Resource)"))).toBe(true);
  });

  it("detects step.withResource with dynamic step id", () => {
    const source = `
      const workflow = createWorkflow("resource-dynamic", {
        acquire: async () => "conn",
        use: async (conn: string) => "result",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const table = "users";
          return await step.withResource(
            \`query-\${table}\`,
            {
              acquire: () => deps.acquire(),
              use: (conn) => deps.use(conn),
              release: () => {},
            }
          );
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(1);
    expect(steps[0].callee).toBe("step.withResource");
    expect(steps[0].stepId).toBe("<dynamic>");
  });

  it("detects step.withResource in try/catch block", () => {
    const source = `
      const workflow = createWorkflow("resource-trycatch", {
        acquire: async () => "conn",
        use: async (conn: string) => "result",
        cleanup: async () => "cleaned",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          try {
            return await step.withResource("tryResource", {
              acquire: () => deps.acquire(),
              use: (conn) => deps.use(conn),
              release: () => {},
            });
          } catch {
            return await step("cleanup", () => deps.cleanup());
          }
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.some((s) => s.callee === "step.withResource" && s.stepId === "tryResource")).toBe(true);
    expect(steps.some((s) => s.stepId === "cleanup")).toBe(true);
  });
});

// =============================================================================
// Combined: step.withFallback + step.withResource together
// =============================================================================

describe("step.withFallback + step.withResource combined", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("detects both in same workflow", () => {
    const source = `
      const workflow = createWorkflow("combined", {
        openDb: async () => "conn",
        query: async (conn: string) => "data",
        fetchUser: async () => ({ id: "1" }),
        fetchUserFallback: async () => ({ id: "default" }),
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const data = await step.withResource("useDb", {
            acquire: () => deps.openDb(),
            use: (conn) => deps.query(conn),
            release: () => {},
          });
          const user = await step.withFallback(
            "getUser",
            () => deps.fetchUser(),
            { fallback: () => deps.fetchUserFallback() }
          );
          return { data, user };
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps).toHaveLength(2);

    const resourceStep = steps.find((s) => s.callee === "step.withResource");
    const fallbackStep = steps.find((s) => s.callee === "step.withFallback");
    expect(resourceStep).toBeDefined();
    expect(resourceStep!.stepId).toBe("useDb");
    expect(fallbackStep).toBeDefined();
    expect(fallbackStep!.stepId).toBe("getUser");
  });

  it("Mermaid includes both (Resource) and (Fallback) suffixes", () => {
    const source = `
      const { createWorkflow } = await import("awaitly");
      const w = createWorkflow("both", {});
      async function run() {
        return await w(async ({ step, deps }) => {
          await step.withResource("useDb", {
            acquire: () => deps.openDb(),
            use: (conn) => deps.query(conn),
            release: () => {},
          });
          await step.withFallback("getUser", () => deps.fetch(), { fallback: () => deps.fetchFallback() });
        });
      }
    `;

    const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
    const mermaid = renderStaticMermaid(results[0]);
    expect(mermaid).toContain("(Resource)");
    expect(mermaid).toContain("(Fallback)");
  });

  it("DSL includes both (Resource) and (Fallback) suffixes", () => {
    const source = `
      const { createWorkflow } = await import("awaitly");
      const w = createWorkflow("both-dsl", {});
      async function run() {
        return await w(async ({ step, deps }) => {
          await step.withResource("useDb", {
            acquire: () => deps.openDb(),
            use: (conn) => deps.query(conn),
            release: () => {},
          });
          await step.withFallback("getUser", () => deps.fetch(), { fallback: () => deps.fetchFallback() });
        });
      }
    `;

    const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
    const dsl = renderWorkflowDSL(results[0]);
    const labels = dsl.states.filter((s) => s.type === "step").map((s) => s.label);
    expect(labels.some((l) => l.includes("(Resource)"))).toBe(true);
    expect(labels.some((l) => l.includes("(Fallback)"))).toBe(true);
  });

  it("all step method kind suffixes in one Mermaid diagram", () => {
    const source = `
      const { createWorkflow } = await import("awaitly");
      const w = createWorkflow("everything", {});
      async function run() {
        return await w(async ({ step, deps }) => {
          await step.sleep("pause", "5s");
          await step.retry("retry-op", () => deps.fetch(), { attempts: 2 });
          await step.withTimeout("timeout-op", () => deps.slow(), { ms: 1000 });
          await step.try("try-op", () => deps.risky(), { error: "ERR" });
          await step.fromResult("fr-op", () => deps.resultOp(), {});
          await step.withFallback("fb-op", () => deps.primary(), { fallback: () => deps.secondary() });
          await step.withResource("res-op", {
            acquire: () => deps.acquire(),
            use: (r) => deps.use(r),
            release: () => {},
          });
          await step("dep-step", step.dep("userService", () => deps.getUser()));
        });
      }
    `;

    const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
    const mermaid = renderStaticMermaid(results[0]);
    expect(mermaid).toContain("(Sleep: 5s)");
    expect(mermaid).toContain("(Retry: 2)");
    expect(mermaid).toContain("(Timeout: 1000ms)");
    expect(mermaid).toContain("(Try)");
    expect(mermaid).toContain("(FromResult)");
    expect(mermaid).toContain("(Fallback)");
    expect(mermaid).toContain("(Resource)");
    expect(mermaid).toContain("dep-step");
  });

  it("all step method kind suffixes in one DSL output", () => {
    const source = `
      const { createWorkflow } = await import("awaitly");
      const w = createWorkflow("everything-dsl", {});
      async function run() {
        return await w(async ({ step, deps }) => {
          await step.sleep("pause", "5s");
          await step.retry("retry-op", () => deps.fetch(), { attempts: 2 });
          await step.withTimeout("timeout-op", () => deps.slow(), { ms: 1000 });
          await step.try("try-op", () => deps.risky(), { error: "ERR" });
          await step.fromResult("fr-op", () => deps.resultOp(), {});
          await step.withFallback("fb-op", () => deps.primary(), { fallback: () => deps.secondary() });
          await step.withResource("res-op", {
            acquire: () => deps.acquire(),
            use: (r) => deps.use(r),
            release: () => {},
          });
          await step("dep-step", step.dep("userService", () => deps.getUser()));
        });
      }
    `;

    const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
    const dsl = renderWorkflowDSL(results[0]);
    const labels = dsl.states.filter((s) => s.type === "step").map((s) => s.label);
    expect(labels.some((l) => l.includes("(Sleep: 5s)"))).toBe(true);
    expect(labels.some((l) => l.includes("(Retry: 2)"))).toBe(true);
    expect(labels.some((l) => l.includes("(Timeout: 1000ms)"))).toBe(true);
    expect(labels.some((l) => l.includes("(Try)"))).toBe(true);
    expect(labels.some((l) => l.includes("(FromResult)"))).toBe(true);
    expect(labels.some((l) => l.includes("(Fallback)"))).toBe(true);
    expect(labels.some((l) => l.includes("(Resource)"))).toBe(true);
    expect(labels.some((l) => l.includes("dep-step"))).toBe(true);
  });

  it("step.withResource nested inside step.withFallback primary", () => {
    const source = `
      const workflow = createWorkflow("nested", {
        openDb: async () => "conn",
        query: async (conn: string) => "data",
        fallbackQuery: async () => "cached",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          return await step.withFallback(
            "resilientQuery",
            () => step.withResource("useDb", {
              acquire: () => deps.openDb(),
              use: (conn) => deps.query(conn),
              release: () => {},
            }),
            { fallback: () => deps.fallbackQuery() }
          );
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.some((s) => s.callee === "step.withFallback")).toBe(true);
    // The nested withResource call may or may not be detected as a separate step
    // depending on how deeply the analyzer walks into callback arguments
  });

  it("detects withFallback and withResource when step is destructured with alias", () => {
    const source = `
      const workflow = createWorkflow("alias-test", {
        primary: async () => "ok",
        secondary: async () => "fallback",
        acquire: async () => "conn",
        use: async (r: string) => "result",
      });

      export async function run() {
        return await workflow.run(async ({ step: s, deps }) => {
          const fallbackResult = await s.withFallback(
            "aliasFallback",
            () => deps.primary(),
            { fallback: () => deps.secondary() }
          );
          const resourceResult = await s.withResource("aliasResource", {
            acquire: () => deps.acquire(),
            use: (r) => deps.use(r),
            release: () => {},
          });
          return { fallbackResult, resourceResult };
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.some((s) => s.callee === "step.withFallback")).toBe(true);
    expect(steps.some((s) => s.callee === "step.withResource")).toBe(true);
  });

  it("switch statement with withFallback/withResource in cases", () => {
    const source = `
      const workflow = createWorkflow("switch-test", {
        fetchUserPrimary: async () => ({ id: "1" }),
        fetchUserFallback: async () => ({ id: "default" }),
        openAdminDb: async () => "admin-conn",
        queryAdmin: async (conn: string) => "admin-data",
        doNothing: async () => "noop",
      });

      export async function run() {
        return await workflow.run(async ({ step, deps }) => {
          const role = "admin";
          switch (role) {
            case "user":
              return await step.withFallback(
                "userData",
                () => deps.fetchUserPrimary(),
                { fallback: () => deps.fetchUserFallback() }
              );
            case "admin":
              return await step.withResource("adminDb", {
                acquire: () => deps.openAdminDb(),
                use: (conn) => deps.queryAdmin(conn),
                release: () => {},
              });
            default:
              return await step("default", () => deps.doNothing());
          }
        });
      }
    `;

    const results = analyzeWorkflowSource(source);
    const steps = collectStepNodes(results[0].root);
    expect(steps.some((s) => s.callee === "step.withFallback" && s.stepId === "userData")).toBe(true);
    expect(steps.some((s) => s.callee === "step.withResource" && s.stepId === "adminDb")).toBe(true);
    expect(steps.some((s) => s.stepId === "default")).toBe(true);
  });
});
