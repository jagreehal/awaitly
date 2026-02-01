import { createWorkflow } from "awaitly/workflow";

/**
 * JSDoc description for the workflow.
 */
const workflow = createWorkflow(
  {},
  { description: "Options description", markdown: "# Options markdown" }
);

async function run() {
  return await workflow(async (step) => {
    return await step(() => Promise.resolve("ok"));
  });
}
