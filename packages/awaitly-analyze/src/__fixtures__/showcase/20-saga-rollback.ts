/**
 * Showcase: each failure point enters a LIFO rollback path, and an undo can fail.
 */
import { err, ok, type AsyncResult } from "awaitly";
import { createSagaWorkflow } from "awaitly/durable";

const charge = async (): AsyncResult<{ id: string }, "DECLINED"> =>
  ok({ id: "pay_1" });
const refund = async (_id: string): AsyncResult<void, "REFUND_FAILED"> =>
  err("REFUND_FAILED");
const reserve = async (): AsyncResult<{ id: string }, "OUT_OF_STOCK"> =>
  ok({ id: "res_1" });
const release = async (_id: string): AsyncResult<void, "RELEASE_FAILED"> =>
  ok(undefined);
const ship = async (): AsyncResult<never, "SHIPMENT_FAILED"> =>
  err("SHIPMENT_FAILED");

const checkout = createSagaWorkflow("rollbackCheckout", {
  charge,
  refund,
  reserve,
  release,
  ship,
});

export function runCheckout() {
  return checkout.run(async ({ step, deps }) => {
    const payment = await step("charge", () => deps.charge(), {
      compensate: async (value) => {
        const result = await deps.refund(value.id);
        if (!result.ok) throw new Error(result.error);
      },
    });
    const stock = await step("reserve", () => deps.reserve(), {
      compensate: async (value) => {
        await deps.release(value.id);
      },
    });
    await step("ship", () => deps.ship());
    return { payment, stock };
  });
}
