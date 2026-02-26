/**
 * Showcase: complex — parallel inside conditional, step.if, step.parallel, step.forEach.
 * Renders as nested subgraphs and decision nodes.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const fetchA = async (): AsyncResult<string, "ERR"> => ok("a");
const fetchB = async (): AsyncResult<string, "ERR"> => ok("b");
const processItem = async (x: string): AsyncResult<string, "ERR"> => ok(x);

export const complexWorkflow = createWorkflow("complexWorkflow", { fetchA, fetchB, processItem });

export async function runComplex(doParallel: boolean, items: string[]) {
  return await complexWorkflow.run(async ({ step, deps }) => {
    if (step.if("choice", "doParallel", () => doParallel)) {
      const { a, b } = await step.parallel("fetchBoth", {
        a: () => deps.fetchA(),
        b: () => deps.fetchB(),
      });
      await step.forEach("processAll", items, {
        run: (item) => deps.processItem(item),
      });
      return { a, b };
    } else {
      const a = await step("fetchAOnly", () => deps.fetchA(), { errors: ["ERR"] });
      return { a };
    }
  });
}
