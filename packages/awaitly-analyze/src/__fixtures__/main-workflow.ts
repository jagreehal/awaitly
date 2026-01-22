/**
 * Main workflow that composes other workflows
 */
import { createWorkflow } from "../../workflow";
import { ok, type AsyncResult } from "../../core";
import { authWorkflow } from "./auth-workflow";

const fetchUserData = async (
  _userId: string
): AsyncResult<{ name: string; email: string }, "USER_NOT_FOUND"> => {
  return ok({ name: "Alice", email: "alice@example.com" });
};

const sendNotification = async (
  _userId: string,
  _message: string
): AsyncResult<{ sent: boolean }, "SEND_FAILED"> => {
  return ok({ sent: true });
};

export const mainWorkflow = createWorkflow({
  fetchUserData,
  sendNotification,
});

export async function runMainWorkflow(token: string) {
  return await mainWorkflow(async (step, deps) => {
    // Step 1: Authenticate using auth workflow
    const auth = await authWorkflow(async (authStep, authDeps) => {
      const validation = await authStep(() => authDeps.validateToken(token), {
        key: "auth-validate",
      });
      return validation;
    });

    if (!auth.ok) {
      return auth;
    }

    // Step 2: Fetch user data
    const userData = await step(() => deps.fetchUserData(auth.value.userId), {
      key: "user-data",
      name: "Fetch User Data",
    });

    // Step 3: Send welcome notification
    await step(() => deps.sendNotification(auth.value.userId, "Welcome!"), {
      key: "notify",
      name: "Send Notification",
    });

    return { user: userData, authenticated: true };
  });
}
