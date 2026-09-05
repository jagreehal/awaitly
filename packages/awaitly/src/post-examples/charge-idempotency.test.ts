/**
 * Blog series: Code Is the Workflow
 * Post 3 — Steps Are Where Side Effects Live
 * https://arrangeactassert.com/posts/steps-are-where-side-effects-live/
 *
 * Runnable example: idempotent refund charge with retries at the step boundary.
 */
import { describe, it, expect, vi } from "vitest";
import { ok, err, type AsyncResult } from "../core";
import { createWorkflow } from "../workflow";
import { durable } from "../durable";
import type { SnapshotStore, WorkflowSnapshot } from "../persistence";

function createTestSnapshotStore(): SnapshotStore {
  const store = new Map<string, { snapshot: WorkflowSnapshot; updatedAt: Date }>();
  return {
    async save(id: string, snapshot: WorkflowSnapshot) {
      store.set(id, { snapshot, updatedAt: new Date() });
    },
    async load(id: string) {
      return store.get(id)?.snapshot ?? null;
    },
    async delete(id: string) {
      store.delete(id);
    },
    async list() {
      return [];
    },
    async close() {},
  };
}

type RefundCharge = { chargeId: string; amount: number };

describe("post-examples: charge idempotency (post 3)", () => {
  it("retries a flaky charge step and caches by idempotency key", async () => {
    let attempts = 0;
    const charge = vi.fn(async (): AsyncResult<RefundCharge, "REFUND_DECLINED"> => {
      attempts++;
      if (attempts < 3) return err("REFUND_DECLINED");
      return ok({ chargeId: "ch_exp-42", amount: 240 });
    });

    const workflow = createWorkflow("refund-charge", { charge });

    const result = await workflow.run(async ({ step, deps }) => {
      return await step.retry(
        "processRefund",
        () => deps.charge(),
        {
          attempts: 3,
          key: "charge:exp-42",
        }
      );
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.chargeId).toBe("ch_exp-42");
    }
    expect(attempts).toBe(3);
    expect(charge).toHaveBeenCalledTimes(3);
  });

  it("uses a stable key so a resumed run skips the charge", async () => {
    const store = createTestSnapshotStore();
    let chargeCalls = 0;
    const charge = async (): AsyncResult<RefundCharge, never> => {
      chargeCalls++;
      return ok({ chargeId: "ch_exp-99", amount: 120 });
    };

    const failAfterCharge = async (): AsyncResult<never, "NOTIFY_FAILED"> => {
      return err("NOTIFY_FAILED");
    };

    const workflowFn = async ({
      step,
      deps,
    }: {
      step: Parameters<Parameters<typeof durable.run>[1]>[0]["step"];
      deps: { charge: typeof charge; failAfterCharge: typeof failAfterCharge };
    }) => {
      const result = await step("processRefund", () => deps.charge());
      await step("notify", () => deps.failAfterCharge());
      return result;
    };

    const opts = { id: "refund-exp-99", store };

    const first = await durable.run(
      { charge, failAfterCharge },
      workflowFn,
      opts
    );
    expect(first.ok).toBe(false);
    expect(chargeCalls).toBe(1);

    const second = await durable.run(
      { charge, failAfterCharge },
      workflowFn,
      opts
    );
    expect(second.ok).toBe(false);
    expect(chargeCalls).toBe(1);
  });
});
