import { createSagaWorkflow } from "awaitly/workflow";

const saga = createSagaWorkflow({
  createOrder: async () => ({ id: "1" }),
  cancelOrder: async () => {},
});

async function run() {
  return await saga(async (sagaParam, deps) => {
    /**
     * Creates the order record in the database.
     */
    const order = await sagaParam.step(() => deps.createOrder(), {
      compensate: () => deps.cancelOrder(),
    });
    return order;
  });
}
