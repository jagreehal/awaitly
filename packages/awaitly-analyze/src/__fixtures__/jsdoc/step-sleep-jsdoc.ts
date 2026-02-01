import { createWorkflow } from "awaitly/workflow";

const workflow = createWorkflow({});

async function run() {
  return await workflow(async (step) => {
    /**
     * Wait for processing to complete before continuing.
     */
    await step.sleep("5s");
    return "done";
  });
}
