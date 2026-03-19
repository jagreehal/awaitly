import { describe, it, expect, beforeEach } from "vitest";
import { analyzeWorkflowSource, resetIdCounter } from "../../static-analyzer";
import { diffWorkflows } from "../diff-engine";
import { renderDiffMarkdown } from "../render-markdown";
import { renderDiffJSON } from "../render-json";
import { renderDiffMermaid } from "../render-mermaid";

function makeWorkflowSource(
  name: string,
  deps: Record<string, true>,
  bodyLines: string[]
): string {
  const depEntries = Object.keys(deps)
    .map((d) => `${d}: async () => ok({})`)
    .join(",\n    ");

  return `
    import { createWorkflow, ok } from "awaitly";
    const workflow = createWorkflow("${name}", {
      ${depEntries},
    });
    export async function run() {
      return await workflow.run(async ({ step, deps }) => {
        ${bodyLines.join("\n        ")}
      });
    }
  `;
}

describe("Workflow Diff", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("diffWorkflows engine", () => {
    it("identical workflows produce all unchanged entries", () => {
      const source = makeWorkflowSource(
        "flow",
        { getUser: true, validateCart: true },
        [
          "await step('get-user', () => deps.getUser());",
          "await step('validate-cart', () => deps.validateCart());",
        ]
      );

      const before = analyzeWorkflowSource(source)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(source)[0];

      const diff = diffWorkflows(before, after);

      expect(diff.summary.stepsUnchanged).toBe(2);
      expect(diff.summary.stepsAdded).toBe(0);
      expect(diff.summary.stepsRemoved).toBe(0);
      expect(diff.summary.stepsRenamed).toBe(0);
      expect(diff.summary.stepsMoved).toBe(0);
      expect(diff.summary.hasRegressions).toBe(false);

      for (const entry of diff.steps) {
        expect(entry.kind).toBe("unchanged");
      }
    });

    it("detects an added step", () => {
      const sourceV1 = makeWorkflowSource(
        "flow",
        { a: true, b: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-b', () => deps.b());",
        ]
      );

      const sourceV2 = makeWorkflowSource(
        "flow",
        { a: true, b: true, c: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-b', () => deps.b());",
          "await step('step-c', () => deps.c());",
        ]
      );

      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];

      const diff = diffWorkflows(before, after);

      expect(diff.summary.stepsAdded).toBe(1);
      const added = diff.steps.filter((s) => s.kind === "added");
      expect(added).toHaveLength(1);
      expect(added[0].stepId).toBe("step-c");
    });

    it("detects a removed step", () => {
      const sourceV1 = makeWorkflowSource(
        "flow",
        { a: true, b: true, c: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-b', () => deps.b());",
          "await step('step-c', () => deps.c());",
        ]
      );

      const sourceV2 = makeWorkflowSource(
        "flow",
        { a: true, b: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-b', () => deps.b());",
        ]
      );

      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];

      const diff = diffWorkflows(before, after);

      expect(diff.summary.stepsRemoved).toBe(1);
      expect(diff.summary.hasRegressions).toBe(false);

      const removed = diff.steps.filter((s) => s.kind === "removed");
      expect(removed).toHaveLength(1);
      expect(removed[0].stepId).toBe("step-c");

      resetIdCounter();
      const before2 = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after2 = analyzeWorkflowSource(sourceV2)[0];
      const diffRegression = diffWorkflows(before2, after2, { regressionMode: true });
      expect(diffRegression.summary.hasRegressions).toBe(true);
    });

    it("detects a renamed step", () => {
      const sourceV1 = makeWorkflowSource(
        "flow",
        { getUser: true },
        ["await step('old-name', () => deps.getUser());"]
      );

      const sourceV2 = makeWorkflowSource(
        "flow",
        { getUser: true },
        ["await step('new-name', () => deps.getUser());"]
      );

      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];

      const diff = diffWorkflows(before, after);

      expect(diff.summary.stepsRenamed).toBe(1);
      const renamed = diff.steps.filter((s) => s.kind === "renamed");
      expect(renamed).toHaveLength(1);
      expect(renamed[0].previousStepId).toBe("old-name");
      expect(renamed[0].stepId).toBe("new-name");
    });

    it("reports removed + added when rename detection is disabled", () => {
      const sourceV1 = makeWorkflowSource(
        "flow",
        { getUser: true },
        ["await step('old-name', () => deps.getUser());"]
      );

      const sourceV2 = makeWorkflowSource(
        "flow",
        { getUser: true },
        ["await step('new-name', () => deps.getUser());"]
      );

      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];

      const diff = diffWorkflows(before, after, { detectRenames: false });

      expect(diff.summary.stepsRenamed).toBe(0);
      expect(diff.summary.stepsRemoved).toBe(1);
      expect(diff.summary.stepsAdded).toBe(1);
    });

    it("detects a moved step (sequence to parallel)", () => {
      const beforeSource = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("flow", {
          a: async () => ok({}),
          b: async () => ok({}),
        });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step-a', () => deps.a());
            await step('step-b', () => deps.b());
          });
        }
      `;

      const afterSource = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("flow", {
          a: async () => ok({}),
          b: async () => ok({}),
        });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step-a', () => deps.a());
            await step.parallel("parallel-group", () => {
              step('step-b', () => deps.b());
            });
          });
        }
      `;

      const before = analyzeWorkflowSource(beforeSource)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(afterSource)[0];

      const diff = diffWorkflows(before, after);

      const moved = diff.steps.filter((s) => s.kind === "moved");
      expect(moved.length).toBeGreaterThanOrEqual(1);

      const movedToParallel = moved.filter(
        (s) => s.containerAfter === "parallel"
      );
      expect(movedToParallel.length).toBeGreaterThanOrEqual(1);
      expect(movedToParallel[0].stepId).toBe("step-b");
    });

    it("detects structural change when parallel block is added", () => {
      const beforeSource = makeWorkflowSource(
        "flow",
        { a: true, b: true, c: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-b', () => deps.b());",
          "await step('step-c', () => deps.c());",
        ]
      );

      const afterSource = `
        import { createWorkflow, ok } from "awaitly";
        const workflow = createWorkflow("flow", {
          a: async () => ok({}),
          b: async () => ok({}),
          c: async () => ok({}),
        });
        export async function run() {
          return await workflow.run(async ({ step, deps }) => {
            await step('step-a', () => deps.a());
            await step.parallel("parallel-group", {
              "step-b": () => deps.b(),
              "step-c": () => deps.c(),
            });
          });
        }
      `;

      const before = analyzeWorkflowSource(beforeSource)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(afterSource)[0];

      const diff = diffWorkflows(before, after);

      const addedParallel = diff.structuralChanges.filter(
        (sc) => sc.kind === "added" && sc.nodeType === "parallel"
      );
      expect(addedParallel).toHaveLength(1);
    });
  });

  describe("renderDiffMarkdown", () => {
    function makeDiffSources() {
      const sourceV1 = makeWorkflowSource(
        "flow",
        { a: true, b: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-b', () => deps.b());",
        ]
      );

      const sourceV2 = makeWorkflowSource(
        "flow",
        { a: true, c: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-c', () => deps.c());",
        ]
      );

      return { sourceV1, sourceV2 };
    }

    it("contains expected sections for added and removed steps", () => {
      const { sourceV1, sourceV2 } = makeDiffSources();
      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];
      const diff = diffWorkflows(before, after);
      const md = renderDiffMarkdown(diff);

      expect(md).toContain("# Workflow Diff:");
      expect(md).toContain("## Summary");
      expect(md).toContain("## Added Steps");
      expect(md).toContain("Removed Steps");
      expect(md).toContain("`step-c`");
      expect(md).toContain("`step-b`");
    });

    it("shows regression warning for removed steps when regressionMode is on", () => {
      const { sourceV1, sourceV2 } = makeDiffSources();
      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];
      const diff = diffWorkflows(before, after, { regressionMode: true });
      const md = renderDiffMarkdown(diff);

      expect(md).toContain("\u26a0\ufe0f Removed Steps");
    });

    it("does not show regression warning when regressionMode is off", () => {
      const { sourceV1, sourceV2 } = makeDiffSources();
      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];
      const diff = diffWorkflows(before, after);
      const md = renderDiffMarkdown(diff);

      expect(md).not.toContain("\u26a0\ufe0f");
      expect(md).toContain("## Removed Steps");
    });

    it("hides unchanged steps when showUnchanged is false", () => {
      const source = makeWorkflowSource(
        "flow",
        { a: true },
        ["await step('step-a', () => deps.a());"]
      );

      const before = analyzeWorkflowSource(source)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(source)[0];
      const diff = diffWorkflows(before, after);

      const md = renderDiffMarkdown(diff, { showUnchanged: false });
      expect(md).not.toContain("## Unchanged Steps");
    });
  });

  describe("renderDiffJSON", () => {
    it("produces valid JSON with expected top-level keys", () => {
      const source = makeWorkflowSource(
        "flow",
        { a: true, b: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-b', () => deps.b());",
        ]
      );

      const before = analyzeWorkflowSource(source)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(source)[0];

      const diff = diffWorkflows(before, after);
      const json = renderDiffJSON(diff);

      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty("beforeName");
      expect(parsed).toHaveProperty("afterName");
      expect(parsed).toHaveProperty("steps");
      expect(parsed).toHaveProperty("summary");
    });
  });

  describe("renderDiffMermaid", () => {
    it("contains diff style classes for added steps", () => {
      const sourceV1 = makeWorkflowSource(
        "flow",
        { a: true },
        ["await step('step-a', () => deps.a());"]
      );

      const sourceV2 = makeWorkflowSource(
        "flow",
        { a: true, b: true },
        [
          "await step('step-a', () => deps.a());",
          "await step('step-b', () => deps.b());",
        ]
      );

      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];

      const diff = diffWorkflows(before, after);
      const mermaid = renderDiffMermaid(after, diff);

      expect(mermaid).toContain("classDef diffAddedStyle");
      expect(mermaid).toContain("class step_");
    });

    it("styles added saga steps using saga_step node ids", () => {
      const sourceV1 = `
        import { createSagaWorkflow, ok } from "awaitly/saga";

        const workflow = createSagaWorkflow("saga", {
          reserve: async () => ok({}),
        });

        export async function run() {
          return await workflow(async ({ saga, deps }) => {
            await saga.step("reserve", () => deps.reserve());
            return {};
          });
        }
      `;

      const sourceV2 = `
        import { createSagaWorkflow, ok } from "awaitly/saga";

        const workflow = createSagaWorkflow("saga", {
          reserve: async () => ok({}),
          charge: async () => ok({}),
        });

        export async function run() {
          return await workflow(async ({ saga, deps }) => {
            await saga.step("reserve", () => deps.reserve());
            await saga.step("charge", () => deps.charge());
            return {};
          });
        }
      `;

      const before = analyzeWorkflowSource(sourceV1)[0];
      resetIdCounter();
      const after = analyzeWorkflowSource(sourceV2)[0];

      const diff = diffWorkflows(before, after);
      const mermaid = renderDiffMermaid(after, diff);

      expect(mermaid).toContain("classDef diffAddedStyle");
      expect(mermaid).toMatch(/class saga_step_\d+ diffAddedStyle/);
    });
  });
});
