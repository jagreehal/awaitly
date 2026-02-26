/**
 * Showcase: step.withFallback()
 * Renders as a step with "(Fallback)" in the diagram.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const fetchPrimary = async (): AsyncResult<string, "NOT_FOUND"> => ok("primary");
const fetchFallback = async (): AsyncResult<string, never> => ok("fallback");

export const fallbackWorkflow = createWorkflow("fallbackWorkflow", {
  fetchPrimary,
  fetchFallback,
});

export async function runFallback() {
  return await fallbackWorkflow.run(async ({ step, deps }) => {
    const result = await step.withFallback(
      "fetchWithFallback",
      () => deps.fetchPrimary(),
      { fallback: () => deps.fetchFallback() }
    );
    return result;
  });
}
