/**
 * Showcase: workflow ref — calling another workflow.
 * Renders as a workflow-ref node [[childWorkflow]].
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

/** User shape returned by fetchUser step */
interface User {
  id: string;
}

/** Enriched shape returned by child workflow */
interface Enriched {
  id: string;
  enriched: true;
}

const enrich = async (id: string): AsyncResult<Enriched, "ENRICH_ERROR"> =>
  ok({ id, enriched: true });
const fetchUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => ok({ id });

export const childWorkflow = createWorkflow("childWorkflow", { enrich });
export const parentWorkflow = createWorkflow("parentWorkflow", { fetchUser });

export async function runParent(userId: string): Promise<{ user: User; enriched: Enriched }> {
  return await parentWorkflow.run(
    async ({ step, deps }): Promise<{ user: User; enriched: Enriched }> => {
      const user = await step("getUser", () => deps.fetchUser(userId), { errors: ["NOT_FOUND"] });
      const enriched = await childWorkflow.run(async ({ step: s, deps: d }) => {
        return await s("enrich", () => d.enrich(user.id), { errors: ["ENRICH_ERROR"] });
      });
      return { user, enriched };
    }
  );
}
