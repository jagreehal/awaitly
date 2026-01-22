import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDevtools,
  renderDiff,
  createConsoleLogger,
  quickVisualize,
} from "./devtools";

describe("Devtools", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createDevtools", () => {
    it("should create a devtools instance", () => {
      const devtools = createDevtools({ workflowName: "test" });
      expect(devtools).toBeDefined();
      expect(devtools.handleEvent).toBeInstanceOf(Function);
      expect(devtools.render).toBeInstanceOf(Function);
    });

    it("should track workflow start event", () => {
      const devtools = createDevtools({ workflowName: "checkout" });

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      const run = devtools.getCurrentRun();
      expect(run).toBeDefined();
      expect(run?.id).toBe("wf-1");
      expect(run?.name).toBe("checkout");
    });

    it("should track step events", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      devtools.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        stepKey: "user:1",
        ts: now + 10,
      });

      devtools.handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        stepKey: "user:1",
        ts: now + 55,
        durationMs: 45,
        result: { id: "1", name: "Alice" },
      });

      const run = devtools.getCurrentRun();
      expect(run?.events).toHaveLength(3);
    });

    it("should track workflow completion", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      vi.advanceTimersByTime(100);

      devtools.handleEvent({
        type: "workflow_success",
        workflowId: "wf-1",
        ts: Date.now(),
        durationMs: 100,
        result: { success: true },
      });

      const run = devtools.getCurrentRun();
      expect(run?.success).toBe(true);
      expect(run?.durationMs).toBeDefined();
    });

    it("should track workflow errors", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      devtools.handleEvent({
        type: "workflow_error",
        workflowId: "wf-1",
        ts: now + 50,
        durationMs: 50,
        error: { code: "PAYMENT_FAILED" },
      });

      const run = devtools.getCurrentRun();
      expect(run?.success).toBe(false);
      expect(run?.error).toEqual({ code: "PAYMENT_FAILED" });
    });
  });

  describe("render", () => {
    it("should render ASCII output", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      devtools.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: now + 10,
      });

      devtools.handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: now + 55,
        durationMs: 45,
        result: { id: "1" },
      });

      const output = devtools.render();
      expect(typeof output).toBe("string");
      expect(output.length).toBeGreaterThan(0);
    });

    it("should render Mermaid diagrams", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      devtools.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: now + 10,
      });

      devtools.handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: now + 55,
        durationMs: 45,
        result: { id: "1" },
      });

      const mermaid = devtools.renderMermaid();
      expect(typeof mermaid).toBe("string");
    });
  });

  describe("renderTimeline", () => {
    it("should render timeline for steps", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      devtools.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: now + 10,
      });

      devtools.handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: now + 55,
        durationMs: 45,
        result: { id: "1" },
      });

      const timeline = devtools.renderTimeline();
      expect(timeline).toContain("Timeline:");
      expect(timeline).toContain("Fetch user");
    });

    it("should return 'No timeline data' when empty", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const timeline = devtools.renderTimeline();
      expect(timeline).toBe("No timeline data");
    });
  });

  describe("getTimeline", () => {
    it("should return timeline entries", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      devtools.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        stepKey: "user:1",
        ts: now + 10,
      });

      devtools.handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        stepKey: "user:1",
        ts: now + 55,
        durationMs: 45,
        result: { id: "1" },
      });

      const timeline = devtools.getTimeline();
      expect(timeline).toHaveLength(1);
      expect(timeline[0].name).toBe("Fetch user");
      expect(timeline[0].status).toBe("success");
      expect(timeline[0].durationMs).toBe(45);
    });

    it("should track cached steps", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      devtools.handleEvent({
        type: "step_cache_hit",
        workflowId: "wf-1",
        stepKey: "user:1",
        name: "Fetch user",
        ts: now + 5,
        result: { id: "1" },
      });

      const timeline = devtools.getTimeline();
      expect(timeline).toHaveLength(1);
      expect(timeline[0].status).toBe("cached");
    });

    it("should track skipped steps", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: now,
      });

      devtools.handleEvent({
        type: "step_skipped",
        workflowId: "wf-1",
        stepKey: "optional-step",
        name: "Optional step",
        ts: now + 5,
        reason: "condition not met",
      });

      const timeline = devtools.getTimeline();
      expect(timeline).toHaveLength(1);
      expect(timeline[0].status).toBe("skipped");
    });
  });

  describe("history", () => {
    it("should store runs in history", () => {
      const devtools = createDevtools({ workflowName: "checkout", maxHistory: 5 });
      const now = Date.now();

      // Complete first run
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: now + 100, durationMs: 100, result: {} });

      // Start second run (pushes first to history)
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: now + 200 });

      const history = devtools.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe("wf-1");
    });

    it("should limit history size", () => {
      const devtools = createDevtools({ workflowName: "checkout", maxHistory: 2 });
      const now = Date.now();

      // Create 3 runs
      for (let i = 1; i <= 3; i++) {
        devtools.handleEvent({ type: "workflow_start", workflowId: `wf-${i}`, ts: now + i * 100 });
        devtools.handleEvent({ type: "workflow_success", workflowId: `wf-${i}`, ts: now + i * 100 + 50, durationMs: 50, result: {} });
      }

      // Start a 4th run to push the 3rd to history
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-4", ts: now + 500 });

      const history = devtools.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe("wf-2"); // wf-1 was evicted
      expect(history[1].id).toBe("wf-3");
    });

    it("should retrieve run by ID", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: now + 100, durationMs: 100, result: {} });

      // Push to history by starting new run
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: now + 200 });

      const run = devtools.getRun("wf-1");
      expect(run).toBeDefined();
      expect(run?.id).toBe("wf-1");
    });

    it("should return current run when queried by ID", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });

      const run = devtools.getRun("wf-1");
      expect(run).toBeDefined();
      expect(run?.id).toBe("wf-1");
    });

    it("should clear history", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: now + 100, durationMs: 100, result: {} });
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: now + 200 });

      devtools.clearHistory();

      expect(devtools.getHistory()).toHaveLength(0);
    });
  });

  describe("diff", () => {
    it("should compare two runs", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      // First run with step-1 success
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });
      devtools.handleEvent({ type: "step_start", workflowId: "wf-1", stepId: "s1", name: "Step A", ts: now + 10 });
      devtools.handleEvent({ type: "step_success", workflowId: "wf-1", stepId: "s1", name: "Step A", ts: now + 50, durationMs: 40, result: {} });
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: now + 100, durationMs: 100, result: {} });

      // Second run with step-1 error
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: now + 200 });
      devtools.handleEvent({ type: "step_start", workflowId: "wf-2", stepId: "s1", name: "Step A", ts: now + 210 });
      devtools.handleEvent({ type: "step_error", workflowId: "wf-2", stepId: "s1", name: "Step A", ts: now + 250, durationMs: 40, error: "failed" });
      devtools.handleEvent({ type: "workflow_error", workflowId: "wf-2", ts: now + 300, durationMs: 100, error: "failed" });

      const diff = devtools.diff("wf-1", "wf-2");
      expect(diff).toBeDefined();
      expect(diff?.changed).toHaveLength(1);
      expect(diff?.changed[0].step).toBe("Step A");
      expect(diff?.statusChange).toEqual({ from: "success", to: "error" });
    });

    it("should detect added steps", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      // First run with 1 step
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });
      devtools.handleEvent({ type: "step_start", workflowId: "wf-1", stepId: "s1", name: "Step A", ts: now + 10 });
      devtools.handleEvent({ type: "step_success", workflowId: "wf-1", stepId: "s1", name: "Step A", ts: now + 50, durationMs: 40, result: {} });
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: now + 100, durationMs: 100, result: {} });

      // Second run with 2 steps
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: now + 200 });
      devtools.handleEvent({ type: "step_start", workflowId: "wf-2", stepId: "s1", name: "Step A", ts: now + 210 });
      devtools.handleEvent({ type: "step_success", workflowId: "wf-2", stepId: "s1", name: "Step A", ts: now + 250, durationMs: 40, result: {} });
      devtools.handleEvent({ type: "step_start", workflowId: "wf-2", stepId: "s2", name: "Step B", ts: now + 260 });
      devtools.handleEvent({ type: "step_success", workflowId: "wf-2", stepId: "s2", name: "Step B", ts: now + 300, durationMs: 40, result: {} });
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-2", ts: now + 350, durationMs: 150, result: {} });

      const diff = devtools.diff("wf-1", "wf-2");
      expect(diff).toBeDefined();
      expect(diff?.added).toHaveLength(1);
      expect(diff?.added[0].step).toBe("Step B");
    });

    it("should compare with previous run", () => {
      const devtools = createDevtools({ workflowName: "checkout" });

      // First run
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: 1000 });
      vi.advanceTimersByTime(100);
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: 1100, durationMs: 100, result: {} });

      // Second run
      vi.advanceTimersByTime(100);
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: 1200 });
      vi.advanceTimersByTime(150);
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-2", ts: 1350, durationMs: 150, result: {} });

      const diff = devtools.diffWithPrevious();
      expect(diff).toBeDefined();
      // Duration change is calculated from actual durationMs in workflow events
      expect(diff?.durationChange).toBe(50);
    });

    it("should return undefined for missing runs", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const diff = devtools.diff("wf-1", "wf-2");
      expect(diff).toBeUndefined();
    });
  });

  describe("export/import", () => {
    it("should export current run as JSON", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: now + 100, durationMs: 100, result: {} });

      const json = devtools.exportRun();
      expect(json).toContain("wf-1");

      const parsed = JSON.parse(json);
      expect(parsed.id).toBe("wf-1");
    });

    it("should export specific run by ID", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });
      devtools.handleEvent({ type: "workflow_success", workflowId: "wf-1", ts: now + 100, durationMs: 100, result: {} });
      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-2", ts: now + 200 });

      const json = devtools.exportRun("wf-1");
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe("wf-1");
    });

    it("should import run from JSON", () => {
      const devtools = createDevtools({ workflowName: "checkout" });

      const runData = {
        id: "imported-1",
        name: "imported",
        startTime: Date.now(),
        events: [],
      };

      const imported = devtools.importRun(JSON.stringify(runData));
      expect(imported.id).toBe("imported-1");

      const history = devtools.getHistory();
      expect(history.some((r) => r.id === "imported-1")).toBe(true);
    });
  });

  describe("reset", () => {
    it("should reset current run", () => {
      const devtools = createDevtools({ workflowName: "checkout" });
      const now = Date.now();

      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: now });

      devtools.reset();

      expect(devtools.getCurrentRun()).toBeUndefined();
    });
  });

  describe("logEvents option", () => {
    it("should log events when enabled", () => {
      const logMessages: string[] = [];
      const devtools = createDevtools({
        workflowName: "checkout",
        logEvents: true,
        logger: (msg) => logMessages.push(msg),
      });

      devtools.handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: Date.now() });

      expect(logMessages.length).toBeGreaterThan(0);
      expect(logMessages[0]).toContain("[devtools]");
      expect(logMessages[0]).toContain("workflow_start");
    });
  });
});

describe("renderDiff", () => {
  it("should render status change", () => {
    const output = renderDiff({
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
      statusChange: { from: "success", to: "error" },
    });

    expect(output).toContain("Status: success → error");
  });

  it("should render duration change", () => {
    const output = renderDiff({
      added: [],
      removed: [],
      changed: [],
      unchanged: [],
      durationChange: 50,
    });

    expect(output).toContain("Duration: +50ms");
  });

  it("should render added steps", () => {
    const output = renderDiff({
      added: [{ step: "New Step", type: "added", to: "success" }],
      removed: [],
      changed: [],
      unchanged: [],
    });

    expect(output).toContain("Added steps:");
    expect(output).toContain("+ New Step");
  });

  it("should render removed steps", () => {
    const output = renderDiff({
      added: [],
      removed: [{ step: "Old Step", type: "removed", from: "success" }],
      changed: [],
      unchanged: [],
    });

    expect(output).toContain("Removed steps:");
    expect(output).toContain("- Old Step");
  });

  it("should render changed steps", () => {
    const output = renderDiff({
      added: [],
      removed: [],
      changed: [{ step: "Step A", type: "status", from: "success", to: "error" }],
      unchanged: [],
    });

    expect(output).toContain("Changed steps:");
    expect(output).toContain("~ Step A: success → error");
  });

  it("should render unchanged count", () => {
    const output = renderDiff({
      added: [],
      removed: [],
      changed: [],
      unchanged: ["Step A", "Step B", "Step C"],
    });

    expect(output).toContain("Unchanged: 3 steps");
  });
});

describe("createConsoleLogger", () => {
  it("should create a logger function", () => {
    const logger = createConsoleLogger({ prefix: "[test]" });
    expect(logger).toBeInstanceOf(Function);
  });

  it("should handle workflow_start events", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createConsoleLogger({ prefix: "[test]", colors: false });

    logger({
      type: "workflow_start",
      workflowId: "wf-1",
      ts: Date.now(),
    });

    expect(consoleSpy).toHaveBeenCalled();
    const call = consoleSpy.mock.calls[0][0] as string;
    expect(call).toContain("Workflow started");

    consoleSpy.mockRestore();
  });

  it("should handle step_success events", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createConsoleLogger({ prefix: "[test]", colors: false });

    logger({
      type: "step_success",
      workflowId: "wf-1",
      stepId: "s1",
      name: "Fetch user",
      ts: Date.now(),
      durationMs: 45,
      result: {},
    });

    expect(consoleSpy).toHaveBeenCalled();
    const call = consoleSpy.mock.calls[0][0] as string;
    expect(call).toContain("Fetch user");
    expect(call).toContain("45ms");

    consoleSpy.mockRestore();
  });

  it("should handle step_retry events", () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createConsoleLogger({ prefix: "[test]", colors: false });

    logger({
      type: "step_retry",
      workflowId: "wf-1",
      stepId: "s1",
      name: "Fetch user",
      ts: Date.now(),
      attempt: 2,
      maxAttempts: 3,
      error: "timeout",
      delayMs: 1000,
    });

    expect(consoleSpy).toHaveBeenCalled();
    const call = consoleSpy.mock.calls[0][0] as string;
    expect(call).toContain("retry");
    expect(call).toContain("2/3");

    consoleSpy.mockRestore();
  });
});

describe("quickVisualize", () => {
  it("should visualize a workflow execution", async () => {
    const output = await quickVisualize(async (handleEvent) => {
      handleEvent({ type: "workflow_start", workflowId: "wf-1", ts: Date.now() });
      handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "s1",
        name: "Test step",
        ts: Date.now(),
      });
      handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "s1",
        name: "Test step",
        ts: Date.now(),
        durationMs: 10,
        result: {},
      });
      handleEvent({
        type: "workflow_success",
        workflowId: "wf-1",
        ts: Date.now(),
        durationMs: 50,
        result: {},
      });
    });

    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });
});
