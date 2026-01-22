/**
 * Tests for the logger renderer.
 */

import { describe, it, expect } from "vitest";
import { ok, err, type AsyncResult } from "../core";
import { createWorkflow } from "../workflow";
import { createEventCollector, createVisualizer, type LoggerOutput } from "./index";

describe("Logger Renderer", () => {
  it("should output structured JSON with workflow info", async () => {
    const fetchUser = async (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
      return ok({ id, name: "Alice" });
    };

    const collector = createEventCollector({ workflowName: "test-workflow" });
    const workflow = createWorkflow({ fetchUser }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.fetchUser("1"), {
        key: "user:1",
        name: "Fetch user",
      });
    });

    const logJson = collector.visualizeAs("logger");
    const logData = JSON.parse(logJson) as LoggerOutput;

    expect(logData.workflow.name).toBe("test-workflow");
    expect(logData.workflow.state).toBe("success");
    expect(logData.workflow.durationMs).toBeTypeOf("number");
  });

  it("should include step details", async () => {
    const step1 = async (): AsyncResult<string, "ERROR"> => ok("result1");
    const step2 = async (): AsyncResult<string, "ERROR"> => ok("result2");

    const collector = createEventCollector({ workflowName: "multi-step" });
    const workflow = createWorkflow({ step1, step2 }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.step1(), { name: "Step 1", key: "s1" });
      await step(() => deps.step2(), { name: "Step 2", key: "s2" });
    });

    const logData = JSON.parse(collector.visualizeAs("logger")) as LoggerOutput;

    expect(logData.steps).toHaveLength(2);
    expect(logData.steps[0].name).toBe("Step 1");
    expect(logData.steps[0].key).toBe("s1");
    expect(logData.steps[0].state).toBe("success");
    expect(logData.steps[1].name).toBe("Step 2");
  });

  it("should calculate summary statistics", async () => {
    const succeed = async (): AsyncResult<string, "ERROR"> => ok("ok");
    const fail = async (): AsyncResult<string, "FAIL"> => err("FAIL");

    const collector = createEventCollector({ workflowName: "summary-test" });
    const workflow = createWorkflow({ succeed, fail }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.succeed(), { name: "Success 1" });
      await step(() => deps.succeed(), { name: "Success 2" });
      await step(() => deps.fail(), { name: "Failure" });
    });

    const logData = JSON.parse(collector.visualizeAs("logger")) as LoggerOutput;

    expect(logData.summary.totalSteps).toBe(3);
    expect(logData.summary.successCount).toBe(2);
    expect(logData.summary.errorCount).toBe(1);
  });

  it("should track retries", async () => {
    let attempts = 0;
    const failingThenSucceed = async (): AsyncResult<string, "FAIL"> => {
      attempts++;
      if (attempts < 3) {
        return err("FAIL");
      }
      return ok("success");
    };

    const collector = createEventCollector({ workflowName: "retry-test" });
    const workflow = createWorkflow({ failingThenSucceed }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.failingThenSucceed(), {
        name: "Retrying Step",
        retry: { attempts: 3 },
      });
    });

    const logData = JSON.parse(collector.visualizeAs("logger")) as LoggerOutput;

    expect(logData.steps[0].retryCount).toBe(2);
    expect(logData.summary.totalRetries).toBe(2);
  });

  it("should track slowest step", async () => {
    const fast = async (): AsyncResult<string, "ERROR"> => ok("fast");
    const slow = async (): AsyncResult<string, "ERROR"> => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return ok("slow");
    };

    const collector = createEventCollector({ workflowName: "timing-test" });
    const workflow = createWorkflow({ fast, slow }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.fast(), { name: "Fast Step" });
      await step(() => deps.slow(), { name: "Slow Step" });
    });

    const logData = JSON.parse(collector.visualizeAs("logger")) as LoggerOutput;

    expect(logData.summary.slowestStep).toBeDefined();
    expect(logData.summary.slowestStep?.name).toBe("Slow Step");
    expect(logData.summary.slowestStep?.durationMs).toBeGreaterThan(40);
  });

  it("should include ASCII diagram by default", async () => {
    const step1 = async (): AsyncResult<string, "ERROR"> => ok("result");

    const collector = createEventCollector({ workflowName: "diagram-test" });
    const workflow = createWorkflow({ step1 }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.step1(), { name: "My Step" });
    });

    const logData = JSON.parse(collector.visualizeAs("logger")) as LoggerOutput;

    expect(logData.diagram).toBeDefined();
    expect(logData.diagram).toContain("diagram-test");
    expect(logData.diagram).toContain("My Step");
    // Should be stripped of ANSI codes
    expect(logData.diagram).not.toContain("\x1b[");
  });

  it("should track errors", async () => {
    const alwaysFails = async (): AsyncResult<string, "ALWAYS_FAILS"> => {
      return err("ALWAYS_FAILS");
    };

    const collector = createEventCollector({ workflowName: "error-test" });
    const workflow = createWorkflow({ alwaysFails }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.alwaysFails(), { name: "Failing Step" });
    });

    const logData = JSON.parse(collector.visualizeAs("logger")) as LoggerOutput;

    expect(logData.steps[0].state).toBe("error");
    expect(logData.steps[0].error).toBe("ALWAYS_FAILS");
    expect(logData.summary.errorCount).toBe(1);
  });

  it("should work with createVisualizer", async () => {
    const step1 = async (): AsyncResult<string, "ERROR"> => ok("result");

    const viz = createVisualizer({ workflowName: "viz-test" });
    const workflow = createWorkflow({ step1 }, {
      onEvent: viz.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.step1(), { name: "Test Step" });
    });

    const logData = JSON.parse(viz.renderAs("logger")) as LoggerOutput;

    expect(logData.workflow.name).toBe("viz-test");
    expect(logData.steps).toHaveLength(1);
    expect(logData.diagram).toBeDefined();
  });

  it("should handle parallel steps", async () => {
    const step1 = async (): AsyncResult<string, "ERROR"> => ok("result1");
    const step2 = async (): AsyncResult<string, "ERROR"> => ok("result2");

    const collector = createEventCollector({ workflowName: "parallel-test" });
    const workflow = createWorkflow({ step1, step2 }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step.parallel("Parallel Block", async () => {
        const r1 = await deps.step1();
        const r2 = await deps.step2();
        return ok([r1, r2]);
      });
    });

    const logData = JSON.parse(collector.visualizeAs("logger")) as LoggerOutput;

    // Should have workflow info
    expect(logData.workflow.name).toBe("parallel-test");
    expect(logData.workflow.state).toBe("success");
  });

  it("should handle timeout tracking", async () => {
    const slowOperation = async (): AsyncResult<string, "TIMEOUT"> => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return ok("done");
    };

    const collector = createEventCollector({ workflowName: "timeout-test" });
    const workflow = createWorkflow({ slowOperation }, {
      onEvent: collector.handleEvent,
    });

    await workflow(async (step, deps) => {
      await step(() => deps.slowOperation(), {
        name: "Slow Step",
        timeout: { ms: 30 },
      });
    });

    const logData = JSON.parse(collector.visualizeAs("logger")) as LoggerOutput;

    expect(logData.steps[0].timedOut).toBe(true);
    expect(logData.steps[0].timeoutMs).toBe(30);
  });
});
