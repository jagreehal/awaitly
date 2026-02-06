/**
 * Workflow with an unused helper function inside the callback
 */
import { createWorkflow } from "../../workflow";
import { ok, type AsyncResult } from "../../core";

const fetchUser = async (
  id: string
): AsyncResult<{ id: string }, "NOT_FOUND"> => {
  return ok({ id });
};

export const unusedHelperWorkflow = createWorkflow("unusedHelperWorkflow", {
  fetchUser,
});

export async function runUnusedHelperWorkflow() {
  return await unusedHelperWorkflow(async (step, deps) => {
    const helper = () =>
      step(() => deps.fetchUser("123"), {
        key: "user",
        name: "Fetch User",
      });

    return helper;
  });
}
