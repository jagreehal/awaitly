/**
 * Hook Visualization Tests
 */

import { describe, it, expect } from "vitest";
import { createWorkflow } from "../workflow";
import { createVisualizer } from "./index";
import { ok, type WorkflowEvent } from "../core";

describe("Hook Visualization", () => {
  it("should visualize shouldRun hook", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const viz = createVisualizer({ workflowName: "hook-test" });

    const workflow = createWorkflow(
      {},
      {
        onEvent: (e) => {
          events.push(e);
          viz.handleEvent(e);
        },
        shouldRun: async () => {
          return true; // Proceed with workflow
        },
      }
    );

    await workflow(async (step) => {
      await step(() => ok("done"), { key: "test-step" });
    });

    const ir = viz.getIR();
    
    // Verify hooks are captured
    expect(ir.hooks).toBeDefined();
    expect(ir.hooks?.shouldRun).toBeDefined();
    expect(ir.hooks?.shouldRun?.state).toBe("success");
    expect(ir.hooks?.shouldRun?.context?.result).toBe(true);
    expect(ir.hooks?.shouldRun?.durationMs).toBeGreaterThanOrEqual(0);

    // Verify ASCII output contains hook
    const ascii = viz.render();
    console.log("\n=== shouldRun Hook Visualization ===\n" + ascii);
    expect(ascii).toContain("shouldRun");
  });

  it("should visualize onBeforeStart hook", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const viz = createVisualizer({ workflowName: "beforestart-test" });

    const workflow = createWorkflow(
      {},
      {
        onEvent: (e) => {
          events.push(e);
          viz.handleEvent(e);
        },
        onBeforeStart: async () => {
          return true;
        },
      }
    );

    await workflow(async (step) => {
      await step(() => ok("done"), { key: "test-step" });
    });

    const ir = viz.getIR();
    
    expect(ir.hooks).toBeDefined();
    expect(ir.hooks?.onBeforeStart).toBeDefined();
    expect(ir.hooks?.onBeforeStart?.state).toBe("success");

    const ascii = viz.render();
    console.log("\n=== onBeforeStart Hook Visualization ===\n" + ascii);
    expect(ascii).toContain("onBeforeStart");
  });

  it("should visualize onAfterStep hook", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const viz = createVisualizer({ workflowName: "afterstep-test" });

    const workflow = createWorkflow(
      {},
      {
        onEvent: (e) => {
          events.push(e);
          viz.handleEvent(e);
        },
        onAfterStep: async (_stepKey, _result) => {
          // Hook called after each keyed step
        },
      }
    );

    await workflow(async (step) => {
      await step(() => ok("first"), { key: "step-1" });
      await step(() => ok("second"), { key: "step-2" });
    });

    const ir = viz.getIR();
    
    expect(ir.hooks).toBeDefined();
    expect(ir.hooks?.onAfterStep.size).toBe(2);
    expect(ir.hooks?.onAfterStep.get("step-1")).toBeDefined();
    expect(ir.hooks?.onAfterStep.get("step-2")).toBeDefined();
    expect(ir.hooks?.onAfterStep.get("step-1")?.state).toBe("success");

    const ascii = viz.render();
    console.log("\n=== onAfterStep Hook Visualization ===\n" + ascii);
    // The hook indicator (⚙) should appear inline with steps
  });

  it("should visualize all hooks together", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const viz = createVisualizer({ workflowName: "all-hooks-test" });

    const workflow = createWorkflow(
      {},
      {
        onEvent: (e) => {
          events.push(e);
          viz.handleEvent(e);
        },
        shouldRun: async () => true,
        onBeforeStart: async () => true,
        onAfterStep: async () => {},
      }
    );

    await workflow(async (step) => {
      await step(() => ok("done"), { key: "my-step" });
    });

    const ir = viz.getIR();
    
    expect(ir.hooks?.shouldRun).toBeDefined();
    expect(ir.hooks?.onBeforeStart).toBeDefined();
    expect(ir.hooks?.onAfterStep.size).toBe(1);

    const ascii = viz.render();
    console.log("\n=== All Hooks Visualization ===\n" + ascii);
    expect(ascii).toContain("shouldRun");
    expect(ascii).toContain("onBeforeStart");

    // Also test Mermaid output
    const mermaid = viz.renderAs("mermaid");
    console.log("\n=== Mermaid with Hooks ===\n" + mermaid);
    expect(mermaid).toContain("hook_shouldRun");
    expect(mermaid).toContain("hook_beforeStart");
  });

  it("should visualize hook errors", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const viz = createVisualizer({ workflowName: "hook-error-test" });

    const workflow = createWorkflow(
      {},
      {
        onEvent: (e) => {
          events.push(e);
          viz.handleEvent(e);
        },
        shouldRun: async () => {
          throw new Error("shouldRun failed");
        },
      }
    );

    try {
      await workflow(async (step) => {
        await step(() => ok("done"), { key: "test-step" });
      });
    } catch {
      // Expected to throw
    }

    const ir = viz.getIR();
    
    expect(ir.hooks?.shouldRun).toBeDefined();
    expect(ir.hooks?.shouldRun?.state).toBe("error");

    const ascii = viz.render();
    console.log("\n=== Hook Error Visualization ===\n" + ascii);
  });
});
