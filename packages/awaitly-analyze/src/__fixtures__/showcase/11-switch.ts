/**
 * Showcase: switch (expression) { case ... } with steps in branches.
 * Renders as a switch node with case labels.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const adminAction = async (): AsyncResult<void, "ADMIN_ERROR"> => ok(undefined);
const userAction = async (): AsyncResult<void, "USER_ERROR"> => ok(undefined);
const defaultAction = async (): AsyncResult<void, never> => ok(undefined);

export const switchWorkflow = createWorkflow("switchWorkflow", {
  adminAction,
  userAction,
  defaultAction,
});

export async function runSwitch(role: string) {
  return await switchWorkflow.run(async ({ step, deps }) => {
    switch (role) {
      case "admin":
        await step("admin", () => deps.adminAction(), { errors: ["ADMIN_ERROR"] });
        break;
      case "user":
        await step("user", () => deps.userAction(), { errors: ["USER_ERROR"] });
        break;
      default:
        await step("default", () => deps.defaultAction());
        break;
    }
    return role;
  });
}
