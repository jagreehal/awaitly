/**
 * Showcase: Saga workflow — createSagaWorkflow with compensating steps.
 * Renders as saga-step nodes with "(compensable)" and "(try)" in the diagram.
 */
import { ok, type AsyncResult } from "awaitly";
import { createSagaWorkflow } from "awaitly/workflow";

const reserve = async (id: string): AsyncResult<{ reservationId: string }, "UNAVAILABLE"> =>
  ok({ reservationId: "res_1" });
const release = async (reservationId: string): AsyncResult<void, "RELEASE_FAILED"> =>
  ok(undefined);
const charge = async (id: string, amount: number): AsyncResult<{ chargeId: string }, "CHARGE_FAILED"> =>
  ok({ chargeId: "ch_1" });
const notify = async (id: string): AsyncResult<void, "NOTIFY_FAILED"> => ok(undefined);

export const orderSaga = createSagaWorkflow("orderSaga", {
  reserve,
  release,
  charge,
  notify,
});

export async function runOrderSaga(orderId: string, amount: number) {
  return await orderSaga.run(async ({ step, deps }) => {
    const reservation = await step("Reserve", () => deps.reserve(orderId), {
      compensate: async (val) => {
        await deps.release(val.reservationId);
      },
    });

    const payment = await step(
      "Charge",
      () => deps.charge(orderId, amount),
      {
        compensate: async (_val) => {
          /* refund in real impl */
        },
      }
    );

    await step.try("Notify", () => deps.notify(orderId), {
      error: "NOTIFY_FAILED" as const,
    });

    return { reservation, payment };
  });
}
