/**
 * Workflow exercising when/unless helper callbacks for static analysis
 */
import { createWorkflow } from "../../workflow";
import { ok, type AsyncResult } from "../../core";
import { when } from "../../conditional";

const fetchUser = async (
  id: string
): AsyncResult<{ id: string; isAdmin: boolean }, "NOT_FOUND"> => {
  return ok({ id, isAdmin: true });
};

const auditAdmin = async (
  _userId: string
): AsyncResult<{ audited: boolean }, "AUDIT_FAILED"> => {
  return ok({ audited: true });
};

export const conditionalHelperWorkflow = createWorkflow("conditionalHelperWorkflow", {
  fetchUser,
  auditAdmin,
});

export async function runConditionalHelperWorkflow(userId: string) {
  return await conditionalHelperWorkflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser(userId), {
      key: "user",
      name: "Fetch User",
    });

    await when(user.isAdmin, () =>
      step(() => deps.auditAdmin(user.id), {
        key: "audit",
        name: "Audit Admin",
      })
    );

    return user;
  });
}
