/**
 * Showcase: for, while, for-of, for-in loops with steps inside.
 * Renders as loop nodes (for, for-of, for-in, while).
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const processItem = async (id: string): AsyncResult<void, "PROCESS_ERROR"> => ok(undefined);

export const loopWorkflow = createWorkflow("loopWorkflow", { processItem });

export async function runLoops() {
  return await loopWorkflow.run(async ({ step, deps }) => {
    for (let i = 0; i < 3; i++) {
      await step("forStep", () => deps.processItem(String(i)), { errors: ["PROCESS_ERROR"] });
    }
    const items = ["a", "b"];
    for (const item of items) {
      await step("forOfStep", () => deps.processItem(item), { errors: ["PROCESS_ERROR"] });
    }
    const obj = { x: 1 };
    for (const key in obj) {
      await step("forInStep", () => deps.processItem(key), { errors: ["PROCESS_ERROR"] });
    }
    let n = 0;
    while (n < 2) {
      await step("whileStep", () => deps.processItem(String(n)), { errors: ["PROCESS_ERROR"] });
      n++;
    }
    return "done";
  });
}
