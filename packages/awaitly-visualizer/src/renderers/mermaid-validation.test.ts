/**
 * Test Mermaid validation - ensure all generated Mermaid code is valid
 *
 * This test generates Mermaid diagrams with various edge cases and validates
 * they render correctly without parse errors.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ok, err, type AsyncResult } from "awaitly/core";
import { createWorkflow } from "awaitly/workflow";
import { createEventCollector, createVisualizer, type MermaidRenderOptions, defaultColorScheme } from "../index";
import { mermaidRenderer } from "./mermaid";
import mermaid from "mermaid";

// Initialize mermaid for parsing (no DOM needed for parse-only)
beforeAll(() => {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
  });
});

/**
 * Validate that a Mermaid diagram string is syntactically valid.
 * Throws if the diagram cannot be parsed.
 */
async function validateMermaid(diagram: string): Promise<void> {
  const result = await mermaid.parse(diagram);
  if (!result) {
    throw new Error("Mermaid parse returned false");
  }
}

// Test functions with special characters in names/keys
const fetchUserWithSpecialChars = async (
  id: string
): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
  return ok({ id, name: `User (${id})` });
};

const processDataWithBrackets = async (
  data: { value: string }
): AsyncResult<string, "ERROR"> => {
  return ok(`Processed: [${data.value}]`);
};

describe("Mermaid Validation - Special Characters", () => {
  it("should handle step names with parentheses", async () => {
    const collector = createEventCollector({ workflowName: "test-workflow" });

    const workflow = createWorkflow("workflow", { fetchUserWithSpecialChars }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(
        "Fetch User (with parens)",
        () => deps.fetchUserWithSpecialChars("1"),
        { key: "user:1" }
      );
    });

    const diagram = collector.visualizeAs("mermaid");
    expect(diagram).toContain("flowchart TD");
    // The step name should appear in the output (may be quoted/escaped)
    expect(diagram).toContain("Fetch User");
    // Validate with mermaid parser - this is the key test
    await validateMermaid(diagram);
  });

  it("should handle step names with brackets", async () => {
    const collector = createEventCollector({ workflowName: "test-workflow" });

    const workflow = createWorkflow("workflow", { processDataWithBrackets }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(
        "Process [Data] with Brackets",
        () => deps.processDataWithBrackets({ value: "test" }),
        { key: "process:data" }
      );
    });

    const diagram = collector.visualizeAs("mermaid");
    expect(diagram).toContain("flowchart TD");
    // The step name should appear in the output (may be quoted/escaped)
    expect(diagram).toContain("Process");
    // Validate with mermaid parser - this is the key test
    await validateMermaid(diagram);
  });

  it("should handle step names with quotes", async () => {
    const collector = createEventCollector({ workflowName: "test-workflow" });

    const workflow = createWorkflow("workflow", { fetchUserWithSpecialChars }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(
        'Step with "quotes"',
        () => deps.fetchUserWithSpecialChars("1"),
        { key: "user:1" }
      );
    });

    const diagram = collector.visualizeAs("mermaid");
    expect(diagram).toContain("flowchart TD");
    // The step name should appear in the output (may be quoted/escaped)
    expect(diagram).toContain("Step with");
    // Validate with mermaid parser - this is the key test
    await validateMermaid(diagram);
  });

  it("should handle parallel subgraph names with special chars", async () => {
    const collector = createEventCollector({ workflowName: "test-workflow" });

    const workflow = createWorkflow("workflow", { fetchUserWithSpecialChars }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step.parallel("Parallel (with parens)", async () => {
        const user = await deps.fetchUserWithSpecialChars("1");
        return ok([user]);
      });
    });

    const diagram = collector.visualizeAs("mermaid");
    // Should not contain unescaped parentheses in subgraph names
    expect(diagram).not.toMatch(/subgraph.*\[.*\(.*\).*\]/);
    expect(diagram).toContain("flowchart TD");
    await validateMermaid(diagram);
  });

  it("should handle race subgraph names with special chars", async () => {
    const collector = createEventCollector({ workflowName: "test-workflow" });

    const fetch1 = async (): AsyncResult<string, "ERROR"> => ok("result1");
    const fetch2 = async (): AsyncResult<string, "ERROR"> => ok("result2");

    const workflow = createWorkflow("workflow", { fetch1, fetch2 }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step) => {
      await step.race("Race [with brackets]", () =>
        Promise.resolve(ok("result1"))
      );
    });

    const diagram = collector.visualizeAs("mermaid");
    // Should not contain unescaped brackets in subgraph names
    expect(diagram).not.toMatch(/subgraph.*\[.*\[.*\].*\]/);
    expect(diagram).toContain("flowchart TD");
    await validateMermaid(diagram);
  });

  it("should handle all edge cases together", async () => {
    const collector = createEventCollector({ workflowName: "edge-cases" });

    const workflow = createWorkflow(
      "workflow",
      { fetchUserWithSpecialChars, processDataWithBrackets },
      {
        onEvent: collector.handleEvent,
      }
    );

    await workflow(async (step, deps) => {
      // Step with special chars in name (now using explicit ID as first param)
      const user = await step(
        'Fetch "User" (with) [special] chars',
        () => deps.fetchUserWithSpecialChars("1"),
        { key: "user:1" }
      );

      // Parallel with special chars
      await step.parallel('Parallel "test" [brackets]', async () => {
        return ok([user]);
      });

      // Process with brackets (now using explicit ID as first param)
      await step(
        "Process {data}",
        () => deps.processDataWithBrackets({ value: user.name }),
        { key: "process" }
      );
    });

    const diagram = collector.visualizeAs("mermaid");

    // Validate the diagram structure
    expect(diagram).toContain("flowchart TD");
    // The step names should appear in the output (may be quoted/escaped)
    expect(diagram).toContain("Fetch");
    expect(diagram).toContain("Process");
    // Validate with mermaid parser - this is the key test
    await validateMermaid(diagram);
  });
});

describe("Mermaid Enhanced Edges", () => {
  it("should render retry loop edges for steps with retries", async () => {
    let attempts = 0;
    const failingThenSucceed = async (): AsyncResult<string, "FAIL"> => {
      attempts++;
      if (attempts < 3) {
        return err("FAIL");
      }
      return ok("success");
    };

    const collector = createEventCollector({ workflowName: "retry-test" });

    const workflow = createWorkflow("workflow", { failingThenSucceed }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(
        "Retrying Operation",
        () => deps.failingThenSucceed(),
        { key: "retrying-step", retry: { attempts: 3 } }
      );
    });

    const diagram = collector.visualizeAs("mermaid");

    // Should contain retry self-loop edge
    expect(diagram).toContain("-.->|");
    expect(diagram).toMatch(/retr(y|ies)/);
    expect(diagram).toContain("flowchart TD");
    await validateMermaid(diagram);
  });

  it("should render error path edges for failed steps", async () => {
    const alwaysFails = async (): AsyncResult<string, "ALWAYS_FAILS"> => {
      return err("ALWAYS_FAILS");
    };

    const collector = createEventCollector({ workflowName: "error-test" });

    const workflow = createWorkflow("workflow", { alwaysFails }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(
        "Failing Operation",
        () => deps.alwaysFails(),
        { key: "failing-step" }
      );
    });

    const diagram = collector.visualizeAs("mermaid");

    // Should contain error path edge
    expect(diagram).toContain("-->|error|");
    expect(diagram).toContain("ERR_");
    expect(diagram).toContain("ALWAYS_FAILS");
    // Should have error styling
    expect(diagram).toContain("fill:#fee2e2");
    expect(diagram).toContain("flowchart TD");
    await validateMermaid(diagram);
  });

  it("should render timeout edges for timed out steps", async () => {
    const slowOperation = async (): AsyncResult<string, "TIMEOUT"> => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return ok("done");
    };

    const collector = createEventCollector({ workflowName: "timeout-test" });

    const workflow = createWorkflow("workflow", { slowOperation }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(
        "Slow Operation",
        () => deps.slowOperation(),
        { key: "slow-step", timeout: { ms: 50 } }
      );
    });

    const diagram = collector.visualizeAs("mermaid");

    // Should contain timeout edge
    expect(diagram).toContain("-.->|timeout|");
    expect(diagram).toContain("TO_");
    expect(diagram).toContain("⏱ Timeout");
    // Should have timeout styling
    expect(diagram).toContain("fill:#fef3c7");
    expect(diagram).toContain("flowchart TD");
    await validateMermaid(diagram);
  });

  it("should allow disabling enhanced edges via options", async () => {
    let attempts = 0;
    const failingThenSucceed = async (): AsyncResult<string, "FAIL"> => {
      attempts++;
      if (attempts < 2) {
        return err("FAIL");
      }
      return ok("success");
    };

    const viz = createVisualizer({ workflowName: "options-test" });

    const workflow = createWorkflow("workflow", { failingThenSucceed }, {
      onEvent: viz.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(
        "Retrying Operation",
        () => deps.failingThenSucceed(),
        { key: "retrying-step", retry: { attempts: 3 } }
      );
    });

    // Get IR and render with custom options
    const ir = viz.getIR();
    const renderer = mermaidRenderer();

    const options: MermaidRenderOptions = {
      showTimings: true,
      showKeys: false,
      colors: defaultColorScheme,
      showRetryEdges: false,
      showErrorEdges: false,
      showTimeoutEdges: false,
    };

    const diagram = renderer.render(ir, options);

    // Should NOT contain retry self-loop edge when disabled
    expect(diagram).not.toContain("-.->|");
    expect(diagram).toContain("flowchart TD");
    await validateMermaid(diagram);
  });
});
