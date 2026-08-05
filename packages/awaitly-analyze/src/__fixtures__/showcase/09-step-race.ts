/**
 * Showcase: step.race() — first to complete wins.
 * Renders as a Race fork with racer branches and Winner join.
 */
import { anyAsync, createWorkflow, ok, type AsyncResult } from "awaitly";

const cacheA = async (): AsyncResult<string, "MISS"> => ok("a");
const cacheB = async (): AsyncResult<string, "MISS"> => ok("b");

export const raceWorkflow = createWorkflow("raceWorkflow", { cacheA, cacheB });

export async function runRace() {
  return await raceWorkflow.run(async ({ step, deps }) => {
    const result = await step.race("cacheRace", () =>
      anyAsync([deps.cacheA(), deps.cacheB()])
    );
    return result;
  });
}
