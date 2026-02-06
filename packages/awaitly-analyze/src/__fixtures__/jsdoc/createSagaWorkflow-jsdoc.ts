import { createSagaWorkflow } from "awaitly/workflow";

/**
 * Order saga - create order with compensation.
 */
const orderSaga = createSagaWorkflow("orderSaga", {
  createOrder: async () => ({ id: "1" }),
  cancelOrder: async () => {},
});

async function run() {
  return await orderSaga(async (s, deps) => {
    const order = await s.step(() => deps.createOrder(), {
      compensate: () => deps.cancelOrder(),
    });
    return order;
  });
}
