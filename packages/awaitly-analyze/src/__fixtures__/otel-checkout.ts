/**
 * A workflow both analyzed (MachineJSON) and run under OpenTelemetry, so the
 * spans of real runs can be checked against the states the analyzer draws.
 */
import { createWorkflow, ok, err } from "awaitly";

let busy = true;

const loadCart = async (cartId: string) => ok({ id: cartId, total: cartId === "big" ? 500 : 20 });
const reviewOrder = async (cartId: string) => ok({ cartId, approved: true });
const chargeCard = async (total: number) => {
  // The first charge hits a busy gateway, so one run retries.
  if (busy) {
    busy = false;
    return err({ type: "GATEWAY_BUSY" } as const);
  }
  return total > 400 ? err({ type: "CARD_DECLINED" } as const) : ok({ receipt: `r-${total}` });
};
const sendReceipt = async (receipt: string) => ok(receipt);

export const otelCheckout = createWorkflow("otelCheckout", { loadCart, reviewOrder, chargeCard, sendReceipt });

export function checkout(cartId: string) {
  return otelCheckout.run(async ({ step, deps }) => {
    const cart = await step("load-cart", () => deps.loadCart(cartId));
    if (step.if("needs-review", "total > 100", () => cart.total > 100)) {
      await step("review-order", () => deps.reviewOrder(cart.id));
    }
    const charge = await step("charge", () => deps.chargeCard(cart.total), {
      retry: { attempts: 2, initialDelay: 0 },
    });
    await step("send-receipt", () => deps.sendReceipt(charge.receipt));
    return charge;
  });
}
