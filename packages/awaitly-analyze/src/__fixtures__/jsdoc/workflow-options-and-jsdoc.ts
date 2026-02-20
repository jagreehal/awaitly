import { createWorkflow } from "awaitly/workflow";

/**
 * JSDoc description for the workflow.
 */
const workflow = createWorkflow(
  "workflow",
  {},
  { description: "Options description", markdown: "# Options markdown" }
);

async function run() {
  return await workflow.run(async (step) => {
    return await step(() => Promise.resolve("ok"));
  });
}
