/**
 * Showcase: step.withResource()
 * Renders as a step with "(Resource)" in the diagram.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const acquire = async (): AsyncResult<{ id: string }, "ACQUIRE_ERROR"> => ok({ id: "conn-1" });
const useResource = async (_r: { id: string }): AsyncResult<string, "USE_ERROR"> => ok("result");

export const resourceWorkflow = createWorkflow("resourceWorkflow", { acquire, useResource });

export async function runResource() {
  return await resourceWorkflow.run(async ({ step, deps }) => {
    const result = await step.withResource("useConn", {
      acquire: () => deps.acquire(),
      use: (r) => deps.useResource(r),
      release: () => {},
    });
    return result;
  });
}
