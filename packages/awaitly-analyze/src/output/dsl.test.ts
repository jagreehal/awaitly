/**
 * Tests for Workflow Diagram DSL renderer.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter, renderWorkflowDSL } from "../index";

const FIXTURES_DIR = join(__dirname, "..", "__fixtures__");

/** Workflow fixture files to run through analyzer and snapshot DSL output */
const WORKFLOW_FIXTURES = [
  "sample-workflow.ts",
  "auth-workflow.ts",
  "main-workflow.ts",
  "parallel-workflow.ts",
  "conditional-helper-workflow.ts",
  "false-positive-workflow.ts",
  "parallel-callback-workflow.ts",
  "unused-helper-workflow.ts",
] as const;

describe("renderWorkflowDSL", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("produces DSL with start and end states", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { fetch: async () => ok({}) });
      export async function run() {
        return await w(async ({ step }) => {
          await step('a', () => fetch());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    expect(results).toHaveLength(1);
    const dsl = renderWorkflowDSL(results[0]!);
    expect(dsl.workflowName).toBe("w");
    expect(dsl.initialStateId).toBe("start");
    expect(dsl.terminalStateIds).toEqual(["end"]);
    expect(dsl.states.some((s) => s.id === "start" && s.type === "initial")).toBe(true);
    expect(dsl.states.some((s) => s.id === "end" && s.type === "terminal")).toBe(true);
  });

  it("uses step key as step state id when present (snapshot alignment)", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { fetch: async () => ok({}) });
      export async function run() {
        return await w(async ({ step }) => {
          await step('getBatch', () => fetch(), { key: "getBatch", name: "Get batch" });
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const dsl = renderWorkflowDSL(results[0]!);
    const stepState = dsl.states.find((s) => s.type === "step");
    expect(stepState).toBeDefined();
    // State id must be step key for snapshot.currentStepId alignment
    expect(stepState!.id).toBe("getBatch");
    expect(stepState!.label.length).toBeGreaterThan(0);
  });

  it("produces transitions with event labels", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { a: async () => ok(1), b: async () => ok(2) });
      export async function run() {
        return await w(async ({ step }) => {
          await step('x', () => a());
          await step('y', () => b());
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const dsl = renderWorkflowDSL(results[0]!);
    expect(dsl.transitions.some((t) => t.fromStateId === "start" && t.event === "start")).toBe(true);
    expect(dsl.transitions.some((t) => t.event === "done")).toBe(true);
    const stepIds = dsl.states.filter((s) => s.type === "step").map((s) => s.id);
    expect(stepIds).toContain("x");
    expect(stepIds).toContain("y");
  });

  it("handles conditional with true/false transitions", () => {
    // Plain if/else produces a conditional node; we render it as a decision state
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { fetch: async () => ok({}) });
      export async function run() {
        return await w(async ({ step }) => {
          if (true) {
            await step('thenStep', () => fetch());
          } else {
            await step('elseStep', () => fetch());
          }
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const dsl = renderWorkflowDSL(results[0]!);
    const decisionState = dsl.states.find((s) => s.type === "decision");
    expect(decisionState).toBeDefined();
    const outTransitions = dsl.transitions.filter((t) => t.fromStateId === decisionState!.id);
    const events = outTransitions.map((t) => t.event);
    expect(events).toEqual(expect.arrayContaining(["true", "false"]));
  });

  it("handles loop with next and done", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const w = createWorkflow("w", { pay: async () => ok({}) });
      export async function run() {
        return await w(async ({ step }) => {
          const items = [1];
          for (const _ of items) {
            await step('pay', () => pay());
          }
          return {};
        });
      }
    `;
    const results = analyzeWorkflowSource(source);
    const dsl = renderWorkflowDSL(results[0]!);
    const loopEntry = dsl.states.find((s) => s.id.startsWith("loop_entry_"));
    expect(loopEntry).toBeDefined();
    expect(dsl.transitions.some((t) => t.event === "next")).toBe(true);
    expect(dsl.transitions.some((t) => t.event === "done")).toBe(true);
  });

  describe("Fixture-based DSL output", () => {
    beforeEach(() => {
      resetIdCounter();
    });

    it.each(WORKFLOW_FIXTURES)(
      "produces expected DSL for %s",
      (fixtureName) => {
        const filePath = join(FIXTURES_DIR, fixtureName);
        const source = readFileSync(filePath, "utf-8");
        const results = analyzeWorkflowSource(source, undefined, {
          assumeImported: true,
        });
        expect(results.length).toBeGreaterThan(0);
        const dsls = results.map((ir) => renderWorkflowDSL(ir));
        expect(dsls).toMatchSnapshot();
      }
    );
  });
});
