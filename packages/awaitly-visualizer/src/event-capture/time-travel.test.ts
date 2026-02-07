/**
 * Time-travel debugging tests.
 *
 * Concept: the controller records an IR snapshot after each workflow event.
 * After the run you do not re-execute the workflow; you navigate the recorded
 * snapshots. seek(n) shows the workflow state as it was right after the n-th
 * event; stepForward / stepBackward move one event at a time. So you can
 * "time-travel" to any point in the execution and inspect the diagram (or
 * feed that IR to a renderer) at that moment.
 */

import { describe, it, expect } from "vitest";
import { ok, type AsyncResult } from "awaitly/core";
import { createWorkflow } from "awaitly/workflow";
import { createTimeTravelController } from "../time-travel";

// Minimal two-step workflow so snapshot indices are easy to reason about
const stepA = async (): AsyncResult<{ id: string }, never> =>
  ok({ id: "a" });
const stepB = async (): AsyncResult<{ id: string }, never> =>
  ok({ id: "b" });

const deps = { stepA, stepB };

describe("event-capture: time-travel debugging", () => {
  it("records one snapshot per event and allows seeking", async () => {
    const tt = createTimeTravelController();

    const workflow = createWorkflow("timeTravelDemo", deps, {
      onEvent: tt.handleEvent,
    });

    await workflow(async (step, { stepA, stepB }) => {
      await step("stepA", () => stepA());
      await step("stepB", () => stepB());
      return "done";
    });

    const snapshots = tt.getSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);

    // First snapshot: right after workflow_start (no steps completed yet)
    const irAtStart = tt.seek(0);
    expect(irAtStart).toBeDefined();
    if (irAtStart) {
      expect(irAtStart.root.type).toBe("workflow");
      // At event 0 we have only processed workflow_start; no step children yet
      expect(irAtStart.root.children.length).toBe(0);
    }

    // Last snapshot: after workflow_success (all steps completed)
    const lastIndex = snapshots.length - 1;
    const irAtEnd = tt.seek(lastIndex);
    expect(irAtEnd).toBeDefined();
    if (irAtEnd) {
      expect(irAtEnd.root.state).toBe("success");
      expect(irAtEnd.root.children.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("stepForward and stepBackward move by one snapshot", async () => {
    const tt = createTimeTravelController();

    const workflow = createWorkflow("timeTravelDemo", deps, {
      onEvent: tt.handleEvent,
    });

    await workflow(async (step, { stepA, stepB }) => {
      await step("stepA", () => stepA());
      await step("stepB", () => stepB());
      return "done";
    });

    const snapshots = tt.getSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(2);

    tt.seek(0);
    const ir1 = tt.stepForward();
    expect(ir1).toBeDefined();
    expect(tt.getState().currentIndex).toBe(1);

    const irBack = tt.stepBackward();
    expect(irBack).toBeDefined();
    expect(tt.getState().currentIndex).toBe(0);
  });

  it("getCurrentIR returns the IR at the current snapshot index", async () => {
    const tt = createTimeTravelController();

    const workflow = createWorkflow("timeTravelDemo", deps, {
      onEvent: tt.handleEvent,
    });

    await workflow(async (step, { stepA, stepB }) => {
      await step("stepA", () => stepA());
      await step("stepB", () => stepB());
      return "done";
    });

    tt.seek(0);
    const ir0 = tt.getCurrentIR();
    expect(ir0.root.children.length).toBe(0);

    const lastIndex = tt.getSnapshots().length - 1;
    tt.seek(lastIndex);
    const irEnd = tt.getCurrentIR();
    expect(irEnd.root.state).toBe("success");
    expect(irEnd.root.children.length).toBeGreaterThanOrEqual(1);
  });
});
