/**
 * Blog series: Code Is the Workflow
 * Post 6 — Waiting for Humans, Webhooks, and the Outside World
 * https://arrangeactassert.com/posts/waiting-for-humans-webhooks-and-the-outside-world/
 *
 * Runnable example: park on manager approval via hook, resume on callback.
 */
import { describe, it, expect } from "vitest";
import { ok, type AsyncResult } from "../core";
import {
  createWorkflow,
  createResumeStateCollector,
  createHook,
  pendingHook,
  injectHook,
  isPendingHook,
} from "../workflow";

async function calculateRefund(
  expenseId: string
): AsyncResult<{ amount: number }, never> {
  return ok({ amount: expenseId === "exp-42" ? 240 : 0 });
}

describe("post-examples: approval hook (post 6)", () => {
  it("parks until injectHook supplies manager approval", async () => {
    const { hookId, stepKey } = createHook();
    const collector = createResumeStateCollector();

    const workflow = createWorkflow(
      "refund-approval",
      {
        calculateRefund,
        waitForApproval: async () => pendingHook(hookId),
      },
      { onEvent: collector.handleEvent }
    );

    const run1 = await workflow.run(async ({ step, deps }) => {
      const refund = await step("calculate", () =>
        deps.calculateRefund("exp-42")
      );
      const approval = await step("approve", () => deps.waitForApproval(), {
        key: stepKey,
      });
      return { refund, approval };
    });

    expect(run1.ok).toBe(false);
    if (!run1.ok) {
      expect(isPendingHook(run1.error)).toBe(true);
    }

    const state = injectHook(collector.getResumeState(), {
      hookId,
      value: { approved: true, managerId: "mgr-7" },
    });

    const workflow2 = createWorkflow(
      "refund-approval",
      {
        calculateRefund,
        waitForApproval: async () => pendingHook(hookId),
      },
      { resumeState: state }
    );

    const run2 = await workflow2.run(async ({ step, deps }) => {
      const refund = await step("calculate", () =>
        deps.calculateRefund("exp-42")
      );
      const approval = await step("approve", () => deps.waitForApproval(), {
        key: stepKey,
      });
      return { refund, approval };
    });

    expect(run2.ok).toBe(true);
    if (run2.ok) {
      expect(run2.value.approval).toEqual({
        approved: true,
        managerId: "mgr-7",
      });
    }
  });
});
