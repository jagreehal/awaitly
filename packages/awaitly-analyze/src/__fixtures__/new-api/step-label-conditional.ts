/**
 * Test fixture: step.label() for labelled conditionals
 *
 * step.label() is an alias for step.if() - both create DecisionNode in analyzer.
 * This test verifies that step.label() is recognized the same as step.if().
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const processOrder = async (
  orderId: string
): AsyncResult<{ orderId: string; total: number }, "ORDER_NOT_FOUND"> => {
  return ok({ orderId, total: 100 });
};

const applyDiscount = async (
  orderId: string,
  discount: number
): AsyncResult<{ orderId: string; discount: number }, "DISCOUNT_ERROR"> => {
  return ok({ orderId, discount });
};

const processStandardOrder = async (
  orderId: string
): AsyncResult<{ orderId: string; type: "standard" }, "PROCESS_ERROR"> => {
  return ok({ orderId, type: "standard" });
};

export const orderWorkflow = createWorkflow("orderWorkflow", {
  processOrder,
  applyDiscount,
  processStandardOrder,
});

export async function processOrderWithDiscount(orderId: string, hasDiscount: boolean) {
  return await orderWorkflow(async (step, deps) => {
    const order = await step('getOrder', () => deps.processOrder(orderId), {
      errors: ['ORDER_NOT_FOUND'],
      out: 'order',
    });

    // Labelled conditional using step.label() (alias for step.if())
    if (step.label('discount-check', 'hasDiscount', () => hasDiscount)) {
      const result = await step('applyDiscount', () => deps.applyDiscount(order.orderId, 10), {
        errors: ['DISCOUNT_ERROR'],
      });
      return { order, discount: result };
    } else {
      const result = await step('processStandard', () => deps.processStandardOrder(order.orderId), {
        errors: ['PROCESS_ERROR'],
      });
      return { order, result };
    }
  });
}
