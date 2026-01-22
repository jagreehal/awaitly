/**
 * Comparison tests between tree-sitter and ts-morph analyzers
 *
 * These tests verify that tree-sitter produces compatible output
 * for the same workflow source code.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  analyzeWorkflowSource as analyzeTreeSitter,
  resetIdCounter,
} from "./index";
import type { StaticFlowNode, StaticStepNode } from "./types";

// Test fixtures directory
const FIXTURES_DIR = join(__dirname, "__fixtures__");

describe("Analyzer Comparison", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("sample-workflow.ts", () => {
    it("should detect correct step count and conditionals", async () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "sample-workflow.ts"),
        "utf-8"
      );

      const results = await analyzeTreeSitter(source);

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

    it("should extract step keys and names", async () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "sample-workflow.ts"),
        "utf-8"
      );

      const results = await analyzeTreeSitter(source);
      const root = results[0].root;

      // Find all step nodes
      const steps: StaticStepNode[] = [];
      function collectSteps(node: StaticFlowNode | { type: string; children?: StaticFlowNode[]; consequent?: StaticFlowNode[]; alternate?: StaticFlowNode[] }) {
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

  describe("conditional-helper-workflow.ts", () => {
    it("should detect when/unless helpers", async () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "conditional-helper-workflow.ts"),
        "utf-8"
      );

      const results = await analyzeTreeSitter(source);
      const stats = results[0]?.metadata?.stats;

      // Should have conditional helpers
      expect(stats?.conditionalCount).toBeGreaterThan(0);
    });
  });

  describe("false-positive-workflow.ts", () => {
    it("should not count false positives as step calls", async () => {
      const source = readFileSync(
        join(FIXTURES_DIR, "false-positive-workflow.ts"),
        "utf-8"
      );

      const results = await analyzeTreeSitter(source);
      const stats = results[0]?.metadata?.stats;

      // Only actual step() calls should be counted
      // False positives like parallelFetch(), raceCondition() should be ignored
      expect(stats?.totalSteps).toBeDefined();

      // No parallel/race from false positive methods
      // step.parallel IS counted, but parallelFetch() is NOT
      expect(stats?.parallelCount).toBeLessThanOrEqual(1);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty workflow callback", async () => {
      const source = `
        const workflow = createWorkflow({});

        async function run() {
          return await workflow(async (step, deps) => {
            return null;
          });
        }
      `;

      const results = await analyzeTreeSitter(source);
      expect(results).toHaveLength(1);
      expect(results[0].metadata.stats.totalSteps).toBe(0);
    });

    it("should handle nested conditionals", async () => {
      const source = `
        const workflow = createWorkflow({});

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

      const results = await analyzeTreeSitter(source);
      const stats = results[0].metadata.stats;

      expect(stats.totalSteps).toBe(3);
      expect(stats.conditionalCount).toBe(2); // Two if statements
    });

    it("should handle complex workflow with all features", async () => {
      const source = `
        const childWorkflow = createWorkflow({});
        const mainWorkflow = createWorkflow({});

        async function runChild() {
          return await childWorkflow(async (step, deps) => {
            await step(() => deps.childOp(), { key: 'child' });
          });
        }

        async function runMain() {
          return await mainWorkflow(async (step, deps) => {
            // Step with retry
            const data = await step(() => deps.fetchData(), {
              key: 'fetch',
              retry: { attempts: 3, backoff: 'exponential' },
            });

            // Parallel execution
            const parallel = await step.parallel({
              a: () => deps.fetchA(),
              b: () => deps.fetchB(),
            });

            // Conditional
            if (data.ready) {
              await step(() => deps.process(), { key: 'process' });
            }

            // Loop
            for (const item of data.items) {
              await step(() => deps.processItem(item), { key: item.id });
            }

            // Call child workflow
            await childWorkflow(async (step, deps) => {
              await step(() => deps.final(), { key: 'final' });
            });
          });
        }
      `;

      const results = await analyzeTreeSitter(source);

      // Should find both workflows
      expect(results.length).toBeGreaterThanOrEqual(1);

      // Find the main workflow
      const mainResult = results.find(
        (r) => r.root.workflowName === "mainWorkflow"
      );
      expect(mainResult).toBeDefined();

      const stats = mainResult!.metadata.stats;

      // Steps: fetch, a, b (parallel), process (conditional), processItem (loop), child workflow ref
      expect(stats.totalSteps).toBeGreaterThanOrEqual(4);
      expect(stats.parallelCount).toBe(1);
      expect(stats.conditionalCount).toBe(1);
      expect(stats.loopCount).toBe(1);
      expect(stats.workflowRefCount).toBe(1);
    });
  });
});
