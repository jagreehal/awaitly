import { createWorkflow } from "awaitly/workflow";

/**
 * Line one.
 * Line two.
 * Line three.
 */
const workflow = createWorkflow("workflow", {});

async function run() {
  return await workflow.run(async (step) => {
    /**
     * Step line one.
     * Step line two.
     */
    return await step(() => Promise.resolve("ok"));
  });
}
