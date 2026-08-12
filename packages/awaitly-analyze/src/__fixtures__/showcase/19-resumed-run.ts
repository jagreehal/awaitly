/**
 * Showcase: completed keyed steps become cache hits after loading resume state.
 */
import {
  createWorkflow,
  ok,
  type AsyncResult,
  type ResumeState,
} from "awaitly";

const reserveStock = async (): AsyncResult<{ id: string }, "OUT_OF_STOCK"> =>
  ok({ id: "res_1" });
const charge = async (): AsyncResult<{ id: string }, "PAYMENT_FAILED"> =>
  ok({ id: "pay_1" });

const checkout = createWorkflow("resumeCheckout", { reserveStock, charge });

export function resumeCheckout(resumeState: ResumeState) {
  return checkout.run(
    async ({ step, deps }) => {
      const reservation = await step(
        "reserveStock",
        () => deps.reserveStock(),
        { key: "reservation" },
      );
      const payment = await step("charge", () => deps.charge(), {
        key: "payment",
      });
      return { reservation, payment };
    },
    { resumeState },
  );
}
