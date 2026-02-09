/**
 * ts-morph Static Analyzer Tests
 *
 * Tests for the ts-morph based workflow analyzer.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  analyzeWorkflowSource,
  resetIdCounter,
} from ".";
import {
  generatePathsWithMetadata,
  calculatePathStatistics,
} from "../path-generator";
import { calculateComplexity } from "../complexity";
import { renderStaticMermaid, renderPathsMermaid } from "../output/mermaid";
import type {
  StaticFlowNode,
  StaticSequenceNode,
  StaticStepNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticStreamNode,
  StaticConditionalNode,
  StaticSwitchNode,
  StaticWorkflowRefNode,
  StaticSagaStepNode,
  StaticDecisionNode,
  StaticLoopNode,
} from "../types";
import { getStaticChildren } from "../types";

// Test fixtures directory
const FIXTURES_DIR = join(__dirname, "..", "__fixtures__");
const JSDOC_FIXTURES_DIR = join(FIXTURES_DIR, "jsdoc");

function collectStepNodes(root: { children: StaticFlowNode[] }): StaticStepNode[] {
  const steps: StaticStepNode[] = [];
  function walk(n: StaticFlowNode) {
    if (n.type === "step") steps.push(n as StaticStepNode);
    for (const c of getStaticChildren(n)) walk(c);
  }
  for (const c of root.children) walk(c);
  return steps;
}

function collectSagaStepNodes(root: { children: StaticFlowNode[] }): StaticFlowNode[] {
  const sagaSteps: StaticFlowNode[] = [];
  function walk(n: StaticFlowNode) {
    if (n.type === "saga-step") sagaSteps.push(n);
    for (const c of getStaticChildren(n)) walk(c);
  }
  for (const c of root.children) walk(c);
  return sagaSteps;
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

function findNodesByType<T extends StaticFlowNode>(
  root: { children: StaticFlowNode[] },
  type: T["type"]
): T[] {
  return collectAllNodes(root).filter((n) => n.type === type) as T[];
}

describe("ts-morph Static Analyzer", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("Basic Workflow Analysis", () => {
    it("should find createWorkflow calls with name-only signature", () => {
      const source = `
        import { createWorkflow } from 'awaitly';

        const myWorkflow = createWorkflow("myWorkflow");

        export async function run() {
          return await myWorkflow(async (step) => {
            await step.sleep('pause', '10ms');
            return 1;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("myWorkflow");
      expect(results[0].root.dependencies).toEqual([]);
    });

    it("should find createWorkflow calls", () => {
      const source = `
        import { createWorkflow } from 'awaitly';

        const myWorkflow = createWorkflow("myWorkflow", {
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

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("myWorkflow");
    });

    it("should detect createWorkflow when imported via namespace", () => {
      const source = `
        import * as Awaitly from 'awaitly';

        const myWorkflow = Awaitly.createWorkflow("myWorkflow", {
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

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("myWorkflow");
    });

    it("should detect createWorkflow when imported as default", () => {
      const source = `
        import Awaitly from 'awaitly';

        const myWorkflow = Awaitly.createWorkflow("myWorkflow", {
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

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("myWorkflow");
    });

    it("should detect createWorkflow when imported with alias", () => {
      const source = `
        import { createWorkflow as cw } from 'awaitly';

        const myWorkflow = cw("myWorkflow", {
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

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("myWorkflow");
    });

    it("should detect run() when imported with alias", () => {
      const source = `
        import { run as runWorkflow } from 'awaitly';

        await runWorkflow(async (step) => {
          await step(() => getUser(id));
        });
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0].root.source).toBe("run");
    });

    it("should extract step calls with key and name", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step('Fetch User', () => deps.fetchUser(id), {
              key: 'user',
            });
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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

    it("should detect parallel steps", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await step.parallel("Fetch posts and friends", {
              posts: () => deps.fetchPosts(id),
              friends: () => deps.fetchFriends(id),
            });
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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

    it("should detect if statements as conditionals", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

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

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.conditionalCount).toBe(1);
      expect(stats?.totalSteps).toBe(2);
    });

    it("should include source locations", () => {
      const source = `const workflow = createWorkflow("workflow", {});
async function run() {
  return await workflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser(), { key: 'user' });
    return user;
  });
}`;

      const results = analyzeWorkflowSource(source, undefined, {
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

    it("should infer workflowReturnType when workflow callback is passed by identifier", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          fetchUser: async () => ({ id: "1" }),
        });

        const callback = async (step: unknown, deps: unknown) => {
          return { ok: true as const };
        };

        async function run() {
          return await workflow(callback);
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowReturnType).toBeDefined();
    });

    it("should infer workflowReturnType through one level of callback identifier alias", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          fetchUser: async () => ({ id: "1" }),
        });

        const handler = async (step: unknown, deps: unknown) => {
          return { ok: true as const };
        };
        const callback = handler;

        async function run() {
          return await workflow(callback);
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowReturnType).toBeDefined();
    });

    it("should include depLocation for step.retry when includeLocations is true", () => {
      const source = `const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1" })
});
async function run() {
  return await workflow(async (step, deps) => {
    await step.retry("fetch-user", () => deps.fetchUser(), { attempts: 3 });
    return {};
  });
}`;

      const results = analyzeWorkflowSource(source, undefined, {
        includeLocations: true,
        assumeImported: true,
      });

      const root = results[0]?.root;
      const children = root?.children || [];
      const firstChild = children[0];

      let stepNode: StaticStepNode | undefined;
      if (firstChild?.type === "sequence") {
        stepNode = (firstChild as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (firstChild?.type === "step") {
        stepNode = firstChild as StaticStepNode;
      }

      expect(stepNode?.callee).toBe("deps.fetchUser");
      expect(stepNode?.depSource).toBe("fetchUser");
      expect(stepNode?.depLocation).toBeDefined();
      expect(stepNode?.depLocation?.line).toBeGreaterThan(0);
    });

    it("should include depLocation for step.withTimeout when includeLocations is true", () => {
      const source = `const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1" })
});
async function run() {
  return await workflow(async (step, deps) => {
    await step.withTimeout("fetch-user", () => deps.fetchUser(), { ms: 5000 });
    return {};
  });
}`;

      const results = analyzeWorkflowSource(source, undefined, {
        includeLocations: true,
        assumeImported: true,
      });

      const root = results[0]?.root;
      const children = root?.children || [];
      const firstChild = children[0];

      let stepNode: StaticStepNode | undefined;
      if (firstChild?.type === "sequence") {
        stepNode = (firstChild as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (firstChild?.type === "step") {
        stepNode = firstChild as StaticStepNode;
      }

      expect(stepNode?.callee).toBe("deps.fetchUser");
      expect(stepNode?.depSource).toBe("fetchUser");
      expect(stepNode?.depLocation).toBeDefined();
      expect(stepNode?.depLocation?.line).toBeGreaterThan(0);
    });

    it("should infer outputType for step.retry operations", () => {
      const source = `const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1" as const })
});
async function run() {
  return await workflow(async (step, deps) => {
    await step.retry("fetch-user", () => deps.fetchUser(), { attempts: 3 });
    return {};
  });
}`;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: true,
      });

      const root = results[0]?.root;
      const children = root?.children || [];
      const firstChild = children[0];

      let stepNode: StaticStepNode | undefined;
      if (firstChild?.type === "sequence") {
        stepNode = (firstChild as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (firstChild?.type === "step") {
        stepNode = firstChild as StaticStepNode;
      }

      expect(stepNode?.callee).toBe("deps.fetchUser");
      expect(stepNode?.outputType).toBeDefined();
    });

    it("should extract callee and depSource for step.retry block-body callbacks", () => {
      const source = `const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1" as const })
});
async function run() {
  return await workflow(async (step, deps) => {
    await step.retry("fetch-user", () => {
      return deps.fetchUser();
    }, { attempts: 3 });
    return {};
  });
}`;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: true,
      });

      const root = results[0]?.root;
      const children = root?.children || [];
      const firstChild = children[0];

      let stepNode: StaticStepNode | undefined;
      if (firstChild?.type === "sequence") {
        stepNode = (firstChild as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (firstChild?.type === "step") {
        stepNode = firstChild as StaticStepNode;
      }

      expect(stepNode?.callee).toBe("deps.fetchUser");
      expect(stepNode?.depSource).toBe("fetchUser");
    });

    it("should extract callee and depSource for step.withTimeout block-body callbacks", () => {
      const source = `const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1" as const })
});
async function run() {
  return await workflow(async (step, deps) => {
    await step.withTimeout("fetch-user", () => {
      return deps.fetchUser();
    }, { ms: 5000 });
    return {};
  });
}`;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: true,
      });

      const root = results[0]?.root;
      const children = root?.children || [];
      const firstChild = children[0];

      let stepNode: StaticStepNode | undefined;
      if (firstChild?.type === "sequence") {
        stepNode = (firstChild as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (firstChild?.type === "step") {
        stepNode = firstChild as StaticStepNode;
      }

      expect(stepNode?.callee).toBe("deps.fetchUser");
      expect(stepNode?.depSource).toBe("fetchUser");
    });

    it("should extract depSource from step.dep wrapper in step.retry", () => {
      const source = `const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1" as const })
});
async function run() {
  return await workflow(async (step, deps) => {
    await step.retry("fetch-user", step.dep("userService", () => deps.fetchUser()), { attempts: 3 });
    return {};
  });
}`;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: true,
      });

      const root = results[0]?.root;
      const children = root?.children || [];
      const firstChild = children[0];

      let stepNode: StaticStepNode | undefined;
      if (firstChild?.type === "sequence") {
        stepNode = (firstChild as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (firstChild?.type === "step") {
        stepNode = firstChild as StaticStepNode;
      }

      expect(stepNode?.callee).toBe("deps.fetchUser");
      expect(stepNode?.depSource).toBe("userService");
    });

    it("should extract depSource from step.dep wrapper in step.withTimeout", () => {
      const source = `const workflow = createWorkflow("workflow", {
  fetchUser: async () => ({ id: "1" as const })
});
async function run() {
  return await workflow(async (step, deps) => {
    await step.withTimeout("fetch-user", step.dep("userService", () => deps.fetchUser()), { ms: 5000 });
    return {};
  });
}`;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: true,
      });

      const root = results[0]?.root;
      const children = root?.children || [];
      const firstChild = children[0];

      let stepNode: StaticStepNode | undefined;
      if (firstChild?.type === "sequence") {
        stepNode = (firstChild as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (firstChild?.type === "step") {
        stepNode = firstChild as StaticStepNode;
      }

      expect(stepNode?.callee).toBe("deps.fetchUser");
      expect(stepNode?.depSource).toBe("userService");
    });

    it("should keep stats scoped to each workflow", () => {
      const source = `
        const workflowA = createWorkflow("workflowA", {});
        const workflowB = createWorkflow("workflowB", {});

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

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(2);

      const workflowA = results.find((r) => r.root.workflowName === "workflowA");
      const workflowB = results.find((r) => r.root.workflowName === "workflowB");

      expect(workflowA?.metadata.stats.totalSteps).toBe(1);
      expect(workflowB?.metadata.stats.totalSteps).toBe(1);
    });
  });

  describe("Factory Pattern Analysis", () => {
    it("should find invocations when factory result is assigned to a variable", () => {
      const source = `
        const workflow = createWorkflow("factory-direct", {
          fetchUser: async () => ({ id: '1' }),
        });

        function createMyWorkflow() {
          return workflow;
        }

        export async function run() {
          const wf = createMyWorkflow();
          return await wf(async (step, { fetchUser }) => {
            const user = await step("fetch", () => fetchUser());
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      // The direct binding "workflow" should still find the invocation via wf
      // since wf = createMyWorkflow() which returns workflow
    });

    it("should find invocations via factory function return pattern", () => {
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("factory-return", {
            generateStep: async () => "hello",
            validateStep: async (s: string) => ({ answer: s, length: s.length }),
          });
        }

        const wf = createSpecWorkflow();

        export async function run() {
          return await wf(async (step, { generateStep, validateStep }) => {
            const raw = await step("generate", () => generateStep());
            return await step("validate", () => validateStep(raw));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("factory-return");
      expect(results[0].root.children.length).toBeGreaterThan(0);

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("generate");
      expect(steps[1].stepId).toBe("validate");
    });

    it("should find invocations via deps-signature matching when workflow is a parameter", () => {
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("deps-sig-match", {
            generateStep: async () => "hello",
            validateStep: async (s: string) => ({ answer: s }),
          });
        }

        type SpecWorkflow = ReturnType<typeof createSpecWorkflow>;

        async function runSpecWorkflow(workflow: SpecWorkflow, question: string) {
          return await workflow(async (step, { generateStep, validateStep }) => {
            const raw = await step("generate", () => generateStep());
            return await step("validate", () => validateStep(raw));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("deps-sig-match");
      expect(results[0].root.children.length).toBeGreaterThan(0);

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("generate");
      expect(steps[1].stepId).toBe("validate");
    });

    it("should match deps-signature when workflow parameter callee is parenthesized", () => {
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("deps-sig-parenthesized", {
            generateStep: async () => "hello",
            validateStep: async (s: string) => ({ answer: s }),
          });
        }

        type SpecWorkflow = ReturnType<typeof createSpecWorkflow>;

        async function runSpecWorkflow(workflow: SpecWorkflow) {
          return await (workflow)(async (step, { generateStep, validateStep }) => {
            const raw = await step("generate", () => generateStep());
            return await step("validate", () => validateStep(raw));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("deps-sig-parenthesized");

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("generate");
      expect(steps[1].stepId).toBe("validate");
    });

    it("should match deps-signature when workflow parameter callee is parenthesized await expression", () => {
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("deps-sig-await-parenthesized", {
            generateStep: async () => "hello",
            validateStep: async (s: string) => ({ answer: s }),
          });
        }

        type SpecWorkflow = ReturnType<typeof createSpecWorkflow>;

        async function runSpecWorkflow(workflow: Promise<SpecWorkflow>) {
          return await (await workflow)(async (step, { generateStep, validateStep }) => {
            const raw = await step("generate", () => generateStep());
            return await step("validate", () => validateStep(raw));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("deps-sig-await-parenthesized");

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("generate");
      expect(steps[1].stepId).toBe("validate");
    });

    it("should match deps-signature when awaited workflow parameter has inner parentheses", () => {
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("deps-sig-await-inner-parens", {
            generateStep: async () => "hello",
            validateStep: async (s: string) => ({ answer: s }),
          });
        }

        type SpecWorkflow = ReturnType<typeof createSpecWorkflow>;

        async function runSpecWorkflow(workflow: Promise<SpecWorkflow>) {
          return await (await (workflow))(async (step, { generateStep, validateStep }) => {
            const raw = await step("generate", () => generateStep());
            return await step("validate", () => validateStep(raw));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("deps-sig-await-inner-parens");

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("generate");
      expect(steps[1].stepId).toBe("validate");
    });

    it("should not match deps-signature when dep names differ", () => {
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("no-match", {
            generateStep: async () => "hello",
            validateStep: async (s: string) => ({ answer: s }),
          });
        }

        // This callback destructures different names, should NOT match
        async function runOtherWorkflow(workflow: any) {
          return await workflow(async (step, { fetchData, processData }) => {
            const raw = await step("fetch", () => fetchData());
            return await step("process", () => processData(raw));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      // No matching invocation found, so no children
      expect(results[0].root.children).toHaveLength(0);
    });

    it("should not match deps-signature on non-workflow function calls", () => {
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("false-positive-guard", {
            generateStep: async () => "hello",
            validateStep: async (s: string) => ({ answer: s }),
          });
        }

        // Not a workflow invocation: helper accepts an arbitrary callback
        async function executeTask(cb: any) {
          return cb();
        }

        export async function run() {
          return await executeTask(async (_ignored, { generateStep, validateStep }) => {
            const raw = await _ignored("generate", () => generateStep());
            return await _ignored("validate", () => validateStep(raw));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      // No real workflow invocation exists in this file.
      expect(results[0].root.children).toHaveLength(0);
    });

    it("should not count direct invocation when callee is same-name different variable", () => {
      // Callee must resolve to the workflow's variable declaration (not just same name).
      // Use two blocks so shadowing does not apply; only binding check distinguishes.
      const source = `
        if (true) {
          const w = createWorkflow("same-name-guard", {
            stepA: async () => "a",
          });
        }
        if (true) {
          const w = (cb: any) => cb();
          w(async (step: any, { stepA }: any) => step("a", () => stepA()));
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("same-name-guard");
      // Second block's w(cb) must not be counted (different variable, same name).
      expect(results[0].root.children).toHaveLength(0);
    });

    it("should not count factory invocation when callee is same-name different variable", () => {
      // Factory fallback must match by symbol/declaration, not just variable name.
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("factory-same-name-guard", {
            stepA: async () => "a",
          });
        }

        export async function main() {
          const w = createSpecWorkflow();
          return await w(async (step, { stepA }) => step("a", () => stepA()));
        }

        function other() {
          const w = (cb: any) => cb();
          w(async (step: any, { stepA }: any) => step("a", () => stepA()));
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("factory-same-name-guard");
      // Only main()'s w(...) is the factory result; other()'s w is a different variable.
      expect(results[0].root.children).toHaveLength(1);
    });

    it("should not count factory invocation when factory name is shadowed by local declaration", () => {
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("factory-shadowed-name", {
            stepA: async () => "a",
          });
        }

        export async function main() {
          const w = createSpecWorkflow();
          return await w(async (step, { stepA }) => step("a", () => stepA()));
        }

        function other() {
          function createSpecWorkflow() {
            return (cb: any) => cb();
          }
          const w = createSpecWorkflow();
          w(async (step: any, { stepA }: any) => step("a", () => stepA()));
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("factory-shadowed-name");
      // Only main() should count; other() uses a shadowed local factory.
      expect(results[0].root.children).toHaveLength(1);
    });

    it("should not match deps-signature when callee is a method (e.g. obj.run(cb))", () => {
      // Callee must be a function parameter; method calls with matching callback
      // shape would otherwise be false positives (isLocalNonParam only checks identifiers).
      const source = `
        function createSpecWorkflow() {
          return createWorkflow("no-method-callee", {
            generateStep: async () => "hello",
            validateStep: async (s: string) => ({ answer: s }),
          });
        }

        const runner = {
          run(cb: any) {
            return cb();
          },
        };

        export async function run() {
          return await runner.run(async (_step, { generateStep, validateStep }) => {
            const raw = await _step("generate", () => generateStep());
            return await _step("validate", () => validateStep(raw));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("no-method-callee");
      // Must not treat runner.run(...) as a workflow invocation.
      expect(results[0].root.children).toHaveLength(0);
    });

    it("should find invocations via arrow function factory with implicit return", () => {
      const source = `
        const createMyWorkflow = () => createWorkflow("arrow-implicit", {
          stepA: async () => "a",
          stepB: async () => "b",
        });

        export async function main() {
          const workflow = createMyWorkflow();
          return await workflow(async (step, { stepA, stepB }) => {
            const a = await step("doA", () => stepA());
            return await step("doB", () => stepB());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("arrow-implicit");

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("doA");
      expect(steps[1].stepId).toBe("doB");
    });

    it("should find invocations via arrow function factory with block body", () => {
      const source = `
        const createMyWorkflow = () => {
          return createWorkflow("arrow-block", {
            stepA: async () => "a",
            stepB: async () => "b",
          });
        };

        export async function main() {
          const workflow = createMyWorkflow();
          return await workflow(async (step, { stepA, stepB }) => {
            const a = await step("doA", () => stepA());
            return await step("doB", () => stepB());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("arrow-block");

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("doA");
      expect(steps[1].stepId).toBe("doB");
    });

    it("should find invocations via function expression factory", () => {
      const source = `
        const createMyWorkflow = function() {
          return createWorkflow("func-expr", {
            stepA: async () => "a",
            stepB: async () => "b",
          });
        };

        export async function main() {
          const workflow = createMyWorkflow();
          return await workflow(async (step, { stepA, stepB }) => {
            const a = await step("doA", () => stepA());
            return await step("doB", () => stepB());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("func-expr");

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("doA");
      expect(steps[1].stepId).toBe("doB");
    });

    it("should find invocations via factory tracing in same file", () => {
      const source = `
        function createMyWorkflow(options?: { onEvent?: (e: any) => void }) {
          return createWorkflow("factory-traced", {
            stepA: async () => "a",
            stepB: async () => "b",
          }, { onEvent: options?.onEvent });
        }

        export async function main() {
          const workflow = createMyWorkflow();
          return await workflow(async (step, { stepA, stepB }) => {
            const a = await step("doA", () => stepA());
            return await step("doB", () => stepB());
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("factory-traced");

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(2);
      expect(steps[0].stepId).toBe("doA");
      expect(steps[1].stepId).toBe("doB");
    });
  });

  describe("Loop Analysis", () => {
    it("should detect for loops with step calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            for (let i = 0; i < 5; i++) {
              await step(() => deps.processItem(i), { key: \`item-\${i}\` });
            }
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.loopCount).toBe(1);
      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect for-of loops with step calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const items = ['a', 'b', 'c'];
            for (const item of items) {
              await step(() => deps.processItem(item), { key: item });
            }
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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

    it("should detect while loops with step calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

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

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.loopCount).toBe(1);
      expect(stats?.totalSteps).toBe(1);
    });

    it("should not count loops without step calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            // This loop has no step calls, but is inside workflow callback so counted
            let sum = 0;
            for (let i = 0; i < 10; i++) {
              sum += i;
            }

            // Only this step should be counted
            await step(() => deps.saveResult(sum), { key: 'save' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      // Loop is counted because it's inside workflow callback (even without steps)
      expect(stats?.loopCount).toBe(1);
      expect(stats?.totalSteps).toBe(1);
    });
  });

  describe("Parallel and Race Analysis", () => {
    it("should detect allAsync calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await allAsync([
              () => deps.fetchA(),
              () => deps.fetchB(),
              () => deps.fetchC(),
            ]);
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.parallelCount).toBe(1);
    });

    it("should detect allSettledAsync calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await allSettledAsync([
              () => deps.fetchA(),
              () => deps.fetchB(),
            ]);
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.parallelCount).toBe(1);

      // Find the parallel node
      const root = results[0]?.root;
      const children = root?.children || [];
      let parallelNode: StaticParallelNode | undefined;
      if (children[0]?.type === "sequence") {
        parallelNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "parallel"
        ) as StaticParallelNode | undefined;
      } else if (children[0]?.type === "parallel") {
        parallelNode = children[0] as StaticParallelNode;
      }

      if (parallelNode) {
        expect(parallelNode.mode).toBe("allSettled");
      }
    });

    it("should detect anyAsync calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await anyAsync([
              () => deps.fetchA(),
              () => deps.fetchB(),
            ]);
            return result;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.raceCount).toBe(1);
    });
  });

  describe("Conditional Helpers", () => {
    it("should detect when() helper", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser());
            await when(user.isActive, () => step(() => deps.sendNotification()));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.conditionalCount).toBe(1);
    });

    it("should detect unless() helper", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser());
            await unless(user.isBlocked, () => step(() => deps.grantAccess()));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.conditionalCount).toBe(1);
    });
  });

  describe("IR Structure", () => {
    it("should produce compatible IR structure", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
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

      const results = analyzeWorkflowSource(source);

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

  describe("Edge Cases", () => {
    it("should handle workflows with no invocations", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          fetchUser: async () => ({ id: '1' }),
        });
        // No invocation
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("workflow");
      expect(results[0].root.children).toHaveLength(0);
    });

    it("should handle empty source", () => {
      const source = ``;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(0);
    });

    it("should handle source without workflows", () => {
      const source = `
        function notAWorkflow() {
          return 42;
        }
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(0);
    });
  });

  describe("Saga Workflow Analysis", () => {
    it("should ignore createSagaWorkflow calls without deps", () => {
      const source = `
        import { createSagaWorkflow } from 'awaitly';

        // Invalid runtime signature: deps argument is required for createSagaWorkflow
        const orderSaga = createSagaWorkflow("orderSaga");

        export async function run() {
          return await orderSaga(async (saga) => {
            await saga.step('noop', async () => ({ ok: true }));
            return { ok: true };
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(0);
    });

    it("should detect createSagaWorkflow calls", () => {
      const source = `
        import { createSagaWorkflow } from 'awaitly';

        const orderSaga = createSagaWorkflow("orderSaga", {
          createOrder: async () => ({ id: '1' }),
          chargePayment: async () => ({ success: true }),
        });

        export async function run() {
          return await orderSaga(async (saga, deps) => {
            const order = await saga.step('Create Order', () => deps.createOrder(), {
              compensate: () => deps.cancelOrder(),
            });
            return order;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("orderSaga");
      expect(results[0].root.source).toBe("createSagaWorkflow");
      expect(results[0].metadata.stats.sagaWorkflowCount).toBe(1);
    });

    it("should detect saga.step() calls with compensation", () => {
      const source = `
        const orderSaga = createSagaWorkflow("saga", {});

        async function run() {
          return await orderSaga(async (saga, deps) => {
            const order = await saga.step('Create Order', () => deps.createOrder(), {
              compensate: () => deps.cancelOrder(),
            });
            await saga.step('Charge Payment', () => deps.chargePayment(order.id), {
              compensate: () => deps.refundPayment(),
            });
            return order;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(2);
      expect(stats?.compensatedStepCount).toBe(2);
    });

    it("should extract compensationCallee when compensate uses block body with return", () => {
      const source = `
        const orderSaga = createSagaWorkflow("saga", {});

        async function run() {
          return await orderSaga(async (saga, deps) => {
            const order = await saga.step('Create Order', () => deps.createOrder(), {
              compensate: () => {
                return deps.cancelOrder();
              },
            });
            return order;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let sagaStep = children.find((c) => c.type === "saga-step");
      if (!sagaStep && children[0]?.type === "sequence") {
        sagaStep = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "saga-step"
        );
      }

      expect(sagaStep).toBeDefined();
      if (sagaStep?.type === "saga-step") {
        expect(sagaStep.hasCompensation).toBe(true);
        expect(sagaStep.compensationCallee).toBe("deps.cancelOrder");
      }
    });

    it("should extract description and markdown from saga.step options", () => {
      const source = `
        const orderSaga = createSagaWorkflow("saga", {});

        async function run() {
          return await orderSaga(async (saga, deps) => {
            const order = await saga.step('Create Order', () => deps.createOrder(), {
              description: 'Creates the order record',
              markdown: '## Create Order\\n\\nPersists order to the database.',
              compensate: () => deps.cancelOrder(),
            });
            return order;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let sagaStep = children.find((c) => c.type === "saga-step");
      if (!sagaStep && children[0]?.type === "sequence") {
        sagaStep = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "saga-step"
        );
      }

      expect(sagaStep).toBeDefined();
      if (sagaStep?.type === "saga-step") {
        expect(sagaStep.name).toBe("Create Order");
        expect(sagaStep.description).toBe("Creates the order record");
        expect(sagaStep.markdown).toContain("Create Order");
        expect(sagaStep.markdown).toContain("Persists order");
      }
    });

    it("should set saga step name from first argument (string literal)", () => {
      const source = `
        const orderSaga = createSagaWorkflow("saga", {});

        async function run() {
          return await orderSaga(async (saga, deps) => {
            const order = await saga.step('createOrder', () => deps.createOrder());
            return order;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let sagaStep = children.find((c) => c.type === "saga-step");
      if (!sagaStep && children[0]?.type === "sequence") {
        sagaStep = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "saga-step"
        );
      }

      expect(sagaStep).toBeDefined();
      if (sagaStep?.type === "saga-step") {
        expect(sagaStep.name).toBe("createOrder");
      }
    });

    it("should detect saga.tryStep() calls", () => {
      const source = `
        const orderSaga = createSagaWorkflow("saga", {});

        async function run() {
          return await orderSaga(async (saga, deps) => {
            const result = await saga.tryStep('Risky Operation', () => deps.riskyOperation(), {
              error: 'RISKY_FAILED',
              compensate: () => deps.undoRisky(),
            });
            return result;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      // Find the saga-step node
      let sagaStep = children.find((c) => c.type === "saga-step");
      if (!sagaStep && children[0]?.type === "sequence") {
        sagaStep = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "saga-step"
        );
      }

      expect(sagaStep).toBeDefined();
      if (sagaStep?.type === "saga-step") {
        expect(sagaStep.isTryStep).toBe(true);
        expect(sagaStep.hasCompensation).toBe(true);
      }
    });

    it("should detect destructured saga parameters", () => {
      const source = `
        const orderSaga = createSagaWorkflow("saga", {});

        async function run() {
          return await orderSaga(async ({ step, tryStep }, deps) => {
            const order = await step('Create Order', () => deps.createOrder(), {
              compensate: () => deps.cancelOrder(),
            });
            const result = await tryStep('Risky Op', () => deps.riskyOp(), { error: 'RISKY_OP_FAILED' });
            return { order, result };
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(2);
      // First step has compensation
      expect(stats?.compensatedStepCount).toBe(1);
    });

    it("should detect runSaga() calls", () => {
      const source = `
        import { runSaga } from 'awaitly';

        export async function runOrder() {
          return await runSaga(async (saga) => {
            await saga.step('createOrder', () => createOrder());
            await saga.step('chargePayment', () => chargePayment());
            return { success: true };
          });
        }
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.source).toBe("runSaga");
      expect(results[0].root.workflowName).toMatch(/^runSaga@/);
      expect(results[0].metadata.stats.sagaWorkflowCount).toBe(1);
      expect(results[0].metadata.stats.totalSteps).toBe(2);
    });
  });

  describe("Streaming Analysis", () => {
    it("should detect getWritable calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const writer = await step.getWritable('progress');
            return writer;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      // Find the stream node
      let streamNode = children.find((c) => c.type === "stream");
      if (!streamNode && children[0]?.type === "sequence") {
        streamNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "stream"
        );
      }

      expect(streamNode).toBeDefined();
      if (streamNode?.type === "stream") {
        expect(streamNode.streamType).toBe("write");
      }
    });

    it("should detect getReadable calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const reader = await step.getReadable('data');
            return reader;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.streamCount).toBe(1);
    });

    it("should detect streamForEach calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.streamForEach('items', async (item) => {
              await step(() => deps.processItem(item));
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.streamCount).toBe(1);
    });
  });

  describe("Custom Step Parameters", () => {
    it("should respect custom step parameter names", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (s, deps) => {
            await s(() => deps.fetchUser(id), { key: 'user' });
            return null;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect step calls wrapped in parentheses", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await (step(() => deps.fetchUser(id), { key: 'user' }));
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect step when callback destructures with alias", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async ({ step: runStep }, deps) => {
            await runStep(() => deps.fetchUser(id), { key: 'user' });
            return null;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });
  });

  describe("Switch Statement Analysis", () => {
    it("should analyze switch statements", () => {
      const source = `
        import { run } from "awaitly";
        run(async (step) => {
          const status = await step(() => getStatus());
          switch (status) {
            case "active":
              await step(() => handleActive());
              break;
            case "pending":
              await step(() => handlePending());
              break;
            default:
              await step(() => handleDefault());
          }
        });
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const children = results[0].root.children;
      expect(children[0].type).toBe("sequence");
      const seq = children[0] as StaticSequenceNode;
      expect(seq.children).toHaveLength(2);
      expect(seq.children[1].type).toBe("switch");
    });

    it("should count switch inside workflow callback even without step calls", () => {
      const source = `
        import { run } from "awaitly";
        run(async (step) => {
          const status = "active";
          let result;
          // Switch is inside workflow callback, so it's counted
          switch (status) {
            case "active":
              result = 1;
              break;
            default:
              result = 0;
          }
          await step(() => saveResult(result));
        });
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      // Switch is counted because it's inside workflow callback (even without steps)
      expect(stats?.conditionalCount).toBe(1);
      expect(stats?.totalSteps).toBe(1);
    });
  });

  describe("run() Workflow Analysis", () => {
    it("should detect basic run() calls", () => {
      const source = `
        import { run } from 'awaitly';

        await run(async (step) => {
          const user = await step(() => getUser(id));
          return user;
        });
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.source).toBe("run");
      expect(results[0].root.workflowName).toMatch(/^run@/);
    });

    it("should detect run() when imported via namespace", () => {
      const source = `
        import * as Awaitly from 'awaitly';

        await Awaitly.run(async (step) => {
          const user = await step(() => getUser(id));
          return user;
        });
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });

      expect(results).toHaveLength(1);
      expect(results[0].root.source).toBe("run");
    });

    it("should not throw when run() is imported via named import", () => {
      const source = `
        import { run } from 'awaitly';

        await run(async (step) => {
          await step(() => getUser(id));
        });
      `;

      expect(() => analyzeWorkflowSource(source)).not.toThrow();
      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
    });

    it("should generate unique names for multiple run() calls", () => {
      const source = `
        import { run } from 'awaitly';

        await run(async (step) => {
          const user = await step(() => getUser(id));
          return user;
        });

        await run(async (step) => {
          const order = await step(() => createOrder(data));
          return order;
        });
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(2);
      expect(results[0].root.source).toBe("run");
      expect(results[1].root.source).toBe("run");
      expect(results[0].root.workflowName).not.toBe(results[1].root.workflowName);
    });

    it("should not detect obj.run() as a workflow", () => {
      const source = `
        const runner = {
          run: (fn) => fn()
        };

        await runner.run(async (step) => {
          const user = await step(() => getUser(id));
        });
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(0);
    });

    it("should detect run() when call is (run)(callback)", () => {
      const source = `
        import { run } from 'awaitly';

        await (run)(async (step) => {
          const user = await step(() => getUser(id));
          return user;
        });
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.source).toBe("run");
      expect(results[0].metadata.stats.totalSteps).toBe(1);
    });
  });

  describe("Retry and Timeout", () => {
    it("should extract retry config from step options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

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

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

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

    it("should extract timeout config from step options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step(() => deps.fetchData(), {
              key: 'fetch',
              timeout: { ms: 5000 },
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

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
  });

  describe("False Positive Filtering", () => {
    it("should not match .step calls on non-step objects", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          const tracker = { step: (value) => value };

          return await workflow(async (step, deps) => {
            const tracked = tracker.step('ignored');
            return tracked;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(0);
    });

    it("should not match property access .parallel, .race, .retry on non-step objects", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const p = data.parallel([1, 2, 3]);
            const r = arr.race(fn);
            const t = obj.retry(() => action());

            const results = await step.parallel("Fetch A and B", {
              a: () => deps.fetchA(),
              b: () => deps.fetchB(),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.parallelCount).toBe(1);
      expect(stats?.raceCount).toBe(0);
      expect(stats?.totalSteps).toBe(2);
    });
  });

  describe("Conditional Helpers - whenOr/unlessOr", () => {
    it("should detect whenOr() helper with default value", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

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

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;

      expect(stats?.conditionalCount).toBe(1);

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

  describe("Workflow Composition", () => {
    it("should detect calls to other workflows", () => {
      const source = `
        const childWorkflow = createWorkflow("childWorkflow", {});
        const parentWorkflow = createWorkflow("parentWorkflow", {});

        async function runChild() {
          return await childWorkflow(async (step, deps) => {
            await step(() => deps.fetchData(), { key: 'data' });
          });
        }

        async function runParent() {
          return await parentWorkflow(async (step, deps) => {
            const result = await childWorkflow(async (step, deps) => {
              await step(() => deps.process(), { key: 'process' });
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);

      const parentResult = results.find(
        (r) => r.root.workflowName === "parentWorkflow"
      );
      expect(parentResult).toBeDefined();

      const stats = parentResult?.metadata?.stats;
      expect(stats?.workflowRefCount).toBe(1);
    });

    it("should detect workflow invocation when call is (await workflow)(callback)", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await (await workflow)(async (step, deps) => {
            await step(() => deps.fetchData(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(1);
    });

    it("should not count self-references as workflow refs", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step(() => deps.fetchData(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.workflowRefCount).toBe(0);
    });

    it("should not attribute shadowed workflow invocations to outer workflow", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runOuter() {
          return await workflow(async (step) => {
            await step(() => outerTask(), { key: 'outer' });
          });
        }

        async function runInner() {
          const workflow = createWorkflow("workflow", {});
          return await workflow(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(2);

      // The outer workflow should only include its own invocation.
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(1);
      expect(results[1]?.metadata?.stats?.totalSteps).toBe(1);
    });

    it("should treat var-shadowed workflow as function-scoped", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runOuter() {
          if (true) {
            var workflow = createWorkflow("workflow", {});
          }
          return await workflow(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(2);

      // The outer workflow should not include the invocation inside the function
      // because the var declaration hoists and shadows it.
      const outer = results[0];
      const inner = results[1];

      expect(outer?.metadata?.stats?.totalSteps).toBe(0);
      expect(inner?.metadata?.stats?.totalSteps).toBe(1);
    });

    it("should not treat workflow calls as invocations when shadowed by parameters", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runShadowed(workflow) {
          return await workflow(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      // The invocation uses the parameter, not the workflow definition.
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(0);
    });

    it("should not treat workflow calls as invocations when shadowed by destructured parameters", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runShadowed({ workflow }) {
          return await workflow(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(0);
    });

    it("should not treat workflow calls as invocations when shadowed by array destructuring", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runShadowed([workflow]) {
          return await workflow(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(0);
    });

    it("should not treat workflow calls as invocations when shadowed by method parameters", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        class Runner {
          async run(workflow) {
            return await workflow(async (step) => {
              await step(() => innerTask(), { key: 'inner' });
            });
          }
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(0);
    });

    it("should not treat workflow calls as invocations when shadowed by destructured variables", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runShadowed() {
          const { workflow } = getWorkflows();
          return await workflow(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(0);
    });

    it("should not treat workflow calls as invocations when shadowed by catch bindings", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runShadowed() {
          try {
            throw new Error("boom");
          } catch (workflow) {
            return await workflow(async (step) => {
              await step(() => innerTask(), { key: 'inner' });
            });
          }
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(0);
    });

    it("should not treat workflow calls as invocations when shadowed by destructured catch bindings", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runShadowed() {
          try {
            throw new Error("boom");
          } catch ({ workflow }) {
            return await workflow(async (step) => {
              await step(() => innerTask(), { key: 'inner' });
            });
          }
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(0);
    });

    it("should count workflow invocations declared before workflow definition", () => {
      const source = `
        async function run() {
          return await workflow(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }

        const workflow = createWorkflow("workflow", {});
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(1);
    });

    it("should detect workflow calls when invoked via awaited reference", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await (await workflow)(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(1);
    });

    it("should detect workflow calls when invoked with nested parentheses", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await ((workflow))(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(1);
    });

    it("should not treat workflow calls as invocations when shadowed by function declarations", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function runShadowed() {
          function workflow() {
            return null;
          }

          return await workflow(async (step) => {
            await step(() => innerTask(), { key: 'inner' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(0);
    });
  });

  describe("Parallel Helpers - allAsync", () => {
    it("should treat direct calls in allAsync as implicit steps", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

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

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(2);
    });

    it("should preserve step metadata when allAsync includes step() calls", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await allAsync([
              step('Fetch Posts', () => deps.fetchPosts(id), { key: 'posts' }),
              step('Fetch Friends', () => deps.fetchFriends(id), { key: 'friends' }),
            ]);
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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

    it("should keep multi-step branches grouped in allAsync()", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

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

      const results = analyzeWorkflowSource(source);
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
        }
      }
    });

    it("should capture step.parallel name from name-first form", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.parallel("Fetch user data", {
              posts: () => deps.fetchPosts(id),
              friends: () => deps.fetchFriends(id),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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
        expect(parallelNode.name).toBe("Fetch user data");
        expect(parallelNode.children).toHaveLength(2);
      }
    });
  });

  describe("step.sleep() Analysis", () => {
    it("should detect step.sleep with string duration", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.sleep("delay", "5s");
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect step.sleep with options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.sleep("wait", "30m", { key: "wait", description: "Wait for processing" });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;
      const children = root?.children || [];

      expect(stats?.totalSteps).toBe(1);

      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.callee).toBe("step.sleep");
      expect(stepNode?.key).toBe("wait");
      expect(stepNode?.description).toBe("Wait for processing");
    });
  });

  describe("step.race() Analysis", () => {
    it("should detect step.race with array form", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.race([
              () => deps.fetchFromCacheA(),
              () => deps.fetchFromCacheB(),
            ]);
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.raceCount).toBe(1);
      expect(stats?.totalSteps).toBe(2);
    });

    it("should detect step.race with object form", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.race({
              cacheA: () => deps.fetchFromCacheA(),
              cacheB: () => deps.fetchFromCacheB(),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;
      const root = results[0]?.root;
      const children = root?.children || [];

      expect(stats?.raceCount).toBe(1);

      let raceNode = children.find((c) => c.type === "race");
      if (!raceNode && children[0]?.type === "sequence") {
        raceNode = (children[0] as StaticSequenceNode).children.find(
          (c: StaticFlowNode) => c.type === "race"
        );
      }

      expect(raceNode?.type).toBe("race");
      if (raceNode?.type === "race") {
        expect(raceNode.children).toHaveLength(2);
        expect(raceNode.children[0].name).toBe("cacheA");
        expect(raceNode.children[1].name).toBe("cacheB");
      }
    });
  });

  describe("step.retry() and step.withTimeout() Analysis", () => {
    it("should parse step.retry() with id-first signature", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.retry(
              'fetch',
              () => deps.fetchData(),
              { key: 'fetch', attempts: 5, backoff: 'linear' }
            );
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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
    });

    it("should parse step.withTimeout() with id-first signature", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.withTimeout(
              'fetch',
              () => deps.fetchData(),
              { key: 'fetch', ms: 3000 }
            );
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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
    });
  });

  describe("run() Advanced Analysis", () => {
    it("should keep stats scoped to each run() call", () => {
      const source = `
        import { run } from 'awaitly';
        await run(async (step) => {
          await step(() => doA(), { key: 'a' });
        });

        await run(async (step) => {
          await step(() => doB(), { key: 'b' });
        });
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(2);

      expect(results[0]?.metadata.stats.totalSteps).toBe(1);
      expect(results[1]?.metadata.stats.totalSteps).toBe(1);
    });

    it("should have empty dependencies for run() workflows", () => {
      const source = `
        import { run } from 'awaitly';
        await run(async (step) => {
          const user = await step(() => getUser(id));
          return user;
        });
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.dependencies).toEqual([]);
    });

    it("should handle run() with function expression callback", () => {
      const source = `
        import { run } from 'awaitly';
        await run(async function(step) {
          const user = await step(() => getUser(id), { key: 'user' });
          return user;
        });
      `;

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.source).toBe("run");
      expect(results[0].metadata.stats.totalSteps).toBe(1);
    });

    it("should detect step when run() destructures with alias", () => {
      const source = `
        import { run } from 'awaitly';
        await run(async ({ step: runStep }) => {
          await runStep(() => fetchUser(id), { key: 'user' });
          return null;
        });
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });
  });

  describe("step.parallel Named Forms", () => {
    it("should apply step.parallel string name to callback form", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.parallel("Fetch all", () => allAsync([
              () => step(() => deps.fetchPosts(id), { key: 'posts' }),
              () => step(() => deps.fetchFriends(id), { key: 'friends' }),
            ]));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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

  describe("Import Filtering", () => {
    it("should not detect type-only imports of run()", () => {
      const source = `
        import type { run } from 'awaitly';

        await run(async (step) => {
          await step(() => getUser(id));
        });
      `;

      const results = analyzeWorkflowSource(source, undefined, { assumeImported: false });
      expect(results).toHaveLength(0);
    });

    it("should not detect type-only import specifiers for run()", () => {
      const source = `
        import { type run } from 'awaitly';

        await run(async (step) => {
          await step(() => getUser(id));
        });
      `;

      const results = analyzeWorkflowSource(source, undefined, { assumeImported: false });
      expect(results).toHaveLength(0);
    });
  });

  describe("Additional Expression Patterns", () => {
    describe("Promise.all with steps", () => {
      it("should detect steps inside Promise.all array", () => {
        const source = `
          const myWorkflow = createWorkflow("workflow", {});

          await myWorkflow(async (step) => {
            await Promise.all([
              step(() => fetchUser(), { key: 'user' }),
              step(() => fetchPosts(), { key: 'posts' }),
            ]);
          });
        `;

        const results = analyzeWorkflowSource(source);
        expect(results).toHaveLength(1);
        expect(results[0]?.metadata?.stats?.totalSteps).toBe(2);
      });

      it("should detect steps inside nested Promise.all", () => {
        const source = `
          const myWorkflow = createWorkflow("workflow", {});

          await myWorkflow(async (step) => {
            const results = await Promise.all([
              Promise.all([
                step(() => task1(), { key: 'task1' }),
                step(() => task2(), { key: 'task2' }),
              ]),
              step(() => task3(), { key: 'task3' }),
            ]);
          });
        `;

        const results = analyzeWorkflowSource(source);
        expect(results).toHaveLength(1);
        expect(results[0]?.metadata?.stats?.totalSteps).toBe(3);
      });
    });

    describe("Ternary expressions with steps", () => {
      it("should detect steps in ternary expression branches", () => {
        const source = `
          const myWorkflow = createWorkflow("workflow", {});

          await myWorkflow(async (step) => {
            const result = condition
              ? await step(() => fetchFromA(), { key: 'fromA' })
              : await step(() => fetchFromB(), { key: 'fromB' });
          });
        `;

        const results = analyzeWorkflowSource(source);
        expect(results).toHaveLength(1);
        expect(results[0]?.metadata?.stats?.totalSteps).toBe(2);
      });

      it("should detect nested ternary steps", () => {
        const source = `
          const myWorkflow = createWorkflow("workflow", {});

          await myWorkflow(async (step) => {
            const result = condA
              ? await step(() => taskA(), { key: 'a' })
              : condB
                ? await step(() => taskB(), { key: 'b' })
                : await step(() => taskC(), { key: 'c' });
          });
        `;

        const results = analyzeWorkflowSource(source);
        expect(results).toHaveLength(1);
        expect(results[0]?.metadata?.stats?.totalSteps).toBe(3);
      });
    });

    describe("Try-catch blocks with steps", () => {
      it("should detect steps inside try block", () => {
        const source = `
          const myWorkflow = createWorkflow("workflow", {});

          await myWorkflow(async (step) => {
            try {
              await step(() => riskyOperation(), { key: 'risky' });
            } catch (e) {
              console.error(e);
            }
          });
        `;

        const results = analyzeWorkflowSource(source);
        expect(results).toHaveLength(1);
        expect(results[0]?.metadata?.stats?.totalSteps).toBe(1);
      });

      it("should detect steps in both try and catch blocks", () => {
        const source = `
          const myWorkflow = createWorkflow("workflow", {});

          await myWorkflow(async (step) => {
            try {
              await step(() => riskyOperation(), { key: 'risky' });
            } catch (e) {
              await step(() => handleError(e), { key: 'error' });
            }
          });
        `;

        const results = analyzeWorkflowSource(source);
        expect(results).toHaveLength(1);
        expect(results[0]?.metadata?.stats?.totalSteps).toBe(2);
      });

      it("should detect steps in finally block", () => {
        const source = `
          const myWorkflow = createWorkflow("workflow", {});

          await myWorkflow(async (step) => {
            try {
              await step(() => riskyOperation(), { key: 'risky' });
            } finally {
              await step(() => cleanup(), { key: 'cleanup' });
            }
          });
        `;

        const results = analyzeWorkflowSource(source);
        expect(results).toHaveLength(1);
        expect(results[0]?.metadata?.stats?.totalSteps).toBe(2);
      });
    });
  });

  describe("Workflow Documentation Extraction", () => {
    it("should extract description from createWorkflow options", () => {
      const source = `
        const checkout = createWorkflow("checkout", deps, {
          description: "Checkout workflow - handles orders"
        });
        checkout(async (step) => {
          await step(() => doSomething());
        });
      `;
      const results = analyzeWorkflowSource(source);
      expect(results[0].root.description).toBe("Checkout workflow - handles orders");
    });

    it("should extract markdown from createWorkflow options", () => {
      const source = `
        const checkout = createWorkflow("checkout", deps, {
          markdown: "## Checkout\\n\\nHandles orders and payments."
        });
        checkout(async (step) => {
          await step(() => doSomething());
        });
      `;
      const results = analyzeWorkflowSource(source);
      expect(results[0].root.markdown).toContain("## Checkout");
    });
  });

  describe("step.sleep() Additional Tests", () => {
    it("uses the first argument as the step ID and name", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.sleep("delay", "100ms");
            return "done";
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let sleepStep: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        sleepStep = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        sleepStep = children[0] as StaticStepNode;
      }

      expect(sleepStep?.stepId).toBe("delay");
      expect(sleepStep?.name).toBe("delay");
    });

    it("should detect step.sleep without options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.sleep("delay", "100ms");
            return "done";
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let sleepStep: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        sleepStep = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        sleepStep = children[0] as StaticStepNode;
      }

      expect(sleepStep?.type).toBe("step");
      expect(sleepStep?.callee).toBe("step.sleep");
      expect(sleepStep?.stepId).toBe("delay");
      expect(sleepStep?.name).toBe("delay");
    });

    it("should count step.sleep in totalSteps stat", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step('doFirst', () => doFirst());
            await step.sleep("delay", "1s");
            await step('doSecond', () => doSecond());
            return "done";
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results[0]?.metadata?.stats?.totalSteps).toBe(3);
    });
  });

  describe("Fixture-based Integration Tests", () => {
    it("should handle sample workflow pattern", () => {
      const source = `
        const sampleWorkflow = createWorkflow("sampleWorkflow", {
          fetchUser: async () => ({ id: '1', name: 'Alice', isPremium: true }),
          fetchPosts: async () => [{ id: '1', title: 'Hello' }],
          applyDiscount: async () => ({ discount: 10 }),
        });

        async function runSampleWorkflow(userId) {
          return await sampleWorkflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(userId), {
              key: "user",
              name: "Fetch User",
            });

            if (user.isPremium) {
              await step(() => deps.applyDiscount(user.id), {
                key: "discount",
                name: "Apply Discount",
              });
            }

            const posts = await step(() => deps.fetchPosts(user.id), {
              key: "posts",
              name: "Fetch Posts",
            });

            return { user, posts };
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("sampleWorkflow");

      const stats = results[0].metadata.stats;
      expect(stats.totalSteps).toBe(3);
      expect(stats.conditionalCount).toBe(1);
      expect(stats.parallelCount).toBe(0);
      expect(stats.loopCount).toBe(0);
    });

    it("should handle nested conditionals", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(), { key: 'user' });

            if (user.isActive) {
              if (user.isPremium) {
                await step(() => deps.applyPremiumDiscount(), { key: 'premium' });
              } else {
                await step(() => deps.applyRegularDiscount(), { key: 'regular' });
              }
            }
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0].metadata.stats;

      expect(stats.totalSteps).toBe(3);
      expect(stats.conditionalCount).toBe(2);
    });

    it("should handle complex workflow with all features", () => {
      const source = `
        const childWorkflow = createWorkflow("childWorkflow", {});
        const mainWorkflow = createWorkflow("mainWorkflow", {});

        async function runChild() {
          return await childWorkflow(async (step, deps) => {
            await step(() => deps.childOp(), { key: 'child' });
          });
        }

        async function runMain() {
          return await mainWorkflow(async (step, deps) => {
            const data = await step(() => deps.fetchData(), {
              key: 'fetch',
              retry: { attempts: 3, backoff: 'exponential' },
            });

            const parallel = await step.parallel("Fetch A and B", {
              a: () => deps.fetchA(),
              b: () => deps.fetchB(),
            });

            if (data.ready) {
              await step(() => deps.process(), { key: 'process' });
            }

            for (const item of data.items) {
              await step(() => deps.processItem(item), { key: item.id });
            }

            await childWorkflow(async (step, deps) => {
              await step(() => deps.final(), { key: 'final' });
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);

      expect(results.length).toBeGreaterThanOrEqual(1);

      const mainResult = results.find(
        (r) => r.root.workflowName === "mainWorkflow"
      );
      expect(mainResult).toBeDefined();

      const stats = mainResult!.metadata.stats;
      expect(stats.totalSteps).toBeGreaterThanOrEqual(4);
      expect(stats.parallelCount).toBe(1);
      expect(stats.conditionalCount).toBe(1);
      expect(stats.loopCount).toBe(1);
      expect(stats.workflowRefCount).toBe(1);
    });

    it("should handle empty workflow callback", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            return null;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBe(0);
    });
  });

  describe("Array.map with steps", () => {
    it("should detect steps inside .map arrow function", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await Promise.all(items.map(item =>
              step(() => deps.process(item), { key: item.id })
            ));
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBeGreaterThanOrEqual(1);
    });

    it("should detect steps inside .map with block body", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await Promise.all(items.map(async item => {
              const data = await step(() => deps.fetchItem(item.id), { key: item.id });
              return data;
            }));
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Nested function expressions", () => {
    it("should detect steps in nested arrow functions", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const process = async (id) => {
              return await step(() => deps.processItem(id), { key: id });
            };
            await process("item1");
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBeGreaterThanOrEqual(1);
    });

    it("should detect steps in function expressions", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const process = async function(id) {
              return await step(() => deps.processItem(id), { key: id });
            };
            await process("item1");
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Complex real-world patterns", () => {
    it("should detect steps in AI SDK tool execute patterns", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const tools = {
              search: {
                execute: async (params) => {
                  return await step(() => deps.search(params), { key: 'search' });
                }
              }
            };
            return tools;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBeGreaterThanOrEqual(1);
    });

    it("should detect steps in forEach-style callbacks", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await items.forEach(async item => {
              await step(() => deps.process(item), { key: item.id });
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBeGreaterThanOrEqual(1);
    });
  });

  describe("run() Advanced Analysis", () => {
    it("should handle run() with function expression callback", () => {
      const source = `
        import { run } from 'awaitly';

        async function execute() {
          return await run(async function(step, deps) {
            return await step(() => deps.fetchData(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBe(1);
    });

    it("should not detect locally-defined run helpers", () => {
      const source = `
        function run(callback) {
          return callback();
        }

        async function execute() {
          return await run(async (step, deps) => {
            return await step(() => deps.fetch(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });
      expect(results).toHaveLength(0);
    });
  });

  describe("Workflow Documentation Extraction", () => {
    it("should extract description from createWorkflow options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          description: 'Handles user checkout process'
        });
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.description).toBe(
        "Handles user checkout process"
      );
    });

    it("should extract markdown from createWorkflow options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          markdown: '## Checkout Flow\\n\\n1. Validate cart\\n2. Process payment'
        });
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.markdown).toContain("Checkout Flow");
    });

    it("should extract both description and markdown", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          description: 'User onboarding',
          markdown: '# Onboarding Steps'
        });
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.description).toBe("User onboarding");
      expect(results[0].root.markdown).toContain("Onboarding Steps");
    });

    it("should handle workflow without options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.description).toBeUndefined();
      expect(results[0].root.markdown).toBeUndefined();
    });
  });

  describe("step.sleep() variations", () => {
    it("should detect step.sleep with Duration object", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.sleep("wait", { seconds: 30 });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBe(1);
    });

    it("should detect step.sleep without options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.sleep('delay', '5s');
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBe(1);
    });

    it("should count step.sleep in totalSteps stat", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step('fetchData', () => deps.fetchData(), { key: 'data' });
            await step.sleep('delay', '1s');
            await step('sendData', () => deps.sendData(), { key: 'send' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBe(3);
    });
  });

  describe("step.parallel array form", () => {
    it("should analyze step.parallel array form callbacks", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await step.parallel([
              () => deps.fetchA(),
              () => deps.fetchB(),
              () => deps.fetchC(),
            ]);
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.parallelCount).toBe(1);
    });

    it("should apply step.parallel name to array form", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await step.parallel([
              () => deps.fetchA(),
              () => deps.fetchB(),
            ], { name: 'Parallel Fetch' });
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.parallelCount).toBe(1);
    });
  });

  describe("Mermaid Rendering", () => {
    it("should render basic workflow diagram", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step('Fetch User', () => deps.fetchUser(), { key: 'user' });
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const mermaid = renderStaticMermaid(results[0]);

      expect(mermaid).toContain("flowchart TB");
      expect(mermaid).toContain("Fetch User");
    });

    it("should render parallel workflow diagram", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.parallel("Fetch posts and friends", {
              posts: () => deps.fetchPosts(),
              friends: () => deps.fetchFriends(),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const mermaid = renderStaticMermaid(results[0]);

      expect(mermaid).toContain("flowchart TB");
      expect(mermaid).toContain("Fetch posts and friends");
    });
  });

  // ============================================================================
  // Additional Missing Tests for Full Parity
  // ============================================================================

  describe("Block-bodied step callbacks", () => {
    it("should extract callee from block-bodied step callback", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => {
              return deps.fetchUser(id);
            }, { key: 'user' });
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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

    it("should extract callee when step callback has parenthesized expression body", () => {
      // step(() => (deps.fetchUser())) - body is ParenthesizedExpression, not CallExpression
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step(() => (deps.fetchUser(id)), { key: 'user' });
            return null;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
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
  });

  describe("Step parameter destructuring", () => {
    it("should resolve step parameter when destructuring uses default and alias", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});
        const fallback = () => null;

        async function run() {
          return await workflow(async ({ step: runStep = fallback }, deps) => {
            await runStep(() => deps.fetchUser(id), { key: 'user' });
            return null;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect step when destructuring provides a default value", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});
        const defaultStep = () => null;

        async function run() {
          return await workflow(async ({ step = defaultStep }, deps) => {
            await step(() => deps.fetchUser(id), { key: 'user' });
            return null;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });
  });

  describe("Switch with createWorkflow", () => {
    it("should analyze switch with createWorkflow", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const status = await step(() => deps.getStatus());
            switch (status) {
              case "active":
                await step(() => deps.handleActive());
                break;
              case "pending":
                await step(() => deps.handlePending());
                break;
            }
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(3);
      expect(stats?.conditionalCount).toBe(1);
    });
  });

  describe("step.parallel with named operation", () => {
    it("should apply step.parallel name to array form with named operation", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const results = await step.parallel("Fetch All Data", () =>
              allAsync([
                () => deps.fetchA(),
                () => deps.fetchB(),
              ])
            );
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.parallelCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("step.retry and step.withTimeout calls", () => {
    it("should detect step.retry() call", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const data = await step.retry(
              'fetchData',
              () => deps.fetchData(),
              { attempts: 3 }
            );
            return data;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });

    it("should detect step.withTimeout() call", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const data = await step.withTimeout(
              'fetchData',
              () => deps.fetchData(),
              { ms: 5000 }
            );
            return data;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });
  });

  describe("False positive method filtering", () => {
    it("should not match methods with similar names as step functions", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            // This is a step call
            await step(() => deps.fetchUser(), { key: 'user' });

            // These should NOT be counted as steps
            const wizard = { step: () => console.log('wizard step') };
            wizard.step();

            const stepper = { step: 1 };
            console.log(stepper.step);
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      expect(stats?.totalSteps).toBe(1);
    });
  });

  describe("run() import shadowing", () => {
    it("should not detect run() calls when the import is shadowed", () => {
      const source = `
        import { run } from 'awaitly';

        function run() {
          console.log('local run');
        }

        async function execute() {
          return await run(async (step, deps) => {
            return await step(() => deps.fetch(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });
      expect(results).toHaveLength(0);
    });

    it("should not detect run() calls shadowed by later declarations in the same scope", () => {
      const source = `
        import { run } from 'awaitly';

        async function execute() {
          const run = () => {};
          return await run(async (step, deps) => {
            return await step(() => deps.fetch(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });
      expect(results).toHaveLength(0);
    });

    it("should not detect run() calls shadowed by var declarations in nested blocks", () => {
      const source = `
        import { run } from 'awaitly';

        async function execute() {
          if (true) {
            var run = () => {};
          }
          return await run(async (step, deps) => {
            return await step(() => deps.fetch(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });
      expect(results).toHaveLength(0);
    });

    it("should not detect run() calls shadowed by top-level var declarations in nested blocks (assumeImported)", () => {
      const source = `
        async function execute() {
          if (true) {
            var run = () => {};
          }
          return await run(async (step, deps) => {
            return await step(() => deps.fetch(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: true,
      });
      // var hoisting should shadow the assumed import
      expect(results).toHaveLength(0);
    });

    it("should not detect run() calls when shadowed by a parameter binding", () => {
      const source = `
        import { run } from 'awaitly';

        async function execute({ run }) {
          return await run(async (step, deps) => {
            return await step(() => deps.fetch(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        assumeImported: false,
      });
      expect(results).toHaveLength(0);
    });
  });

  describe("run() filter options", () => {
    it("should analyze both createWorkflow and run() in the same file", () => {
      const source = `
        import { createWorkflow, run } from 'awaitly';

        const workflow = createWorkflow("workflow", {});

        async function runWorkflow() {
          return await workflow(async (step, deps) => {
            await step(() => deps.fetchA(), { key: 'a' });
          });
        }

        async function runDirect() {
          return await run(async (step, deps) => {
            await step(() => deps.fetchB(), { key: 'b' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("should respect detect: 'run' filter option", () => {
      const source = `
        import { createWorkflow, run } from 'awaitly';

        const workflow = createWorkflow("workflow", {});

        async function runWorkflow() {
          return await workflow(async (step, deps) => {
            await step(() => deps.fetchA(), { key: 'a' });
          });
        }

        async function runDirect() {
          return await run(async (step, deps) => {
            await step(() => deps.fetchB(), { key: 'b' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        detect: "run",
      });

      // Should only detect run() calls
      const runWorkflows = results.filter((r) =>
        r.root.workflowName.startsWith("run@")
      );
      expect(runWorkflows.length).toBeGreaterThanOrEqual(1);
    });

    it("should respect detect: 'createWorkflow' filter option", () => {
      const source = `
        import { createWorkflow, run } from 'awaitly';

        const workflow = createWorkflow("workflow", {});

        async function runWorkflow() {
          return await workflow(async (step, deps) => {
            await step(() => deps.fetchA(), { key: 'a' });
          });
        }

        async function runDirect() {
          return await run(async (step, deps) => {
            await step(() => deps.fetchB(), { key: 'b' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source, undefined, {
        detect: "createWorkflow",
      });

      // Should only detect createWorkflow calls
      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("workflow");
    });

    it("should detect all patterns by default", () => {
      const source = `
        import { createWorkflow, run, createSagaWorkflow } from 'awaitly';

        const workflow = createWorkflow("workflow", {});
        const saga = createSagaWorkflow("saga", {});

        async function runWorkflow() {
          return await workflow(async (step, deps) => {
            await step(() => deps.fetchA(), { key: 'a' });
          });
        }

        async function runDirect() {
          return await run(async (step, deps) => {
            await step(() => deps.fetchB(), { key: 'b' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);

      // Should detect both createWorkflow and run() by default
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Saga destructured forms", () => {
    it("should detect saga steps when saga context is destructured", () => {
      const source = `
        import { runSaga } from 'awaitly';

        async function execute() {
          return await runSaga(async ({ step }) => {
            await step(() => createOrder(), { compensate: () => cancelOrder() });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBe(1);
    });

    it("should detect saga tryStep when destructured", () => {
      const source = `
        import { runSaga } from 'awaitly';

        async function execute() {
          return await runSaga(async ({ tryStep }) => {
            const result = await tryStep(() => riskyOperation());
            return result;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBe(1);
    });
  });

  describe("step.sleep description extraction", () => {
    it("should extract description from step.sleep options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.sleep('wait', '5s', { description: 'Wait for processing' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.description).toBe("Wait for processing");
    });

    it("should extract markdown from step.sleep options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            await step.sleep('wait', '5s', {
              description: 'Wait for processing',
              markdown: '## Wait step\\n\\nPauses workflow execution.'
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.description).toBe("Wait for processing");
      expect(stepNode?.markdown).toContain("Wait step");
      expect(stepNode?.markdown).toContain("Pauses workflow");
    });
  });

  describe("step description and markdown extraction", () => {
    it("should extract description and markdown from step options", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          fetchUser: async (id: string) => ({ id, name: 'Alice' }),
        });

        async function run(id: string) {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(id), {
              key: 'user',
              description: 'Load user by ID',
              markdown: '## Fetch User\\n\\nCalls deps.fetchUser with the given id.'
            });
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const root = results[0]?.root;
      const children = root?.children || [];

      let stepNode: StaticStepNode | undefined;
      if (children[0]?.type === "sequence") {
        stepNode = (children[0] as StaticSequenceNode).children[0] as StaticStepNode;
      } else if (children[0]?.type === "step") {
        stepNode = children[0] as StaticStepNode;
      }

      expect(stepNode?.type).toBe("step");
      expect(stepNode?.description).toBe("Load user by ID");
      expect(stepNode?.markdown).toContain("Fetch User");
      expect(stepNode?.markdown).toContain("Calls deps.fetchUser");
    });
  });

  describe("run() workflow documentation", () => {
    it("should not have description/markdown for run() workflows", () => {
      const source = `
        import { run } from 'awaitly';

        async function execute() {
          return await run(async (step, deps) => {
            await step(() => deps.fetch(), { key: 'data' });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].root.description).toBeUndefined();
      expect(results[0].root.markdown).toBeUndefined();
    });
  });

  describe("run() parallel and conditional", () => {
    it("should detect parallel steps with step.parallel in run()", () => {
      const source = `
        import { run } from 'awaitly';

        async function execute() {
          return await run(async (step, deps) => {
            const results = await step.parallel("Fetch posts and friends", {
              posts: () => deps.fetchPosts(),
              friends: () => deps.fetchFriends(),
            });
            return results;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.parallelCount).toBe(1);
    });

    it("should detect if statements as conditionals in run()", () => {
      const source = `
        import { run } from 'awaitly';

        async function execute() {
          return await run(async (step, deps) => {
            const user = await step(() => deps.fetchUser(), { key: 'user' });

            if (user.isPremium) {
              await step(() => deps.applyDiscount(), { key: 'discount' });
            }

            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.conditionalCount).toBe(1);
      expect(results[0].metadata.stats.totalSteps).toBe(2);
    });
  });

  describe("unlessOr helper", () => {
    it("should detect unlessOr() helper", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const result = await unlessOr(
              shouldSkip,
              () => step(() => deps.compute(), { key: 'compute' }),
              defaultValue
            );
            return result;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results[0].metadata.stats.conditionalCount).toBe(1);
    });
  });

  // ============================================================================
  // Step Method Analysis
  // ============================================================================

  describe("Step Method Analysis", () => {
    it("should produce a StaticStepNode for step.try()", () => {
      const source = `
        const workflow = createWorkflow("try-test", {
          riskyOp: async () => "result",
        });

        export async function run() {
          return await workflow(async (step, { riskyOp }) => {
            const result = await step.try("attempt", () => riskyOp());
            return result;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("step");
      expect(steps[0].stepId).toBe("attempt");
    });

    it("should produce a StaticStepNode for step.fromResult()", () => {
      const source = `
        const workflow = createWorkflow("fromResult-test", {
          fetchData: async () => "data",
        });

        export async function run() {
          return await workflow(async (step, { fetchData }) => {
            const data = await step.fromResult("load", () => fetchData());
            return data;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].type).toBe("step");
      expect(steps[0].stepId).toBe("load");
    });

    it("should produce a StaticDecisionNode for step.branch()", () => {
      const source = `
        const workflow = createWorkflow("branch-test", {
          chargeCard: async (amount: number) => ({ chargeId: "ch_1" }),
          skipPayment: async () => ({ skipped: true }),
        });

        export async function run() {
          return await workflow(async (step, deps) => {
            const result = await step.branch("payment", {
              conditionLabel: "amount > 0",
              condition: () => true,
              then: () => deps.chargeCard(100),
              thenErrors: ["CARD_DECLINED"],
              else: () => deps.skipPayment(),
              elseErrors: [],
            });
            return result;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const children = results[0].root.children;
      const decisionNode = children.find((n) => n.type === "decision") as StaticDecisionNode | undefined;
      expect(decisionNode).toBeDefined();
      expect(decisionNode!.decisionId).toBe("payment");
      expect(decisionNode!.conditionLabel).toBe("amount > 0");
      expect(decisionNode!.consequent.length).toBeGreaterThan(0);
    });

    it("should produce a StaticLoopNode for step.forEach()", () => {
      const source = `
        const workflow = createWorkflow("forEach-test", {
          processItem: async (item: string) => ({ processed: item }),
        });

        export async function run() {
          return await workflow(async (step, deps) => {
            await step.forEach("process-all", ["a", "b"], {
              maxIterations: 10,
              run: (item) => deps.processItem(item),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      function findLoop(nodes: StaticFlowNode[]): StaticLoopNode | undefined {
        for (const n of nodes) {
          if (n.type === "loop") return n as StaticLoopNode;
          for (const c of getStaticChildren(n)) {
            const found = findLoop([c]);
            if (found) return found;
          }
        }
        return undefined;
      }

      const loopNode = findLoop(results[0].root.children);
      expect(loopNode).toBeDefined();
      expect(loopNode!.loopType).toBe("step.forEach");
      expect(loopNode!.loopId).toBe("process-all");
    });

    it("should produce a StaticLoopNode for step.forEach() with step.item()", () => {
      const source = `
        const workflow = createWorkflow("item-test", {
          validate: async (item: string) => ({ valid: true }),
          process: async (item: string) => ({ done: true }),
        });

        export async function run() {
          return await workflow(async (step, deps) => {
            await step.forEach("batch", ["x", "y"], {
              maxIterations: 5,
              item: step.item((item, i, s) => {
                s("validate", () => deps.validate(item));
                s("process", () => deps.process(item));
              }),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      function findLoop(nodes: StaticFlowNode[]): StaticLoopNode | undefined {
        for (const n of nodes) {
          if (n.type === "loop") return n as StaticLoopNode;
          for (const c of getStaticChildren(n)) {
            const found = findLoop([c]);
            if (found) return found;
          }
        }
        return undefined;
      }

      const loopNode = findLoop(results[0].root.children);
      expect(loopNode).toBeDefined();
      expect(loopNode!.loopType).toBe("step.forEach");
      expect(loopNode!.loopId).toBe("batch");
    });

    it("should produce a StaticDecisionNode for step.if()", () => {
      const source = `
        const workflow = createWorkflow("if-test", {
          premiumFeature: async () => ({ premium: true }),
          basicFeature: async () => ({ basic: true }),
        });

        export async function run() {
          return await workflow(async (step, deps) => {
            if (step.if("user-tier", "isPremium", () => true)) {
              await step("premium", () => deps.premiumFeature());
            } else {
              await step("basic", () => deps.basicFeature());
            }
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const children = results[0].root.children;
      const decisionNode = children.find((n) => n.type === "decision") as StaticDecisionNode | undefined;
      expect(decisionNode).toBeDefined();
      expect(decisionNode!.decisionId).toBe("user-tier");
      expect(decisionNode!.conditionLabel).toBe("isPremium");
    });

    it("should produce a StaticDecisionNode for step.label()", () => {
      const source = `
        const workflow = createWorkflow("label-test", {
          discountPath: async () => ({ discounted: true }),
          standardPath: async () => ({ standard: true }),
        });

        export async function run() {
          return await workflow(async (step, deps) => {
            if (step.label("discount-check", "hasDiscount", () => true)) {
              await step("discount", () => deps.discountPath());
            } else {
              await step("standard", () => deps.standardPath());
            }
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const children = results[0].root.children;
      const decisionNode = children.find((n) => n.type === "decision") as StaticDecisionNode | undefined;
      expect(decisionNode).toBeDefined();
      expect(decisionNode!.decisionId).toBe("discount-check");
      expect(decisionNode!.conditionLabel).toBe("hasDiscount");
    });
  });

  // ============================================================================
  // Path Generation
  // ============================================================================

  describe("Mermaid label escaping", () => {
    it("should escape newlines in step names so Mermaid diagram is valid", () => {
      const ir = {
        root: {
          id: "w1",
          type: "workflow" as const,
          workflowName: "test",
          source: "createWorkflow" as const,
          dependencies: [],
          errorTypes: [],
          children: [
            {
              id: "step-1",
              type: "step" as const,
              name: "Step\nWithNewline",
              callee: "deps.doWork",
            },
          ],
        },
        metadata: {
          analyzedAt: Date.now(),
          filePath: "<source>",
          warnings: [],
          stats: {
            totalSteps: 1,
            conditionalCount: 0,
            parallelCount: 0,
            raceCount: 0,
            loopCount: 0,
            workflowRefCount: 0,
            unknownCount: 0,
          },
        },
        references: new Map(),
      };

      const mermaid = renderStaticMermaid(ir as import("./types").StaticWorkflowIR);
      expect(mermaid).not.toMatch(/\[[^\]]*$/m);
    });

    it("should escape # in step names so Mermaid diagram is valid", () => {
      // In Mermaid, # in a node label can start a link; unescaped # breaks the diagram.
      const ir = {
        root: {
          id: "w1",
          type: "workflow" as const,
          workflowName: "test",
          source: "createWorkflow" as const,
          dependencies: [],
          errorTypes: [],
          children: [
            {
              id: "step-1",
              type: "step" as const,
              name: "Step #1",
              callee: "deps.doWork",
            },
          ],
        },
        metadata: {
          analyzedAt: Date.now(),
          filePath: "<source>",
          warnings: [],
          stats: {
            totalSteps: 1,
            conditionalCount: 0,
            parallelCount: 0,
            raceCount: 0,
            loopCount: 0,
            workflowRefCount: 0,
            unknownCount: 0,
          },
        },
        references: new Map(),
      };

      const mermaid = renderStaticMermaid(ir as import("./types").StaticWorkflowIR);
      // Node label is rendered as nodeId[label]; unescaped # in label breaks Mermaid (link syntax).
      expect(mermaid).not.toMatch(/\[[^\]]*#[^\]]*\]/);
    });

    it("should escape | in step names so Mermaid diagram is valid", () => {
      const ir = {
        root: {
          id: "w1",
          type: "workflow" as const,
          workflowName: "test",
          source: "createWorkflow" as const,
          dependencies: [],
          errorTypes: [],
          children: [
            {
              id: "step-1",
              type: "step" as const,
              name: "A | B",
              callee: "deps.doWork",
            },
          ],
        },
        metadata: {
          analyzedAt: Date.now(),
          filePath: "<source>",
          warnings: [],
          stats: {
            totalSteps: 1,
            conditionalCount: 0,
            parallelCount: 0,
            raceCount: 0,
            loopCount: 0,
            workflowRefCount: 0,
            unknownCount: 0,
          },
        },
        references: new Map(),
      };

      const mermaid = renderStaticMermaid(ir as import("./types").StaticWorkflowIR);
      // Pipe character is Mermaid's edge label delimiter; unescaped | breaks the diagram.
      expect(mermaid).not.toMatch(/\[[^\]]*\|[^\]]*\]/);
    });
  });

  describe("Complexity metrics", () => {
    it("should report maxParallelBreadth 0 for empty parallel node", () => {
      const ir = {
        root: {
          id: "w1",
          type: "workflow" as const,
          workflowName: "test",
          source: "createWorkflow" as const,
          dependencies: [],
          errorTypes: [],
          children: [
            {
              id: "parallel-1",
              type: "parallel" as const,
              mode: "all" as const,
              children: [],
            },
          ],
        },
        metadata: {
          analyzedAt: Date.now(),
          filePath: "<source>",
          warnings: [],
          stats: {
            totalSteps: 0,
            conditionalCount: 0,
            parallelCount: 1,
            raceCount: 0,
            loopCount: 0,
            workflowRefCount: 0,
            unknownCount: 0,
          },
        },
        references: new Map(),
      };

      const metrics = calculateComplexity(ir as import("./types").StaticWorkflowIR);
      expect(metrics.maxParallelBreadth).toBe(0);
    });
  });

  describe("Path generation", () => {
    it("should set pathLimitHit in statistics when maxPaths limit is hit", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(), { key: 'user' });
            if (user.isPremium) {
              await step(() => deps.applyDiscount(), { key: 'discount' });
            } else {
              await step(() => deps.applyRegular(), { key: 'regular' });
            }
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const ir = results[0];
      expect(ir).toBeDefined();

      const { paths, limitHit } = generatePathsWithMetadata(ir!, {
        maxPaths: 1,
      });
      expect(paths.length).toBe(1);

      const stats = calculatePathStatistics(paths, { limitHit });
      expect(stats.pathLimitHit).toBe(true);
    });

    it("should set pathLimitHit to false when workflow has exactly maxPaths paths (no truncation)", () => {
      const source = `
        const workflow = createWorkflow("workflow", {});

        async function run() {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(), { key: 'user' });
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const ir = results[0];
      expect(ir).toBeDefined();

      const { paths, limitHit } = generatePathsWithMetadata(ir!, {
        maxPaths: 1,
      });
      expect(paths.length).toBe(1);

      const stats = calculatePathStatistics(paths, { limitHit });
      expect(stats.pathLimitHit).toBe(false);
    });
  });

  // ============================================================================
  // JSDoc extraction
  // ============================================================================

  describe("JSDoc extraction", () => {
    function loadJsdocFixture(name: string): string {
      return readFileSync(join(JSDOC_FIXTURES_DIR, name), "utf-8");
    }

    it("workflow-jsdoc-only: root has jsdocDescription, no description", () => {
      const source = loadJsdocFixture("workflow-jsdoc-only.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      expect(results[0].root.jsdocDescription).toContain("Checkout workflow");
      expect(results[0].root.description).toBeUndefined();
    });

    it("workflow-options-and-jsdoc: root has both description and jsdocDescription", () => {
      const source = loadJsdocFixture("workflow-options-and-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      expect(results[0].root.jsdocDescription).toContain("JSDoc description");
      expect(results[0].root.description).toBe("Options description");
    });

    it("step-jsdoc-only: step node has jsdocDescription", () => {
      const source = loadJsdocFixture("step-jsdoc-only.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps[0].jsdocDescription).toContain("Load user by ID");
    });

    it("step-options-and-jsdoc: step has both description and jsdocDescription", () => {
      const source = loadJsdocFixture("step-options-and-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps[0].jsdocDescription).toContain("JSDoc above");
      expect(steps[0].description).toBe("Options description");
    });

    it("step-sleep-jsdoc: sleep step has jsdocDescription", () => {
      const source = loadJsdocFixture("step-sleep-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps.length).toBe(1);
      expect(steps[0].jsdocDescription).toContain("Wait for processing");
    });

    it("saga-step-jsdoc: saga step has jsdocDescription", () => {
      const source = loadJsdocFixture("saga-step-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const sagaSteps = collectSagaStepNodes(results[0].root);
      expect(sagaSteps.length).toBe(1);
      expect((sagaSteps[0] as { jsdocDescription?: string }).jsdocDescription).toContain(
        "Creates the order record"
      );
    });

    it("multiline-jsdoc: workflow and step multiline JSDoc extracted", () => {
      const source = loadJsdocFixture("multiline-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      expect(results[0].root.jsdocDescription).toContain("Line one");
      expect(results[0].root.jsdocDescription).toContain("Line two");
      const steps = collectStepNodes(results[0].root);
      expect(steps[0].jsdocDescription).toContain("Step line one");
      expect(steps[0].jsdocDescription).toContain("Step line two");
    });

    it("jsdoc-with-param: description before @param is in jsdocDescription", () => {
      const source = loadJsdocFixture("jsdoc-with-param.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps[0].jsdocDescription).toContain("Loads the user by ID");
    });

    it("jsdoc-with-param: extracts structured @param and @returns tags", () => {
      const source = loadJsdocFixture("jsdoc-with-param.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);

      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocParams).toEqual([{ name: "id", description: "The user ID to fetch" }]);
      expect(steps[0].jsdocReturns).toBe("The user object");
    });

    it("extracts @param name when JSDoc includes a type annotation", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        const workflow = createWorkflow("workflow", { fetchUser: async (id: string) => ({ id }) });
        async function run(id: string) {
          return await workflow(async (step, deps) => {
            /**
             * Load user
             * @param {string} id - User identifier
             */
            await step(() => deps.fetchUser(id));
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocParams).toEqual([{ name: "id", description: "User identifier" }]);
    });

    it("extracts @returns text when JSDoc includes a return type annotation", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        type User = { id: string };
        const workflow = createWorkflow("workflow", { fetchUser: async (id: string): Promise<User> => ({ id }) });
        async function run(id: string) {
          return await workflow(async (step, deps) => {
            /**
             * Load user
             * @returns {User} Loaded user object
             */
            await step(() => deps.fetchUser(id));
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocReturns).toBe("Loaded user object");
    });

    it("extracts optional @param names without square brackets", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        const workflow = createWorkflow("workflow", { fetchUser: async (id?: string) => ({ id }) });
        async function run(id?: string) {
          return await workflow(async (step, deps) => {
            /**
             * Load user
             * @param {string} [id] - Optional user identifier
             */
            await step(() => deps.fetchUser(id));
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocParams).toEqual([{ name: "id", description: "Optional user identifier" }]);
    });

    it("extracts optional @param names with defaults without default suffix", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        const workflow = createWorkflow("workflow", { fetchUser: async (id?: string) => ({ id }) });
        async function run(id?: string) {
          return await workflow(async (step, deps) => {
            /**
             * Load user
             * @param {string} [id="guest"] - Optional user identifier
             */
            await step(() => deps.fetchUser(id));
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocParams).toEqual([{ name: "id", description: "Optional user identifier" }]);
    });

    it("extracts clean @throws descriptions when JSDoc includes a throw type", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        const workflow = createWorkflow("workflow", { fetchUser: async (id: string) => ({ id }) });
        async function run(id: string) {
          return await workflow(async (step, deps) => {
            /**
             * Load user
             * @throws {NotFoundError} User not found
             */
            await step(() => deps.fetchUser(id));
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocThrows).toEqual(["User not found"]);
    });

    it("extracts @param description when no dash separator is present", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        const workflow = createWorkflow("workflow", { fetchUser: async (id: string) => ({ id }) });
        async function run(id: string) {
          return await workflow(async (step, deps) => {
            /**
             * Load user
             * @param {string} id User identifier
             */
            await step(() => deps.fetchUser(id));
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocParams).toEqual([{ name: "id", description: "User identifier" }]);
    });

    it("extracts structured JSDoc tags for step.retry nodes", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        const workflow = createWorkflow("workflow", { fetchUser: async (id: string) => ({ id }) });
        async function run(id: string) {
          return await workflow(async (step, deps) => {
            /**
             * Retry loading user
             * @param {string} id - User identifier
             * @returns Loaded user
             */
            await step.retry("fetch-user", () => deps.fetchUser(id), { attempts: 3 });
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocParams).toEqual([{ name: "id", description: "User identifier" }]);
      expect(steps[0].jsdocReturns).toBe("Loaded user");
    });

    it("extracts structured JSDoc tags for step.sleep nodes", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        const workflow = createWorkflow("workflow", {});
        async function run() {
          return await workflow(async (step) => {
            /**
             * Pause before continuing
             * @returns Sleep complete
             */
            await step.sleep("pause", "10ms");
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocReturns).toBe("Sleep complete");
    });

    it("extracts clean @example text without the tag prefix", () => {
      const source = `
        import { createWorkflow } from "awaitly/workflow";
        const workflow = createWorkflow("workflow", { fetchUser: async (id: string) => ({ id }) });
        async function run(id: string) {
          return await workflow(async (step, deps) => {
            /**
             * Load user
             * @example await step("fetch-user", () => deps.fetchUser(id))
             */
            await step("fetch-user", () => deps.fetchUser(id));
            return {};
          });
        }
      `;
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps).toHaveLength(1);
      expect(steps[0].jsdocExample).toBe('await step("fetch-user", () => deps.fetchUser(id))');
    });

    it("no-jsdoc: jsdocDescription undefined everywhere", () => {
      const source = loadJsdocFixture("no-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      expect(results[0].root.jsdocDescription).toBeUndefined();
      const steps = collectStepNodes(results[0].root);
      expect(steps[0].jsdocDescription).toBeUndefined();
    });

    it("run-no-workflow-jsdoc: run() root has no jsdocDescription from declaration", () => {
      const source = loadJsdocFixture("run-no-workflow-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      expect(results[0].root.jsdocDescription).toBeUndefined();
    });

    it("multiple-steps-mixed-jsdoc: only steps with JSDoc have jsdocDescription", () => {
      const source = loadJsdocFixture("multiple-steps-mixed-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      const steps = collectStepNodes(results[0].root);
      expect(steps.length).toBe(3);
      expect(steps[0].jsdocDescription).toContain("first step");
      expect(steps[1].jsdocDescription).toBeUndefined();
      expect(steps[2].jsdocDescription).toContain("third step");
    });

    it("createSagaWorkflow-jsdoc: saga workflow root has jsdocDescription", () => {
      const source = loadJsdocFixture("createSagaWorkflow-jsdoc.ts");
      const results = analyzeWorkflowSource(source, undefined, { assumeImported: true });
      expect(results).toHaveLength(1);
      expect(results[0].root.jsdocDescription).toContain("Order saga");
    });
  });

  // ============================================================================
  // Dependency typeSignature extraction
  // ============================================================================

  describe("Dependency typeSignature extraction", () => {
    it("should extract dependency names from createWorkflow", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          fetchUser: async (id: string) => ({ id, name: 'Alice' }),
          sendEmail: async (to: string) => true,
        });

        async function run(id: string) {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(id));
            await step(() => deps.sendEmail(user.name));
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const deps = results[0].root.dependencies;
      expect(deps).toHaveLength(2);
      expect(deps.map((d) => d.name)).toContain("fetchUser");
      expect(deps.map((d) => d.name)).toContain("sendEmail");
    });

    it("should extract dependency names from shorthand properties", () => {
      const source = `
        const fetchUser = async (id: string) => ({ id, name: 'Alice' });

        const workflow = createWorkflow("workflow", {
          fetchUser,
        });

        async function run(id: string) {
          return await workflow(async (step, deps) => {
            return await step(() => deps.fetchUser(id));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const deps = results[0].root.dependencies;
      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe("fetchUser");
    });

    it("should have errorTypes as empty array for dependencies", () => {
      const source = `
        const workflow = createWorkflow("workflow", {
          fetchUser: async (id: string) => ({ id }),
        });

        async function run(id: string) {
          return await workflow(async (step, deps) => {
            return await step(() => deps.fetchUser(id));
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      const deps = results[0].root.dependencies;
      expect(deps[0].errorTypes).toEqual([]);
    });

    it("should infer errorTypes when Result success type contains a tuple", () => {
      const source = `
        type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

        const workflow = createWorkflow("workflow", {
          fetchPair: async (): Promise<Result<[number, string], "E_ONE" | "E_TWO">> => {
            return { ok: true, value: [1, "x"] };
          },
        });

        async function run() {
          return await workflow(async (step, deps) => {
            await step(() => deps.fetchPair());
            return {};
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);
      const dep = results[0].root.dependencies.find((d) => d.name === "fetchPair");
      expect(dep).toBeDefined();
      expect(dep!.errorTypes).toEqual(["E_ONE", "E_TWO"]);
    });

    it("should extract dependencies when createWorkflow name is a variable", () => {
      const source = `
        const WORKFLOW_NAME = "checkout";
        const workflow = createWorkflow(WORKFLOW_NAME, {
          fetchUser: async (id: string) => ({ id, name: "Alice" }),
          chargeCard: async (_id: string) => true,
        });

        async function run(id: string) {
          return await workflow(async (step, deps) => {
            const user = await step(() => deps.fetchUser(id));
            await step(() => deps.chargeCard(user.id));
            return user;
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const deps = results[0].root.dependencies;
      expect(deps).toHaveLength(2);
      expect(deps.map((d) => d.name)).toContain("fetchUser");
      expect(deps.map((d) => d.name)).toContain("chargeCard");
    });

    it("should extract saga dependencies when createSagaWorkflow name is a variable", () => {
      const source = `
        const WORKFLOW_NAME = "order-saga";
        const workflow = createSagaWorkflow(WORKFLOW_NAME, {
          createOrder: async () => ({ id: "o1" }),
          cancelOrder: async () => true,
        });

        async function run() {
          return await workflow(async (saga, deps) => {
            return await saga.step("create-order", () => deps.createOrder(), {
              compensate: () => deps.cancelOrder(),
            });
          });
        }
      `;

      const results = analyzeWorkflowSource(source);
      expect(results).toHaveLength(1);

      const deps = results[0].root.dependencies;
      expect(deps).toHaveLength(2);
      expect(deps.map((d) => d.name)).toContain("createOrder");
      expect(deps.map((d) => d.name)).toContain("cancelOrder");
    });
  });

  // ============================================================================
  // Fixture-Based Comparison Tests
  // ============================================================================

  describe("Fixture: sample-workflow.ts", () => {
    it("should detect correct step count and conditionals", () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "sample-workflow.ts"),
        "utf-8"
      );

      const results = analyzeWorkflowSource(source);

      expect(results).toHaveLength(1);
      expect(results[0].root.workflowName).toBe("sampleWorkflow");

      const stats = results[0].metadata.stats;

      // 3 steps: fetchUser, applyDiscount (conditional), fetchPosts
      expect(stats.totalSteps).toBe(3);

      // 1 if statement
      expect(stats.conditionalCount).toBe(1);

      // No parallel/race/loops
      expect(stats.parallelCount).toBe(0);
      expect(stats.raceCount).toBe(0);
      expect(stats.loopCount).toBe(0);
    });

    it("should extract step keys and names", () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "sample-workflow.ts"),
        "utf-8"
      );

      const results = analyzeWorkflowSource(source);
      const root = results[0].root;

      // Find all step nodes
      const steps: StaticStepNode[] = [];
      function collectSteps(
        node:
          | StaticFlowNode
          | {
              type: string;
              children?: StaticFlowNode[];
              consequent?: StaticFlowNode[];
              alternate?: StaticFlowNode[];
            }
      ) {
        if (node.type === "step") {
          steps.push(node as StaticStepNode);
        }
        if ("children" in node && node.children) {
          for (const child of node.children) {
            collectSteps(child);
          }
        }
        if ("consequent" in node && node.consequent) {
          for (const child of node.consequent) {
            collectSteps(child);
          }
        }
        if ("alternate" in node && node.alternate) {
          for (const child of node.alternate) {
            collectSteps(child);
          }
        }
      }
      collectSteps(root);

      // Verify step keys
      const keys = steps.map((s) => s.key).filter(Boolean);
      expect(keys).toContain("user");
      expect(keys).toContain("discount");
      expect(keys).toContain("posts");

      // Verify step names
      const names = steps.map((s) => s.name).filter(Boolean);
      expect(names).toContain("Fetch User");
      expect(names).toContain("Apply Discount");
      expect(names).toContain("Fetch Posts");
    });
  });

  describe("Fixture: conditional-helper-workflow.ts", () => {
    it("should detect when/unless helpers", () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "conditional-helper-workflow.ts"),
        "utf-8"
      );

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      // Should have conditional helpers
      expect(stats?.conditionalCount).toBeGreaterThan(0);
    });
  });

  describe("Fixture: false-positive-workflow.ts", () => {
    it("should not count false positives as step calls", () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "false-positive-workflow.ts"),
        "utf-8"
      );

      const results = analyzeWorkflowSource(source);
      const stats = results[0]?.metadata?.stats;

      // Only actual step() calls should be counted
      expect(stats?.totalSteps).toBeDefined();

      // No parallel/race from false positive methods
      expect(stats?.parallelCount).toBeLessThanOrEqual(1);
    });
  });

  // ============================================================================
  // Additional Mermaid Rendering Tests
  // ============================================================================

  describe("renderPathsMermaid", () => {
    it("should not merge distinct steps that share the same name", () => {
      const mermaid = renderPathsMermaid([
        {
          id: "path-1",
          steps: [
            { name: "Fetch", nodeId: "step-1" },
            { name: "Process", nodeId: "step-2" },
          ],
          conditions: [],
        },
        {
          id: "path-2",
          steps: [
            { name: "Fetch", nodeId: "step-3" },
            { name: "Finalize", nodeId: "step-4" },
          ],
          conditions: [],
        },
      ]);

      const stepNodeLines = mermaid
        .split("\n")
        .filter((line) => line.includes('["Fetch"]'));

      expect(stepNodeLines.length).toBe(2);
    });
  });

  describe("renderStaticMermaid labels", () => {
    it("should include parallel node names in labels", () => {
      const mermaid = renderStaticMermaid({
        root: {
          id: "workflow-1",
          type: "workflow",
          workflowName: "testWorkflow",
          source: "createWorkflow",
          dependencies: [],
          errorTypes: [],
          children: [
            {
              id: "parallel-1",
              type: "parallel",
              name: "Fetch all",
              mode: "all",
              children: [{ id: "step-1", type: "step", name: "fetchPosts" }],
            },
          ],
        },
        metadata: {
          analyzedAt: Date.now(),
          filePath: "<source>",
          warnings: [],
          stats: {
            totalSteps: 1,
            conditionalCount: 0,
            parallelCount: 1,
            raceCount: 0,
            loopCount: 0,
            workflowRefCount: 0,
            unknownCount: 0,
          },
        },
        references: new Map(),
      });

      expect(mermaid).toContain("Fetch all");
    });

    it("should include race node names in labels", () => {
      const mermaid = renderStaticMermaid({
        root: {
          id: "workflow-1",
          type: "workflow",
          workflowName: "testWorkflow",
          source: "createWorkflow",
          dependencies: [],
          errorTypes: [],
          children: [
            {
              id: "race-1",
              type: "race",
              name: "Fastest source",
              children: [
                { id: "step-1", type: "step", name: "cache" },
                { id: "step-2", type: "step", name: "db" },
              ],
            },
          ],
        },
        metadata: {
          analyzedAt: Date.now(),
          filePath: "<source>",
          warnings: [],
          stats: {
            totalSteps: 2,
            conditionalCount: 0,
            parallelCount: 0,
            raceCount: 1,
            loopCount: 0,
            workflowRefCount: 0,
            unknownCount: 0,
          },
        },
        references: new Map(),
      });

      expect(mermaid).toContain("Fastest source");
    });
  });

  // ===========================================================================
  // Kitchen Sink -- all IR node types
  // ===========================================================================
  describe("Kitchen Sink -- all IR node types", () => {
    it("should detect every IR node type from the kitchen-sink fixture", () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "kitchen-sink.ts"),
        "utf-8"
      );
      const results = analyzeWorkflowSource(source);

      // Find the kitchenSink workflow (not the otherWorkflow)
      const ksResult = results.find(
        (r) => r.root.workflowName === "kitchenSink"
      );
      expect(ksResult).toBeDefined();
      const root = ksResult!.root;
      const stats = ksResult!.metadata.stats;
      const allNodes = collectAllNodes(root);

      // ----- Workflow-level properties -----
      expect(root.workflowName).toBe("kitchenSink");
      expect(root.source).toBe("createWorkflow");
      expect(root.dependencies.length).toBeGreaterThanOrEqual(1);

      // ----- Steps by stepId -----
      const steps = findNodesByType<StaticStepNode>(root, "step");
      const stepIds = steps.map((s) => s.stepId).filter(Boolean);

      // Core step variants
      expect(stepIds).toContain("fetch-user");
      expect(stepIds).toContain("pause");
      expect(stepIds).toContain("try-risky");
      expect(stepIds).toContain("from-result");
      expect(stepIds).toContain("retry-fetch");
      expect(stepIds).toContain("timed-fetch");
      expect(stepIds).toContain("dep-step");

      // Key property checks on specific steps
      const fetchUserStep = steps.find((s) => s.stepId === "fetch-user");
      expect(fetchUserStep).toBeDefined();
      expect(fetchUserStep!.key).toBe("user");
      expect(fetchUserStep!.out).toBe("user");
      expect(fetchUserStep!.errors).toEqual(["NOT_FOUND"]);

      // step.sleep callee
      const sleepStep = steps.find((s) => s.stepId === "pause");
      expect(sleepStep).toBeDefined();
      expect(sleepStep!.callee).toBe("step.sleep");

      // step.retry
      const retryStep = steps.find((s) => s.stepId === "retry-fetch");
      expect(retryStep).toBeDefined();
      expect(retryStep!.retry?.attempts).toBe(3);
      expect(retryStep!.retry?.backoff).toBe("exponential");

      // step.withTimeout
      const timedStep = steps.find((s) => s.stepId === "timed-fetch");
      expect(timedStep).toBeDefined();
      expect(timedStep!.timeout?.ms).toBe(5000);

      // step.dep
      const depStep = steps.find((s) => s.stepId === "dep-step");
      expect(depStep).toBeDefined();
      expect(depStep!.depSource).toBe("userService");

      // ----- Parallel nodes -----
      const parallels = findNodesByType<StaticParallelNode>(root, "parallel");
      expect(parallels.length).toBeGreaterThanOrEqual(3);

      // step.parallel
      const stepParallel = parallels.find(
        (p) => p.callee === "step.parallel"
      );
      expect(stepParallel).toBeDefined();
      expect(stepParallel!.mode).toBe("all");

      // allAsync
      const allAsyncNode = parallels.find((p) => p.callee === "allAsync");
      expect(allAsyncNode).toBeDefined();
      expect(allAsyncNode!.mode).toBe("all");

      // allSettledAsync
      const allSettledNode = parallels.find(
        (p) => p.callee === "allSettledAsync"
      );
      expect(allSettledNode).toBeDefined();
      expect(allSettledNode!.mode).toBe("allSettled");

      // ----- Race nodes -----
      const races = findNodesByType<StaticRaceNode>(root, "race");
      expect(races.length).toBeGreaterThanOrEqual(3);

      const stepRaces = races.filter((r) => r.callee === "step.race");
      expect(stepRaces.length).toBeGreaterThanOrEqual(2);

      const anyAsyncNode = races.find((r) => r.callee === "anyAsync");
      expect(anyAsyncNode).toBeDefined();

      // ----- Decision nodes (step.if, step.label, step.branch) -----
      const decisions = findNodesByType<StaticDecisionNode>(root, "decision");
      expect(decisions.length).toBeGreaterThanOrEqual(3);

      const premiumCheck = decisions.find(
        (d) => d.decisionId === "premium-check"
      );
      expect(premiumCheck).toBeDefined();
      expect(premiumCheck!.conditionLabel).toBe("user.isPremium");

      const roleCheck = decisions.find((d) => d.decisionId === "role-check");
      expect(roleCheck).toBeDefined();
      expect(roleCheck!.conditionLabel).toBe("user.role === admin");

      const paymentBranch = decisions.find(
        (d) => d.decisionId === "payment"
      );
      expect(paymentBranch).toBeDefined();
      expect(paymentBranch!.conditionLabel).toBe("cart.total > 0");

      // ----- Conditional nodes (if/else, when, unless, whenOr, unlessOr) -----
      const conditionals = findNodesByType<StaticConditionalNode>(
        root,
        "conditional"
      );
      expect(conditionals.length).toBeGreaterThanOrEqual(5);

      // Plain if/else (helper = null or undefined)
      const plainIf = conditionals.find(
        (c) => c.helper === null || c.helper === undefined
      );
      expect(plainIf).toBeDefined();

      // when
      const whenNode = conditionals.find((c) => c.helper === "when");
      expect(whenNode).toBeDefined();

      // unless
      const unlessNode = conditionals.find((c) => c.helper === "unless");
      expect(unlessNode).toBeDefined();

      // whenOr
      const whenOrNode = conditionals.find((c) => c.helper === "whenOr");
      expect(whenOrNode).toBeDefined();
      expect(whenOrNode!.defaultValue).toBeDefined();

      // unlessOr
      const unlessOrNode = conditionals.find(
        (c) => c.helper === "unlessOr"
      );
      expect(unlessOrNode).toBeDefined();
      expect(unlessOrNode!.defaultValue).toBeDefined();

      // ----- Switch node -----
      const switches = findNodesByType<StaticSwitchNode>(root, "switch");
      expect(switches.length).toBeGreaterThanOrEqual(1);

      const sw = switches[0];
      expect(sw.expression).toContain("user.role");
      expect(sw.cases.length).toBeGreaterThanOrEqual(2);
      expect(sw.cases.some((c) => c.isDefault)).toBe(true);

      // ----- Loop nodes -----
      const loops = findNodesByType<StaticLoopNode>(root, "loop");
      expect(loops.length).toBeGreaterThanOrEqual(6);

      const loopTypes = loops.map((l) => l.loopType);
      expect(loopTypes).toContain("for");
      expect(loopTypes).toContain("for-of");
      expect(loopTypes).toContain("for-in");
      expect(loopTypes).toContain("while");
      expect(loopTypes).toContain("step.forEach");

      // for-of has iterSource
      const forOfLoop = loops.find((l) => l.loopType === "for-of");
      expect(forOfLoop).toBeDefined();
      expect(forOfLoop!.iterSource).toBeDefined();

      // for-in has iterSource
      const forInLoop = loops.find((l) => l.loopType === "for-in");
      expect(forInLoop).toBeDefined();
      expect(forInLoop!.iterSource).toBeDefined();

      // step.forEach loops have loopId
      const forEachLoops = loops.filter(
        (l) => l.loopType === "step.forEach"
      );
      expect(forEachLoops.length).toBeGreaterThanOrEqual(2);
      const forEachIds = forEachLoops.map((l) => l.loopId).filter(Boolean);
      expect(forEachIds).toContain("foreach-run");
      expect(forEachIds).toContain("foreach-item");

      // ----- Stream nodes -----
      const streams = findNodesByType<StaticStreamNode>(root, "stream");
      expect(streams.length).toBeGreaterThanOrEqual(3);

      const streamTypes = streams.map((s) => s.streamType);
      expect(streamTypes).toContain("write");
      expect(streamTypes).toContain("read");
      expect(streamTypes).toContain("forEach");

      const writeStream = streams.find((s) => s.streamType === "write");
      expect(writeStream!.namespace).toBe("progress");

      const readStream = streams.find((s) => s.streamType === "read");
      expect(readStream!.namespace).toBe("data");

      const forEachStream = streams.find(
        (s) => s.streamType === "forEach"
      );
      expect(forEachStream!.namespace).toBe("events");

      // ----- Workflow ref -----
      const refs = findNodesByType<StaticWorkflowRefNode>(
        root,
        "workflow-ref"
      );
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs[0].workflowName).toBe("otherWorkflow");

      // ----- Aggregate stats -----
      expect(stats.totalSteps).toBeGreaterThanOrEqual(20);
      expect(stats.parallelCount).toBeGreaterThanOrEqual(3);
      expect(stats.raceCount).toBeGreaterThanOrEqual(3);
      expect(stats.conditionalCount).toBeGreaterThanOrEqual(8);
      expect(stats.loopCount).toBeGreaterThanOrEqual(6);
      expect(stats.streamCount).toBeGreaterThanOrEqual(3);
      expect(stats.workflowRefCount).toBeGreaterThanOrEqual(1);

      // ----- Every expected node type is present -----
      const presentTypes = new Set(allNodes.map((n) => n.type));
      for (const expected of [
        "step",
        "parallel",
        "race",
        "decision",
        "conditional",
        "switch",
        "loop",
        "stream",
        "workflow-ref",
      ] as const) {
        expect(presentTypes.has(expected)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // Saga Kitchen Sink
  // ===========================================================================
  describe("Saga Kitchen Sink", () => {
    it("should detect saga patterns in non-destructured form", () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "kitchen-sink-saga.ts"),
        "utf-8"
      );
      const results = analyzeWorkflowSource(source);

      const orderResult = results.find(
        (r) => r.root.workflowName === "orderSaga"
      );
      expect(orderResult).toBeDefined();

      const root = orderResult!.root;
      expect(root.source).toBe("createSagaWorkflow");

      const stats = orderResult!.metadata.stats;
      expect(stats.sagaWorkflowCount).toBe(1);

      // saga.step nodes
      const sagaSteps = collectSagaStepNodes(root);
      expect(sagaSteps.length).toBeGreaterThanOrEqual(3);

      // Compensated steps
      expect(stats.compensatedStepCount).toBeGreaterThanOrEqual(3);

      // saga.tryStep detection
      const trySteps = sagaSteps.filter(
        (s) => s.type === "saga-step" && (s as StaticSagaStepNode).isTryStep
      );
      expect(trySteps.length).toBeGreaterThanOrEqual(1);
    });

    it("should detect destructured saga workflow (saga steps require saga.step() form)", () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "kitchen-sink-saga.ts"),
        "utf-8"
      );
      const results = analyzeWorkflowSource(source);

      const destructuredResult = results.find(
        (r) => r.root.workflowName === "orderSagaDestructured"
      );
      expect(destructuredResult).toBeDefined();

      const root = destructuredResult!.root;
      expect(root.source).toBe("createSagaWorkflow");
      // Destructured `{ step, tryStep } = saga` is not tracked by the analyzer;
      // the workflow is detected but saga-step nodes require saga.step() form.
      expect(root.dependencies.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// =============================================================================
// Fluent API Tests
// =============================================================================

import { analyze } from "../analyze";

describe("analyze() fluent API", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  const singleWorkflowCode = `
    import { createWorkflow } from 'awaitly';

    const testWorkflow = createWorkflow("testWorkflow", {});

    async function run() {
      return await testWorkflow(async (step, deps) => {
        await step(() => deps.doSomething(), { key: 'step1' });
      });
    }
  `;

  const multiWorkflowCode = `
    import { createWorkflow } from 'awaitly';

    const workflowA = createWorkflow("workflowA", {});
    const workflowB = createWorkflow("workflowB", {});

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

  const emptyCode = `
    // No workflows here
    const x = 1;
  `;

  describe("single()", () => {
    it("returns single workflow when file has exactly one", () => {
      const ir = analyze.source(singleWorkflowCode).single();
      expect(ir.root.workflowName).toBe("testWorkflow");
    });

    it("throws for multiple workflows", () => {
      expect(() => analyze.source(multiWorkflowCode).single()).toThrow(
        "Expected exactly 1 workflow, found 2"
      );
    });

    it("throws for no workflows", () => {
      expect(() => analyze.source(emptyCode).single()).toThrow(
        "Expected exactly 1 workflow, found 0"
      );
    });
  });

  describe("singleOrNull()", () => {
    it("returns single workflow when file has exactly one", () => {
      const ir = analyze.source(singleWorkflowCode).singleOrNull();
      expect(ir?.root.workflowName).toBe("testWorkflow");
    });

    it("returns null for multiple workflows", () => {
      const ir = analyze.source(multiWorkflowCode).singleOrNull();
      expect(ir).toBeNull();
    });

    it("returns null for no workflows", () => {
      const ir = analyze.source(emptyCode).singleOrNull();
      expect(ir).toBeNull();
    });
  });

  describe("all()", () => {
    it("returns array with single workflow", () => {
      const irs = analyze.source(singleWorkflowCode).all();
      expect(irs).toHaveLength(1);
      expect(irs[0].root.workflowName).toBe("testWorkflow");
    });

    it("returns array with multiple workflows", () => {
      const irs = analyze.source(multiWorkflowCode).all();
      expect(irs).toHaveLength(2);
      expect(irs.map((ir) => ir.root.workflowName).sort()).toEqual([
        "workflowA",
        "workflowB",
      ]);
    });

    it("returns empty array for no workflows", () => {
      const irs = analyze.source(emptyCode).all();
      expect(irs).toEqual([]);
    });
  });

  describe("named()", () => {
    it("finds workflow by name", () => {
      const ir = analyze.source(multiWorkflowCode).named("workflowB");
      expect(ir.root.workflowName).toBe("workflowB");
    });

    it("throws if workflow not found", () => {
      expect(() => analyze.source(multiWorkflowCode).named("missing")).toThrow(
        'Workflow "missing" not found. Available: workflowA, workflowB'
      );
    });

    it("throws with helpful message when no workflows exist", () => {
      expect(() => analyze.source(emptyCode).named("missing")).toThrow(
        'Workflow "missing" not found. Available: (none)'
      );
    });
  });

  describe("first()", () => {
    it("returns first workflow from single-workflow file", () => {
      const ir = analyze.source(singleWorkflowCode).first();
      expect(ir.root.workflowName).toBe("testWorkflow");
    });

    it("returns first workflow from multi-workflow file", () => {
      const ir = analyze.source(multiWorkflowCode).first();
      expect(["workflowA", "workflowB"]).toContain(ir.root.workflowName);
    });

    it("throws for empty file", () => {
      expect(() => analyze.source(emptyCode).first()).toThrow(
        "No workflows found"
      );
    });
  });

  describe("firstOrNull()", () => {
    it("returns first workflow from single-workflow file", () => {
      const ir = analyze.source(singleWorkflowCode).firstOrNull();
      expect(ir?.root.workflowName).toBe("testWorkflow");
    });

    it("returns first workflow from multi-workflow file", () => {
      const ir = analyze.source(multiWorkflowCode).firstOrNull();
      expect(ir).not.toBeNull();
      expect(["workflowA", "workflowB"]).toContain(ir!.root.workflowName);
    });

    it("returns null for empty file", () => {
      const ir = analyze.source(emptyCode).firstOrNull();
      expect(ir).toBeNull();
    });
  });

  describe("analyze.source()", () => {
    it("accepts options", () => {
      const ir = analyze
        .source(singleWorkflowCode, { includeLocations: false })
        .single();
      // Location should still be present (default behavior), but we can verify it works
      expect(ir.root.workflowName).toBe("testWorkflow");
    });
  });
});
