/**
 * Kitchen-sink saga fixture for static analysis integration testing.
 *
 * Exercises saga-specific patterns:
 * - createSagaWorkflow with multiple deps
 * - saga.step() with compensation
 * - saga.tryStep()
 * - Destructured { step, tryStep } form
 */
import { ok, type AsyncResult } from "awaitly";
import { createSagaWorkflow } from "awaitly/saga";

// ---------------------------------------------------------------------------
// Dependencies (all must return Result for createSagaWorkflow)
// ---------------------------------------------------------------------------

const createOrder = async (
  _cartId: string
): AsyncResult<{ orderId: string }, "ORDER_FAILED"> => {
  return ok({ orderId: "ord_1" });
};

const cancelOrder = async (
  _orderId: string
): AsyncResult<void, "CANCEL_FAILED"> => {
  return ok(undefined);
};

const chargePayment = async (
  _orderId: string,
  _amount: number
): AsyncResult<{ chargeId: string }, "CHARGE_FAILED"> => {
  return ok({ chargeId: "ch_1" });
};

const refundPayment = async (
  _chargeId: string
): AsyncResult<void, "REFUND_FAILED"> => {
  return ok(undefined);
};

const reserveInventory = async (
  _orderId: string
): AsyncResult<{ reservationId: string }, "INVENTORY_UNAVAILABLE"> => {
  return ok({ reservationId: "res_1" });
};

const releaseInventory = async (
  _reservationId: string
): AsyncResult<void, "RELEASE_FAILED"> => {
  return ok(undefined);
};

const sendNotification = async (
  _orderId: string
): AsyncResult<void, "ORDER_FAILED"> => {
  return ok(undefined);
};

// ---------------------------------------------------------------------------
// Canonical form: workflow.run() with compensating steps
// ---------------------------------------------------------------------------

export const orderSaga = createSagaWorkflow("orderSaga", {
  createOrder,
  cancelOrder,
  chargePayment,
  refundPayment,
  reserveInventory,
  releaseInventory,
  sendNotification,
});

export async function placeOrder(cartId: string, amount: number) {
  return await orderSaga.run(async ({ step, deps }) => {
    // step with compensation (compensation returns void)
    const order = await step("Create Order", () => deps.createOrder(cartId), {
      compensate: async (val) => { await deps.cancelOrder(val.orderId); },
    });

    // step with compensation
    const charge = await step(
      "Charge Payment",
      () => deps.chargePayment(order.orderId, amount),
      {
        compensate: async (val) => { await deps.refundPayment(val.chargeId); },
      }
    );

    // step with compensation
    const reservation = await step(
      "Reserve Inventory",
      () => deps.reserveInventory(order.orderId),
      {
        compensate: async (val) => { await deps.releaseInventory(val.reservationId); },
      }
    );

    // step.try (error-mapped)
    await step.try("Send Notification", () => {
      return sendNotification(order.orderId);
    }, { error: "ORDER_FAILED" as const });

    return { order, charge, reservation };
  });
}

// ---------------------------------------------------------------------------
// Destructured form: { step, try } = workflow context
// ---------------------------------------------------------------------------

export const orderSagaDestructured = createSagaWorkflow("orderSagaDestructured", {
  createOrder,
  cancelOrder,
  chargePayment,
  refundPayment,
});

export async function placeOrderDestructured(cartId: string, amount: number) {
  return await orderSagaDestructured.run(async ({ step, deps }) => {

    const order = await step("Create Order", () => deps.createOrder(cartId), {
      compensate: async (val) => { await deps.cancelOrder(val.orderId); },
    });

    await step.try("Charge Payment", () => {
      return chargePayment(order.orderId, amount);
    }, { error: "CHARGE_FAILED" as const });

    return order;
  });
}
