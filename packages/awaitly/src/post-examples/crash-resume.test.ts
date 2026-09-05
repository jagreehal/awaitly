/**
 * Blog series: Code Is the Workflow
 * Post 5 — What Happens When the Process Dies
 * https://arrangeactassert.com/posts/what-happens-when-the-process-dies/
 *
 * Runnable example: crash after charge, resume without double-charging.
 */
import { describe, it, expect } from "vitest";
import { ok, err, type AsyncResult } from "../core";
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

type Charge = { chargeId: string };

describe("post-examples: crash resume (post 5)", () => {
  it("skips a completed charge step on resume after crash", async () => {
    const store = createTestSnapshotStore();
    const id = "refund-exp-42";
    let chargeCalls = 0;
    let notifyCalls = 0;

    const processRefund = async (): AsyncResult<Charge, never> => {
      chargeCalls++;
      return ok({ chargeId: "ch_exp-42" });
    };

    const notifyEmployee = async (): AsyncResult<never, "NOTIFY_FAILED"> => {
      notifyCalls++;
      return err("NOTIFY_FAILED");
    };

    const workflowFn = async ({
      step,
      deps,
    }: {
      step: Parameters<Parameters<typeof durable.run>[1]>[0]["step"];
      deps: { processRefund: typeof processRefund; notifyEmployee: typeof notifyEmployee };
    }) => {
      const charge = await step("processRefund", () => deps.processRefund());
      await step("notify", () => deps.notifyEmployee());
      return charge;
    };

    const run1 = await durable.run(
      { processRefund, notifyEmployee },
      workflowFn,
      { id, store }
    );
    expect(run1.ok).toBe(false);
    expect(chargeCalls).toBe(1);
    expect(notifyCalls).toBe(1);
    expect(await durable.hasState(store, id)).toBe(true);

    const run2 = await durable.run(
      { processRefund, notifyEmployee },
      workflowFn,
      { id, store }
    );

    expect(run2.ok).toBe(false);
    expect(chargeCalls).toBe(1);
    expect(notifyCalls).toBe(1);
  });
});
