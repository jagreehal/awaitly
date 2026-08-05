import { createWorkflow } from "awaitly";

const workflow = createWorkflow("workflow", {});

async function run() {
  return await workflow.run(async (step) => {
    /**
     * Wait for processing to complete before continuing.
     */
    await step.sleep("wait", "5s");
    return "done";
  });
}
