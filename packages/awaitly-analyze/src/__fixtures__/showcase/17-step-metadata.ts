/**
 * Showcase: step metadata for architecture review and generated documentation.
 * Open "steps analyzed" to inspect ownership, effects, calls, and error policy.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

interface Payment {
  id: string;
}

type PaymentError = "CARD_DECLINED" | "GATEWAY_TIMEOUT";

const chargeCard = async (
  orderId: string,
  amount: number,
): AsyncResult<Payment, PaymentError> => ok({ id: `payment-${orderId}-${amount}` });

export const paymentWorkflow = createWorkflow("paymentWorkflow", { chargeCard });

export const result = await paymentWorkflow.run(async ({ step, deps }) => {
  return step("charge-card", () => deps.chargeCard("order-1", 99), {
    description: "Charge the saved card for this order",
    intent: "Collect payment before fulfillment starts",
    domain: "payments",
    owner: "checkout-team",
    tags: ["side-effect", "external-api", "pci"],
    stateChanges: ["order.paymentStatus -> PAID"],
    emits: ["PaymentCaptured"],
    calls: ["payment-gateway"],
    errors: ["CARD_DECLINED", "GATEWAY_TIMEOUT"],
    errorMeta: {
      CARD_DECLINED: {
        retryable: false,
        severity: "business",
        description: "The issuer declined the card",
      },
      GATEWAY_TIMEOUT: {
        retryable: true,
        severity: "infrastructure",
        description: "The payment gateway did not respond",
      },
    },
  });
});
