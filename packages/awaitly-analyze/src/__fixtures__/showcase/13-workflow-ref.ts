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

// The child is a dep of the parent. Deps are what determine the error union, so
// ENRICH_ERROR joins the parent's errors with no cast and no type argument — and
// the step below unwraps to Enriched rather than a nested Result.
export const parentWorkflow = createWorkflow("parentWorkflow", {
  fetchUser,
  enrichUser: (id: string) =>
    childWorkflow.run(async ({ step, deps }) => step("enrich", () => deps.enrich(id))),
});

export async function runParent(userId: string) {
  return await parentWorkflow.run(async ({ step, deps }) => {
    const user = await step("getUser", () => deps.fetchUser(userId));
    const enriched = await step("callChild", () => deps.enrichUser(user.id));
    return { user, enriched };
  });
}
