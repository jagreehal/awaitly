/**
 * Showcase: workflow ref — calling another workflow.
 * Renders as a workflow-ref node [[childWorkflow]].
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const enrich = async (id: string): AsyncResult<{ id: string; enriched: true }, "ENRICH_ERROR"> =>
  ok({ id, enriched: true });
const fetchUser = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id });

export const childWorkflow = createWorkflow("childWorkflow", { enrich });
export const parentWorkflow = createWorkflow("parentWorkflow", { fetchUser });

export async function runParent(userId: string) {
  return await parentWorkflow.run(async ({ step, deps }) => {
    const user = await step("getUser", () => deps.fetchUser(userId), { errors: ["NOT_FOUND"] });
    const enriched = await childWorkflow.run(async ({ step: s, deps: d }) => {
      return await s("enrich", () => d.enrich(user.id), { errors: ["ENRICH_ERROR"] });
    });
    return { user, enriched };
  });
}
