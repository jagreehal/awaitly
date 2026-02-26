/**
 * Showcase: step.try() and step.fromResult()
 * Renders as steps with "(Try)" and "(FromResult)" in the diagram.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const riskyOp = async (): AsyncResult<number, "RISKY_ERROR"> => ok(1);
const fetchResult = async (): AsyncResult<string, "FETCH_ERROR"> => ok("data");

export const tryWorkflow = createWorkflow("tryWorkflow", { riskyOp, fetchResult });

export async function runTry() {
  return await tryWorkflow.run(async ({ step, deps }) => {
    await step.try("attempt", () => deps.riskyOp(), { error: "RISKY_ERROR" as const });
    const data = await step.fromResult("load", () => deps.fetchResult(), { error: "FETCH_ERROR" as const });
    return data;
  });
}
