/**
 * Showcase: step.sleep()
 * Renders as a step node with "(Sleep: 5s)" in the diagram.
 */
import { createWorkflow } from "awaitly";

export const sleepWorkflow = createWorkflow("sleepWorkflow", {});

export async function runSleep() {
  return await sleepWorkflow.run(async ({ step }) => {
    await step.sleep("pause", "5s");
    await step.sleep("longPause", "1h");
    return "done";
  });
}
