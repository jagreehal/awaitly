import { createWorkflow } from "awaitly/workflow";

const workflow = createWorkflow("workflow", {});

async function run() {
  return await workflow(async (step) => {
    /**
     * Wait for processing to complete before continuing.
     */
    await step.sleep("wait", "5s");
    return "done";
  });
}
