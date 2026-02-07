import { createWorkflow } from "awaitly/workflow";

/**
 * Checkout workflow - handles cart and payment.
 */
const checkoutWorkflow = createWorkflow("checkoutWorkflow", {});

async function run() {
  return await checkoutWorkflow(async (step) => {
    return await step(() => Promise.resolve("ok"));
  });
}
