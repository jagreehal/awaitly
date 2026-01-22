/**
 * Tree-sitter Static Analysis POC Tests
 *
 * These tests verify the tree-sitter based analyzer works correctly.
 * WASM files are downloaded on first run and cached for subsequent tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  analyzeWorkflowSource,
  resetIdCounter,
  loadTreeSitter,
} from "./index";
import type { StaticFlowNode, StaticSequenceNode, StaticStepNode } from "./types";

describe("Tree-sitter POC", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("WASM Loading", () => {
    it("should load tree-sitter parser and TypeScript language", async () => {
      const { parser, language } = await loadTreeSitter();

      expect(parser).toBeDefined();
      expect(language).toBeDefined();

      // Verify we can parse TypeScript
      const tree = parser.parse("const x = 1;");
      expect(tree.rootNode.type).toBe("program");
    });

    it("should cache the parser instance", async () => {
      const first = await loadTreeSitter();
      const second = await loadTreeSitter();

      expect(first.parser).toBe(second.parser);
      expect(first.language).toBe(second.language);
    });
  });

  describe("Basic Workflow Analysis", () => {
    it("should find createWorkflow calls", async () => {
      const source = `
        import { createWorkflow } from 'awaitly';

        const myWorkflow = createWorkflow({
          fetchUser: async () => ({ id: '1' }),
        });

        export async function run() {
          return await myWorkflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(), {
              key: 'user',
              name: 'Fetch User',
            });
            return user;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("myWorkflow");
    });

    it("should extract step calls with key and name", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(id), {
              key: 'user',
              name: 'Fetch User',
            });
            return user;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      // Should have a sequence with one step
      expect(children.length).toBeGreaterThan(0);

      const firstChild = children[0];
      if (firstChild?.type === "sequence") {
        const step = firstChild.children[0];
        expect(step?.type).toBe("step");
        if (step?.type === "step") {
          expect(step.key).toBe("user");
          expect(step.name).toBe("Fetch User");
          expect(step.callee).toBe("deps.fetchUser");
        }
      } else if (firstChild?.type === "step") {
        expect(firstChild.key).toBe("user");
        expect(firstChild.name).toBe("Fetch User");
      }
    });

    it("should detect parallel steps", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await step.parallel({
              posts: () => deps.fetchPosts(id),
              friends: () => deps.fetchFriends(id),
            });
            return results;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      // Find the parallel node
      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode).toBeDefined();
      expect(parallelNode?.type).toBe("parallel");
      if (parallelNode?.type === "parallel") {
        expect(parallelNode.children).toHaveLength(2);
        expect(parallelNode.children[0].type).toBe("step");
        expect(parallelNode.children[1].type).toBe("step");
      }
    });

    it("should detect if statements as conditionals", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(id), { key: 'user' });

            if (user.isPremium) {
              await step(() => deps.applyDiscount(user.id), { key: 'discount' });
            }

            return user;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.conditionalCount).toBe(1);
      expect(stats?.totalSteps).toBe(2);
    });

    it("should include source locations", async () => {
      const source = `const workflow = createWorkflow({});
async function run() {
  return await workflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser(), { key: 'user' });
    return user;
  });
}`;

      const results = await analyzeWorkflowSource(source, {
        includeLocations: true,
      });

      const root = results[0]?.root;
      const children = root?.children || [];
      const firstChild = children[0];

      // Find the step node
      let stepNode: StaticStepNode | undefined;
      if (firstChild?.type === "sequence") {
        stepNode = (firstChild as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (firstChild?.type === "step") {
        stepNode = firstChild as StaticStepNode;
      }

      expect(stepNode?.location).toBeDefined();
      expect(stepNode?.location?.line).toBeGreaterThan(0);
    });

    it("should respect custom step parameter names", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (s, deps) => {
            await s(() => deps.fetchUser(id), { key: 'user' });
            return null;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect step calls wrapped in parentheses", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await (step(() => deps.fetchUser(id), { key: 'user' }));
            return user;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should extract callee from block-bodied step callback", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => {
              return deps.fetchUser(id);
            }, { key: 'user' });
            return user;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.callee).toBe("deps.fetchUser");
    });

    it("should resolve step parameter when destructuring uses default and alias", async () => {
      const source = `
        const workflow = createWorkflow({});
        const fallback = () => null;

        async function run() {
          return await workflow(async ({ step: runStep = fallback }, deps) => {
            await runStep(() => deps.fetchUser(id), { key: 'user' });
            return null;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect step when callback destructures with alias", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async ({ step: runStep }, deps) => {
            await runStep(() => deps.fetchUser(id), { key: 'user' });
            return null;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect step when destructuring provides a default value", async () => {
      const source = `
        const workflow = createWorkflow({});
        const defaultStep = () => null;

        async function run() {
          return await workflow(async ({ step = defaultStep }, deps) => {
            await step(() => deps.fetchUser(id), { key: 'user' });
            return null;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should keep stats scoped to each workflow", async () => {
      const source = `
        const workflowA = createWorkflow({});
        const workflowB = createWorkflow({});

        async function runA() {
          return await workflowA(async (step, deps) => {
            await step(() => deps.doA(), { key: 'a' });
          });
        }

        async function runB() {
          return await workflowB(async (step, deps) => {
            await step(() => deps.doB(), { key: 'b' });
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      expect(results).toHaveLength(2);

      const workflowA = results.find((r) => r.root.workflowName === "workflowA");
      const workflowB = results.find((r) => r.root.workflowName === "workflowB");

      expect(workflowA?.metadata.stats.totalSteps).toBe(1);
      expect(workflowB?.metadata.stats.totalSteps).toBe(1);
    });
  });

  describe("Comparison with ts-morph analyzer", () => {
    it("should produce compatible IR structure", async () => {
      const source = `
        const workflow = createWorkflow({
          fetchUser: async () => ({ id: '1' }),
        });

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(), {
              key: 'user',
              name: 'Fetch User',
            });
            return user;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);

      // Check IR structure
      expect(results[0]).toMatchObject({
        root: {
          type: "workflow",
          workflowName: "workflow",
        },
        metadata: {
          warnings: expect.any(Array),
          stats: {
            totalSteps: expect.any(Number),
            conditionalCount: expect.any(Number),
            parallelCount: expect.any(Number),
            raceCount: expect.any(Number),
            loopCount: expect.any(Number),
            workflowRefCount: expect.any(Number),
            unknownCount: expect.any(Number),
          },
        },
      });
    });
  });

  describe("Loop Analysis", () => {
    it("should detect for loops with step calls", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            for (let i = 0; i < 5; i++) {
              await step(() => deps.processItem(i), { key: \`item-\${i}\` });
            }
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.loopCount).toBe(1);
      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect for-of loops with step calls", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const items = ['a', 'b', 'c'];
            for (const item of items) {
              await step(() => deps.processItem(item), { key: item });
            }
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;

      expect(stats?.loopCount).toBe(1);

      // Find the loop node
      const children = root?.children || [];
      let loopNode = children.find((c) => c.type === "loop");
      if (!loopNode && children[0]?.type === "sequence") {
        loopNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "loop"
        );
      }

      expect(loopNode).toBeDefined();
      if (loopNode?.type === "loop") {
        expect(loopNode.loopType).toBe("for-of");
        expect(loopNode.iterSource).toBe("items");
      }
    });

    it("should detect while loops with step calls", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            let hasMore = true;
            while (hasMore) {
              const result = await step(() => deps.fetchPage(), { key: 'page' });
              hasMore = result.hasMore;
            }
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.loopCount).toBe(1);
      expect(stats?.totalSteps).toBe(1);
    });

    it("should not count loops without step calls", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            // This loop has no step calls, so it shouldn't be counted
            let sum = 0;
            for (let i = 0; i < 10; i++) {
              sum += i;
            }

            // Only this step should be counted
            await step(() => deps.saveResult(sum), { key: 'save' });
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.loopCount).toBe(0);
      expect(stats?.totalSteps).toBe(1);
    });
  });

  describe("Conditional Helpers", () => {
    it("should detect when() helper", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(id), { key: 'user' });

            await when(user.isPremium, () =>
              step(() => deps.applyDiscount(user.id), { key: 'discount' })
            );
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.conditionalCount).toBe(1);
      expect(stats?.totalSteps).toBe(2);
    });

    it("should detect unless() helper", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(id), { key: 'user' });

            await unless(user.isBlocked, () =>
              step(() => deps.sendWelcome(user.id), { key: 'welcome' })
            );
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.conditionalCount).toBe(1);
      expect(stats?.totalSteps).toBe(2);
    });

    it("should detect whenOr() helper with default value", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const discount = await whenOr(
              user.isPremium,
              () => step(() => deps.calculateDiscount(user.id), { key: 'discount' }),
              0
            );
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;

      expect(stats?.conditionalCount).toBe(1);

      // Find the conditional node
      const children = root?.children || [];
      let conditionalNode = children.find((c) => c.type === "conditional");
      if (!conditionalNode && children[0]?.type === "sequence") {
        conditionalNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "conditional"
        );
      }

      expect(conditionalNode?.type).toBe("conditional");
      if (conditionalNode?.type === "conditional") {
        expect(conditionalNode.helper).toBe("whenOr");
        expect(conditionalNode.defaultValue).toBe("0");
      }
    });
  });

  describe("Parallel Helpers", () => {
    it("should detect allAsync() helper", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await allAsync([
              () => step(() => deps.fetchPosts(id), { key: 'posts' }),
              () => step(() => deps.fetchFriends(id), { key: 'friends' }),
            ]);
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;

      expect(stats?.parallelCount).toBe(1);
      expect(stats?.totalSteps).toBe(2);

      // Find the parallel node
      const children = root?.children || [];
      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode?.type).toBe("parallel");
      if (parallelNode?.type === "parallel") {
        expect(parallelNode.callee).toBe("allAsync");
        expect(parallelNode.children).toHaveLength(2);
      }
    });

    it("should treat direct calls in allAsync as implicit steps", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await allAsync([
              deps.fetchPosts(id),
              deps.fetchFriends(id),
            ]);
            return results;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;
      const children = root?.children || [];

      expect(stats?.totalSteps).toBe(2);

      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode?.type).toBe("parallel");
      if (parallelNode?.type === "parallel") {
        expect(parallelNode.children).toHaveLength(2);
        expect(parallelNode.children[0].type).toBe("step");
        expect(parallelNode.children[1].type).toBe("step");
      }
    });

    it("should preserve step metadata when allAsync includes step() calls", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await allAsync([
              step(() => deps.fetchPosts(id), { key: 'posts', name: 'Fetch Posts' }),
              step(() => deps.fetchFriends(id), { key: 'friends', name: 'Fetch Friends' }),
            ]);
            return results;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode?.type).toBe("parallel");
      if (parallelNode?.type === "parallel") {
        const steps = parallelNode.children.filter(
          (child) => child.type === "step"
        ) as StaticStepNode[];
        expect(steps.map((s) => s.key)).toEqual(["posts", "friends"]);
        expect(steps.map((s) => s.name)).toEqual([
          "Fetch Posts",
          "Fetch Friends",
        ]);
      }
    });

    it("should keep multi-step branches grouped in allAsync()", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            await allAsync([
              () => {
                step(() => deps.fetchPosts(id), { key: 'posts' });
                step(() => deps.fetchComments(id), { key: 'comments' });
              },
              () => step(() => deps.fetchFriends(id), { key: 'friends' }),
            ]);
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode?.type).toBe("parallel");
      if (parallelNode?.type === "parallel") {
        expect(parallelNode.children).toHaveLength(2);
        const firstChild = parallelNode.children[0];
        expect(firstChild?.type).toBe("sequence");
        if (firstChild?.type === "sequence") {
          expect(firstChild.children).toHaveLength(2);
          expect(firstChild.children[0].type).toBe("step");
          expect(firstChild.children[1].type).toBe("step");
        }
      }
    });

    it("should detect anyAsync() helper", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const fastest = await anyAsync([
              () => step(() => deps.fetchFromCacheA(), { key: 'cacheA' }),
              () => step(() => deps.fetchFromCacheB(), { key: 'cacheB' }),
            ]);
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;

      expect(stats?.raceCount).toBe(1);
      expect(stats?.totalSteps).toBe(2);

      // Find the race node
      const children = root?.children || [];
      let raceNode = children.find((c) => c.type === "race");
      if (!raceNode && children[0]?.type === "sequence") {
        raceNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "race"
        );
      }

      expect(raceNode?.type).toBe("race");
      if (raceNode?.type === "race") {
        expect(raceNode.callee).toBe("anyAsync");
        expect(raceNode.children).toHaveLength(2);
      }
    });

    it("should analyze step.parallel array form callbacks", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.parallel("Fetch all", () => allAsync([
              () => step(() => deps.fetchPosts(id), { key: 'posts' }),
              () => step(() => deps.fetchFriends(id), { key: 'friends' }),
            ]));
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;
      const children = root?.children || [];

      expect(stats?.totalSteps).toBe(2);

      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode?.type).toBe("parallel");
    });

    it("should apply step.parallel name to array form", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.parallel("Fetch all", () => allAsync([
              () => step(() => deps.fetchPosts(id), { key: 'posts' }),
              () => step(() => deps.fetchFriends(id), { key: 'friends' }),
            ]));
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode?.type).toBe("parallel");
      if (parallelNode?.type === "parallel") {
        expect(parallelNode.name).toBe("Fetch all");
      }
    });

    it("should apply step.parallel name to array form with named operation", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.parallel(ParallelOps.fetchAll, () => allAsync([
              () => step(() => deps.fetchPosts(id), { key: 'posts' }),
              () => step(() => deps.fetchFriends(id), { key: 'friends' }),
            ]));
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode?.type).toBe("parallel");
      if (parallelNode?.type === "parallel") {
        expect(parallelNode.name).toBe("ParallelOps.fetchAll");
      }
    });

    it("should capture step.parallel name option in object form", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.parallel(
              {
                posts: () => deps.fetchPosts(id),
                friends: () => deps.fetchFriends(id),
              },
              { name: 'Fetch all' }
            );
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let parallelNode = children.find((c) => c.type === "parallel");
      if (!parallelNode && children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        );
      }

      expect(parallelNode?.type).toBe("parallel");
      if (parallelNode?.type === "parallel") {
        expect(parallelNode.name).toBe("Fetch all");
      }
    });
  });

  describe("Retry and Timeout", () => {
    it("should extract retry config from step options", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step(() => deps.fetchData(), {
              key: 'fetch',
              retry: {
                attempts: 3,
                backoff: 'exponential',
                baseDelay: 100,
              },
            });
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      // Find the step node
      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.retry).toBeDefined();
      expect(stepNode?.retry?.attempts).toBe(3);
      expect(stepNode?.retry?.backoff).toBe("exponential");
      expect(stepNode?.retry?.baseDelay).toBe(100);
    });

    it("should extract timeout config from step options", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step(() => deps.fetchData(), {
              key: 'fetch',
              timeout: { ms: 5000 },
            });
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      // Find the step node
      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.timeout).toBeDefined();
      expect(stepNode?.timeout?.ms).toBe(5000);
    });

    it("should parse step.retry() with operation-first signature", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.retry(
              () => deps.fetchData(),
              { key: 'fetch', attempts: 5, backoff: 'linear' }
            );
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.callee).toBe("deps.fetchData");
      expect(stepNode?.retry?.attempts).toBe(5);
      expect(stepNode?.retry?.backoff).toBe("linear");
      expect(stepNode?.key).toBe("fetch");
    });

    it("should detect step.retry() call", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.retry(
              () => deps.fetchData(),
              { key: 'fetch', attempts: 5, backoff: 'linear' }
            );
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      // Find the step node
      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.retry).toBeDefined();
      expect(stepNode?.retry?.attempts).toBe(5);
      expect(stepNode?.retry?.backoff).toBe("linear");
      expect(stepNode?.key).toBe("fetch");
    });

    it("should parse step.withTimeout() with operation-first signature", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.withTimeout(
              () => deps.fetchData(),
              { key: 'fetch', ms: 3000 }
            );
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.callee).toBe("deps.fetchData");
      expect(stepNode?.timeout?.ms).toBe(3000);
      expect(stepNode?.key).toBe("fetch");
    });

    it("should detect step.withTimeout() call", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.withTimeout(
              () => deps.fetchData(),
              { key: 'fetch', ms: 3000 }
            );
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      // Find the step node
      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.timeout).toBeDefined();
      expect(stepNode?.timeout?.ms).toBe(3000);
      expect(stepNode?.key).toBe("fetch");
    });
  });

  describe("Workflow Composition", () => {
    it("should detect calls to other workflows", async () => {
      const source = `
        const childWorkflow = createWorkflow({});
        const parentWorkflow = createWorkflow({});

        async function runChild() {
          return await childWorkflow(async (step, deps) => {
            await step(() => deps.fetchData(), { key: 'data' });
          });
        }

        async function runParent() {
          return await parentWorkflow(async (step, deps) => {
            // Call the child workflow
            const result = await childWorkflow(async (step, deps) => {
              await step(() => deps.process(), { key: 'process' });
            });
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);

      // Find the parent workflow result
      const parentResult = results.find(
        (r) => r.root.workflowName === "parentWorkflow"
      );
      expect(parentResult).toBeDefined();

      const stats = parentResult?.metadata?.stats;
      expect(stats?.workflowRefCount).toBe(1);

      // Find the workflow-ref node
      const root = parentResult?.root;
      const children = root?.children || [];
      let refNode = children.find((c) => c.type === "workflow-ref");
      if (!refNode && children[0]?.type === "sequence") {
        refNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "workflow-ref"
        );
      }

      expect(refNode?.type).toBe("workflow-ref");
      if (refNode?.type === "workflow-ref") {
        expect(refNode.workflowName).toBe("childWorkflow");
      }
    });

    it("should not count self-references as workflow refs", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            await step(() => deps.fetchData(), { key: 'data' });
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      // The workflow invocation is the entry point, not a reference
      expect(stats?.workflowRefCount).toBe(0);
    });
  });

  describe("False Positive Filtering", () => {
    it("should not match methods with similar names as step functions", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            // These should NOT be detected as step calls
            const data = await deps.parallelFetch(ids);
            const result = await deps.raceConditionCheck();
            await deps.retryableOperation();
            await deps.withTimeoutHelper(fn);

            // Only this should be detected
            await step(() => deps.actualStep(), { key: 'actual' });
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      // Only the actual step() call should be counted
      expect(stats?.totalSteps).toBe(1);
      expect(stats?.parallelCount).toBe(0);
      expect(stats?.raceCount).toBe(0);
    });

    it("should not match .step calls on non-step objects", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          const tracker = { step: (value) => value };

          return await workflow(async (step, deps) => {
            // This should NOT be detected as a workflow step
            const tracked = tracker.step('ignored');
            return tracked;
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(0);
    });

    it("should not match property access .parallel, .race, .retry on non-step objects", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            // These should NOT be detected as step functions
            const p = data.parallel([1, 2, 3]);
            const r = arr.race(fn);
            const t = api.retry(3, fn);

            // Only actual step.parallel should match
            const results = await step.parallel({
              a: () => deps.fetchA(),
              b: () => deps.fetchB(),
            });
          });
        }
      `;

      const results = await analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      // Only step.parallel should be detected
      expect(stats?.parallelCount).toBe(1);
      expect(stats?.raceCount).toBe(0);
      expect(stats?.totalSteps).toBe(2); // 2 steps inside parallel
    });
  });
});
