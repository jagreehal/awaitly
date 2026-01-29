import { describe, it, expect } from "vitest";
import { createPerformanceAnalyzer } from "./performance-analyzer";
import { createIRBuilder } from "./ir-builder";
import type { WorkflowEvent } from "awaitly/workflow";

describe("createPerformanceAnalyzer", () => {
  it("maps heatmap data for steps with stepKey but no name", () => {
    const analyzer = createPerformanceAnalyzer();
    const builder = createIRBuilder();

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-1", ts: 0 },
      {
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-123",
        stepKey: "fetch-user",
        ts: 1,
      },
      {
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-123",
        stepKey: "fetch-user",
        ts: 11,
        durationMs: 10,
      },
      {
        type: "workflow_success",
        workflowId: "wf-1",
        ts: 12,
        durationMs: 12,
      },
    ];

    analyzer.addRun({ id: "run-1", startTime: 0, events });
    for (const event of events) {
      builder.handleEvent(event);
    }

    const ir = builder.getIR();
    const heatmap = analyzer.getHeatmap(ir, "duration");

    expect(heatmap.heat.has("step-123")).toBe(true);
  });

  it("computes timeoutRate based on total runs, not only timeouts", () => {
    const analyzer = createPerformanceAnalyzer();

    const runWithTimeout: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-1", ts: 0 },
      {
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        stepKey: "step-a",
        ts: 1,
      },
      {
        type: "step_timeout",
        workflowId: "wf-1",
        stepId: "step-1",
        stepKey: "step-a",
        ts: 5,
        timeoutMs: 100,
      },
      {
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        stepKey: "step-a",
        ts: 11,
        durationMs: 10,
      },
      { type: "workflow_success", workflowId: "wf-1", ts: 12, durationMs: 12 },
    ];

    const runWithoutTimeout: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-2", ts: 0 },
      {
        type: "step_start",
        workflowId: "wf-2",
        stepId: "step-1",
        stepKey: "step-a",
        ts: 1,
      },
      {
        type: "step_success",
        workflowId: "wf-2",
        stepId: "step-1",
        stepKey: "step-a",
        ts: 11,
        durationMs: 10,
      },
      { type: "workflow_success", workflowId: "wf-2", ts: 12, durationMs: 12 },
    ];

    analyzer.addRun({ id: "run-1", startTime: 0, events: runWithTimeout });
    analyzer.addRun({ id: "run-2", startTime: 0, events: runWithoutTimeout });

    const perf = analyzer.getNodePerformance("step-a");
    expect(perf?.timeoutRate).toBe(0.5);
  });

  it("does not merge metrics for steps that share a name but differ by key", () => {
    const analyzer = createPerformanceAnalyzer();

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-3", ts: 0 },
      {
        type: "step_start",
        workflowId: "wf-3",
        stepId: "step-1",
        stepKey: "alpha",
        name: "same-name",
        ts: 1,
      },
      {
        type: "step_success",
        workflowId: "wf-3",
        stepId: "step-1",
        stepKey: "alpha",
        name: "same-name",
        ts: 5,
        durationMs: 4,
      },
      {
        type: "step_start",
        workflowId: "wf-3",
        stepId: "step-2",
        stepKey: "beta",
        name: "same-name",
        ts: 6,
      },
      {
        type: "step_success",
        workflowId: "wf-3",
        stepId: "step-2",
        stepKey: "beta",
        name: "same-name",
        ts: 10,
        durationMs: 4,
      },
      { type: "workflow_success", workflowId: "wf-3", ts: 11, durationMs: 11 },
    ];

    analyzer.addRun({ id: "run-3", startTime: 0, events });

    const performance = analyzer.getAllPerformance();
    expect(performance.size).toBe(2);
  });

  it("does not merge metrics for steps that share a name but have different stepIds", () => {
    const analyzer = createPerformanceAnalyzer();

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-4", ts: 0 },
      {
        type: "step_start",
        workflowId: "wf-4",
        stepId: "step-1",
        name: "same-name",
        ts: 1,
      },
      {
        type: "step_success",
        workflowId: "wf-4",
        stepId: "step-1",
        name: "same-name",
        ts: 5,
        durationMs: 4,
      },
      {
        type: "step_start",
        workflowId: "wf-4",
        stepId: "step-2",
        name: "same-name",
        ts: 6,
      },
      {
        type: "step_success",
        workflowId: "wf-4",
        stepId: "step-2",
        name: "same-name",
        ts: 10,
        durationMs: 4,
      },
      { type: "workflow_success", workflowId: "wf-4", ts: 11, durationMs: 11 },
    ];

    analyzer.addRun({ id: "run-4", startTime: 0, events });

    const performance = analyzer.getAllPerformance();
    expect(performance.size).toBe(2);
  });

  it("tracks retries when retry events omit name but include stepId", () => {
    const analyzer = createPerformanceAnalyzer();

    const events: WorkflowEvent<unknown>[] = [
      { type: "workflow_start", workflowId: "wf-5", ts: 0 },
      {
        type: "step_start",
        workflowId: "wf-5",
        stepId: "step-1",
        name: "named-step",
        ts: 1,
      },
      {
        type: "step_retry",
        workflowId: "wf-5",
        stepId: "step-1",
        ts: 3,
        attempt: 2,
      },
      {
        type: "step_success",
        workflowId: "wf-5",
        stepId: "step-1",
        ts: 6,
        durationMs: 5,
      },
      { type: "workflow_success", workflowId: "wf-5", ts: 7, durationMs: 7 },
    ];

    analyzer.addRun({ id: "run-5", startTime: 0, events });

    const perf = analyzer.getNodePerformance("step-1");
    expect(perf?.retryRate).toBe(1);
  });
});
