/**
 * Showcase: step.withTimeout()
 * Renders as a step with "(Timeout: 5000ms)" in the diagram.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const slowOp = async (): AsyncResult<number, "TIMEOUT"> => ok(42);

export const timeoutWorkflow = createWorkflow("timeoutWorkflow", { slowOp });

export async function runTimeout() {
  return await timeoutWorkflow.run(async ({ step, deps }) => {
    const result = await step.withTimeout("slowCall", () => deps.slowOp(), { ms: 5000 });
    return result;
  });
}
