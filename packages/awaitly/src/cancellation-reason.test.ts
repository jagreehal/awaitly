/**
 * What a cancelled workflow reports about why it stopped.
 *
 * Mutation testing left the reason extraction uncovered at all three of its
 * sites: mid-execution, on an AbortError raised inside a step, and after a
 * step that finished despite the abort. An operator cancelling a batch reads
 * that reason to tell a deliberate stop from a crash, and `lastStepKey` to
 * know where it got to.
 *
 * Cancellation arrives on `result.cause`, not `result.error`.
 */

import { describe, it, expect, vi } from "vitest";
import { createWorkflow } from "./workflow";
import { isWorkflowCancelled } from "./durable";
import { ok, type AsyncResult } from "./core";
import type { WorkflowCancelledError, WorkflowEvent } from "./workflow/types";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deps = {
  quick: async (): AsyncResult<string, never> => ok("done"),
  slow: async (): AsyncResult<string, never> => {
    await delay(120);
    return ok("slow");
  },
};

interface Cancelled {
  cause?: WorkflowCancelledError;
  events: WorkflowEvent<unknown>[];
  thirdRan: boolean;
}

/** Start a three-step workflow, abort it during the slow middle step. */
async function cancelDuring(reason?: unknown): Promise<Cancelled> {
  const controller = new AbortController();
  const events: WorkflowEvent<unknown>[] = [];
  const third = vi.fn(async (): AsyncResult<string, never> => ok("third"));

  const workflow = createWorkflow("batch", deps, {
    signal: controller.signal,
    onEvent: (e) => events.push(e),
  });

  const pending = workflow.run(async ({ step }) => {
    await step("first", () => deps.quick(), { key: "first" });
    await step("second", () => deps.slow(), { key: "second" });
    return step("third", () => third(), { key: "third" });
  });

  setTimeout(() => (reason === undefined ? controller.abort() : controller.abort(reason)), 10);
  const result = await pending;

  expect(result.ok).toBe(false);
  const cause = !result.ok && isWorkflowCancelled(result.cause) ? result.cause : undefined;
  return { cause, events, thirdRan: third.mock.calls.length > 0 };
}

describe("cancellation reason", () => {
  it("carries a string abort reason through to the cause", async () => {
    const { cause } = await cancelDuring("operator cancelled the batch");

    expect(cause).toBeDefined();
    expect(cause!.reason).toBe("operator cancelled the batch");
  });

  it("takes an Error abort reason's message", async () => {
    const { cause } = await cancelDuring(new Error("deploy started"));

    expect(cause!.reason).toBe("deploy started");
  });

  it("does not invent a reason from a value that is neither string nor Error", async () => {
    const { cause } = await cancelDuring({ code: 42 });

    expect(cause!.reason).toBeUndefined();
  });

  it("reports the last completed step so a resume knows where it stopped", async () => {
    const { cause } = await cancelDuring("stop");

    // The abort lands while "second" is in flight. Cancellation is checked
    // between steps, so "second" finishes and is reported; "third" never runs.
    expect(cause!.lastStepKey).toBe("second");
  });

  it("lets a step already in flight finish rather than tearing it down", async () => {
    const finished: string[] = [];
    const controller = new AbortController();
    const workflow = createWorkflow("batch", deps, { signal: controller.signal });

    const pending = workflow.run(async ({ step }) => {
      await step("submit", async () => {
        await delay(120);
        finished.push("submit");
        return ok("submitted");
      }, { key: "submit" });
      return step("next", () => deps.quick(), { key: "next" });
    });

    setTimeout(() => controller.abort("stop"), 10);
    await pending;

    // Aborting does not recall a payment that is already with the provider.
    // Callers who need that must pass the signal into the operation itself.
    expect(finished).toEqual(["submit"]);
  });

  it("emits a workflow_cancelled event carrying the same reason", async () => {
    const { events } = await cancelDuring("operator cancelled the batch");

    const event = events.find((e) => e.type === "workflow_cancelled") as
      | { reason?: string; lastStepKey?: string }
      | undefined;

    expect(event).toBeDefined();
    expect(event!.reason).toBe("operator cancelled the batch");
    expect(event!.lastStepKey).toBe("second");
  });

  it("stops running steps once the signal aborts", async () => {
    const { thirdRan } = await cancelDuring("stop");

    // A cancelled batch must not submit another payment.
    expect(thirdRan).toBe(false);
  });

  it("leaves a workflow that finished before the abort alone", async () => {
    const controller = new AbortController();
    const workflow = createWorkflow("batch", deps, { signal: controller.signal });

    const result = await workflow.run(async ({ step }) => step("only", () => deps.quick()));
    controller.abort("too late");

    expect(result.ok).toBe(true);
  });
});
