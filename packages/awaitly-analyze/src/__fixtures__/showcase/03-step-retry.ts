/**
 * Showcase: step.retry()
 * Renders as a step with "(Retry: 3)" in the diagram.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const fetchData = async (): AsyncResult<{ data: string }, "NETWORK_ERROR"> => ok({ data: "ok" });

export const retryWorkflow = createWorkflow("retryWorkflow", { fetchData });

export async function runRetry() {
  return await retryWorkflow.run(async ({ step, deps }) => {
    const result = await step.retry("fetch", () => deps.fetchData(), {
      attempts: 3,
      backoff: "exponential",
    });
    return result;
  });
}
