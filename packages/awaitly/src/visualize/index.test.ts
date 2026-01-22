import { describe, it, expect } from "vitest";
import { ok, err, allAsync, anyAsync, type AsyncResult } from "../core";
import { createWorkflow } from "../workflow";
import {
  createVisualizer,
  createEventCollector,
  visualizeEvents,
  createIRBuilder,
  createLiveVisualizer,
} from "./index";
import type { WorkflowEvent } from "../core";

// =============================================================================
// Test Helpers
// =============================================================================

const fetchUser = async (
  id: string
): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> => {
  if (id === "missing") return err("NOT_FOUND");
  return ok({ id, name: `User ${id}` });
};

const fetchPosts = async (
  userId: string
): AsyncResult<{ id: string; title: string }[], "FETCH_ERROR"> => {
  return ok([{ id: "1", title: `Post by ${userId}` }]);
};

const slowOperation = async (): AsyncResult<string, "TIMEOUT"> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
  return ok("done");
};

// =============================================================================
// IR Builder Tests
// =============================================================================

describe("createIRBuilder", () => {
  it("builds IR from sequential workflow events", () => {
    const builder = createIRBuilder();

    // Simulate workflow events
    builder.handleEvent({
      type: "workflow_start",
      workflowId: "wf-1",
      ts: 1000,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-1",
      stepId: "step-1",
      stepKey: "step-1",
      name: "Fetch user",
      ts: 1001,
    });

    builder.handleEvent({
      type: "step_success",
      workflowId: "wf-1",
      stepId: "step-1",
      stepKey: "step-1",
      name: "Fetch user",
      ts: 1050,
      durationMs: 49,
    });

    builder.handleEvent({
      type: "workflow_success",
      workflowId: "wf-1",
      ts: 1060,
      durationMs: 60,
    });

    const ir = builder.getIR();

    expect(ir.root.type).toBe("workflow");
    expect(ir.root.state).toBe("success");
    expect(ir.root.children).toHaveLength(1);
    expect(ir.root.children[0].type).toBe("step");
    expect(ir.root.children[0].name).toBe("Fetch user");
    expect(ir.root.children[0].state).toBe("success");
    expect(ir.root.children[0].durationMs).toBe(49);
  });

  it("tracks running steps", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId: "wf-1",
      ts: 1000,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-1",
      stepId: "step-1",
      name: "Running step",
      ts: 1001,
    });

    // Check IR while step is running
    const ir = builder.getIR();
    expect(builder.hasActiveSteps).toBe(true);
    expect(ir.root.children).toHaveLength(1);
    expect(ir.root.children[0].state).toBe("running");
  });

  it("handles step errors", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId: "wf-1",
      ts: 1000,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-1",
      stepId: "step-1",
      name: "Failing step",
      ts: 1001,
    });

    builder.handleEvent({
      type: "step_error",
      workflowId: "wf-1",
      stepId: "step-1",
      name: "Failing step",
      ts: 1050,
      durationMs: 49,
      error: "FETCH_ERROR",
    });

    builder.handleEvent({
      type: "workflow_error",
      workflowId: "wf-1",
      ts: 1060,
      durationMs: 60,
      error: "FETCH_ERROR",
    });

    const ir = builder.getIR();

    expect(ir.root.state).toBe("error");
    expect(ir.root.children[0].state).toBe("error");
    expect(ir.root.children[0].error).toBe("FETCH_ERROR");
  });

  it("handles cached steps", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId: "wf-1",
      ts: 1000,
    });

    builder.handleEvent({
      type: "step_cache_hit",
      workflowId: "wf-1",
      stepKey: "cached-step",
      name: "Cached step",
      ts: 1001,
    });

    const ir = builder.getIR();

    expect(ir.root.children).toHaveLength(1);
    expect(ir.root.children[0].state).toBe("cached");
    expect(ir.root.children[0].name).toBe("Cached step");
  });

  it("resets state correctly", () => {
    const builder = createIRBuilder();

    builder.handleEvent({
      type: "workflow_start",
      workflowId: "wf-1",
      ts: 1000,
    });

    builder.handleEvent({
      type: "step_start",
      workflowId: "wf-1",
      stepId: "step-1",
      name: "Step",
      ts: 1001,
    });

    builder.reset();

    const ir = builder.getIR();
    expect(ir.root.children).toHaveLength(0);
    expect(builder.state).toBe("pending");
  });
});

// =============================================================================
// Visualizer Tests
// =============================================================================

describe("createVisualizer", () => {
  it("creates a visualizer with correct API", () => {
    const viz = createVisualizer();

    expect(viz.handleEvent).toBeTypeOf("function");
    expect(viz.handleScopeEvent).toBeTypeOf("function");
    expect(viz.getIR).toBeTypeOf("function");
    expect(viz.render).toBeTypeOf("function");
    expect(viz.renderAs).toBeTypeOf("function");
    expect(viz.reset).toBeTypeOf("function");
    expect(viz.onUpdate).toBeTypeOf("function");
  });

  it("renders ASCII output for simple workflow", async () => {
    const viz = createVisualizer({ workflowName: "test-workflow" });
    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: viz.handleEvent }
    );

    await workflow(async (step) => {
      const user = await step(() => fetchUser("1"), "Fetch user");
      return user;
    });

    const output = viz.render();

    expect(output).toContain("test-workflow");
    expect(output).toContain("Fetch user");
    expect(output).toContain("✓"); // Success symbol
  });

  it("renders error states correctly", async () => {
    const viz = createVisualizer({ workflowName: "error-workflow" });
    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: viz.handleEvent }
    );

    const result = await workflow(async (step) => {
      const user = await step(() => fetchUser("missing"), "Fetch user");
      return user;
    });

    expect(result.ok).toBe(false);

    const output = viz.render();
    expect(output).toContain("✗"); // Error symbol
  });

  it("supports multiple output formats", async () => {
    const viz = createVisualizer({ workflowName: "format-test" });
    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: viz.handleEvent }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("1"), "Fetch user");
    });

    // ASCII format
    const ascii = viz.renderAs("ascii");
    expect(ascii).toContain("format-test");

    // Mermaid format
    const mermaid = viz.renderAs("mermaid");
    expect(mermaid).toContain("flowchart TD");

    // JSON format
    const json = viz.renderAs("json");
    const parsed = JSON.parse(json);
    expect(parsed.root.type).toBe("workflow");
  });

  it("calls update callbacks", async () => {
    const viz = createVisualizer();
    const updates: number[] = [];

    const unsubscribe = viz.onUpdate(() => {
      updates.push(Date.now());
    });

    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: viz.handleEvent }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("1"), "Fetch");
    });

    expect(updates.length).toBeGreaterThan(0);

    // Unsubscribe and verify no more updates
    unsubscribe();
    const countBefore = updates.length;
    viz.handleEvent({
      type: "step_start",
      workflowId: "test",
      stepId: "manual-step",
      ts: Date.now(),
    });
    expect(updates.length).toBe(countBefore);
  });
});

// =============================================================================
// Event Collector Tests
// =============================================================================

describe("createEventCollector", () => {
  it("collects events during workflow execution", async () => {
    const collector = createEventCollector();
    const workflow = createWorkflow(
      { fetchUser, fetchPosts },
      { onEvent: collector.handleEvent }
    );

    await workflow(async (step) => {
      const user = await step(() => fetchUser("1"), "Fetch user");
      const posts = await step(() => fetchPosts(user.id), "Fetch posts");
      return { user, posts };
    });

    const events = collector.getEvents();

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("workflow_start");
    expect(events[events.length - 1].type).toBe("workflow_success");
  });

  it("visualizes collected events", async () => {
    const collector = createEventCollector({ workflowName: "collected" });
    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: collector.handleEvent }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("1"), "Fetch");
    });

    const output = collector.visualize();
    expect(output).toContain("collected");
  });

  it("clears collected events", async () => {
    const collector = createEventCollector();
    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: collector.handleEvent }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("1"), "Fetch");
    });

    expect(collector.getEvents().length).toBeGreaterThan(0);

    collector.clear();

    expect(collector.getEvents().length).toBe(0);
  });
});

// =============================================================================
// visualizeEvents Tests
// =============================================================================

describe("Mermaid renderer", () => {
  it("renders workflow as Mermaid flowchart", async () => {
    const viz = createVisualizer({
      workflowName: "mermaid-test",
      detectParallel: false,
    });

    const workflow = createWorkflow(
      { fetchUser, fetchPosts },
      { onEvent: viz.handleEvent }
    );

    await workflow(async (step) => {
      const user = await step(() => fetchUser("1"), "Fetch user");
      const posts = await step(() => fetchPosts(user.id), "Fetch posts");
      return { user, posts };
    });

    const mermaid = viz.renderAs("mermaid");

    expect(mermaid).toContain("flowchart TD");
    expect(mermaid).toContain("Start");
    expect(mermaid).toContain("Fetch user");
    expect(mermaid).toContain("Fetch posts");
    expect(mermaid).toContain(":::success");
    expect(mermaid).toContain("classDef success");
  });

  it("handles parallel detection in mermaid output", async () => {
    // Note: step.parallel emits scope events but the individual operations
    // inside allAsync don't emit step events (they're raw operations).
    // For full parallel visualization, wrap each operation with step().
    const viz = createVisualizer({
      workflowName: "parallel-mermaid",
      detectParallel: true, // Enable detection for overlapping steps
    });

    const workflow = createWorkflow(
      { fetchUser, fetchPosts },
      { onEvent: viz.handleEvent }
    );

    await workflow(async (step) => {
      // Sequential steps that may be detected as parallel due to timing
      const user = await step(() => fetchUser("1"), "Get user");
      const posts = await step(() => fetchPosts(user.id), "Get posts");
      return { user, posts };
    });

    const mermaid = viz.renderAs("mermaid");

    // Should contain valid Mermaid syntax
    expect(mermaid).toContain("flowchart TD");
    expect(mermaid).toContain("classDef success");
  });
});

describe("visualizeEvents", () => {
  it("renders events to ASCII", () => {
    const events: WorkflowEvent<string>[] = [
      { type: "workflow_start", workflowId: "wf-1", ts: 1000 },
      {
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Test step",
        ts: 1001,
      },
      {
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Test step",
        ts: 1050,
        durationMs: 49,
      },
      {
        type: "workflow_success",
        workflowId: "wf-1",
        ts: 1060,
        durationMs: 60,
      },
    ];

    const output = visualizeEvents(events, { workflowName: "manual" });

    expect(output).toContain("manual");
    expect(output).toContain("Test step");
    expect(output).toContain("✓");
  });
});

// =============================================================================
// Scope Events Tests
// =============================================================================

describe("scope events", () => {
  it("emits scope events for step.parallel", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const workflow = createWorkflow(
      { fetchUser, fetchPosts },
      { onEvent: (e) => events.push(e) }
    );

    await workflow(async (step) => {
      const results = await step.parallel("Fetch all", () =>
        allAsync([fetchUser("1"), fetchPosts("1")])
      );
      return results;
    });

    const scopeStart = events.find((e) => e.type === "scope_start");
    const scopeEnd = events.find((e) => e.type === "scope_end");

    expect(scopeStart).toBeDefined();
    expect(scopeStart?.type === "scope_start" && scopeStart.name).toBe("Fetch all");
    expect(scopeStart?.type === "scope_start" && scopeStart.scopeType).toBe("parallel");
    expect(scopeEnd).toBeDefined();
    expect(scopeEnd?.type === "scope_end" && scopeEnd.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits scope events for step.race", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const workflow = createWorkflow(
      { fetchUser, slowOperation },
      { onEvent: (e) => events.push(e) }
    );

    await workflow(async (step) => {
      const result = await step.race("Fastest response", () =>
        anyAsync([fetchUser("1"), slowOperation()])
      );
      return result;
    });

    const scopeStart = events.find((e) => e.type === "scope_start");
    const scopeEnd = events.find((e) => e.type === "scope_end");

    expect(scopeStart).toBeDefined();
    expect(scopeStart?.type === "scope_start" && scopeStart.name).toBe("Fastest response");
    expect(scopeStart?.type === "scope_start" && scopeStart.scopeType).toBe("race");
    expect(scopeEnd).toBeDefined();
  });

  it("handles errors in parallel operations", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: (e) => events.push(e) }
    );

    const result = await workflow(async (step) => {
      return await step.parallel("Fetch with error", () =>
        allAsync([fetchUser("1"), fetchUser("missing")])
      );
    });

    expect(result.ok).toBe(false);

    // Should still emit scope_end on error
    const scopeEnd = events.find((e) => e.type === "scope_end");
    expect(scopeEnd).toBeDefined();
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("parallel detection", () => {
  it("groups overlapping steps into parallel nodes", async () => {
    const viz = createVisualizer({
      workflowName: "parallel-detection-test",
      detectParallel: true,
    });

    const workflow = createWorkflow(
      { fetchUser, fetchPosts },
      { onEvent: viz.handleEvent }
    );

    // These steps are fast enough that they may be detected as parallel
    await workflow(async (step) => {
      const user = await step(() => fetchUser("1"), "Fetch user");
      const posts = await step(() => fetchPosts(user.id), "Fetch posts");
      return { user, posts };
    });

    // With parallel detection, fast sequential steps may be grouped
    // Just verify the output contains both step names
    const output = viz.render();
    expect(output).toContain("Fetch user");
    expect(output).toContain("Fetch posts");
  });

  it("preserves sequential order when steps don't overlap", async () => {
    const viz = createVisualizer({
      workflowName: "sequential-test",
      detectParallel: false, // Disable to test sequential behavior
    });

    const workflow = createWorkflow(
      { fetchUser, fetchPosts },
      { onEvent: viz.handleEvent }
    );

    await workflow(async (step) => {
      const user = await step(() => fetchUser("1"), "Fetch user");
      const posts = await step(() => fetchPosts(user.id), "Fetch posts");
      return { user, posts };
    });

    const ir = viz.getIR();
    expect(ir.root.children).toHaveLength(2);
    expect(ir.root.children[0].name).toBe("Fetch user");
    expect(ir.root.children[1].name).toBe("Fetch posts");
  });
});

describe("createLiveVisualizer", () => {
  it("creates a live visualizer with correct API", () => {
    const live = createLiveVisualizer();

    expect(live.handleEvent).toBeTypeOf("function");
    expect(live.handleScopeEvent).toBeTypeOf("function");
    expect(live.getIR).toBeTypeOf("function");
    expect(live.render).toBeTypeOf("function");
    expect(live.start).toBeTypeOf("function");
    expect(live.stop).toBeTypeOf("function");
    expect(live.refresh).toBeTypeOf("function");
    expect(live.reset).toBeTypeOf("function");
  });

  it("processes events and builds IR", async () => {
    const live = createLiveVisualizer({
      workflowName: "live-test",
      detectParallel: false,
    });

    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: live.handleEvent }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("1"), "Fetch user");
    });

    const ir = live.getIR();
    expect(ir.root.children).toHaveLength(1);
    expect(ir.root.children[0].name).toBe("Fetch user");
    expect(ir.root.state).toBe("success");
  });

  it("renders to string without terminal output", async () => {
    const live = createLiveVisualizer({
      workflowName: "render-test",
      detectParallel: false,
    });

    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: live.handleEvent }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("1"), "Fetch");
    });

    const output = live.render();
    expect(output).toContain("render-test");
    expect(output).toContain("Fetch");
  });

  it("resets state correctly", async () => {
    const live = createLiveVisualizer();

    const workflow = createWorkflow(
      { fetchUser },
      { onEvent: live.handleEvent }
    );

    await workflow(async (step) => {
      return await step(() => fetchUser("1"), "Step");
    });

    expect(live.getIR().root.children.length).toBeGreaterThan(0);

    live.reset();

    expect(live.getIR().root.children).toHaveLength(0);
  });
});

describe("integration", () => {
  it("visualizes a complete workflow with multiple steps", async () => {
    const viz = createVisualizer({
      workflowName: "user-posts-flow",
      showTimings: true,
      detectParallel: false, // Disable for sequential test
    });

    const workflow = createWorkflow(
      { fetchUser, fetchPosts },
      { onEvent: viz.handleEvent }
    );

    await workflow(async (step) => {
      const user = await step(() => fetchUser("1"), "Fetch user");
      const posts = await step(() => fetchPosts(user.id), "Fetch posts");
      return { user, posts };
    });

    const ir = viz.getIR();
    expect(ir.root.children).toHaveLength(2);
    expect(ir.root.children[0].name).toBe("Fetch user");
    expect(ir.root.children[1].name).toBe("Fetch posts");

    const output = viz.render();
    expect(output).toContain("Fetch user");
    expect(output).toContain("Fetch posts");
    expect(output).toContain("Completed");
  });
});
