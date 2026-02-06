/**
 * Authentication workflow - called by other workflows
 */
import { createWorkflow } from "../../workflow";
import { ok, type AsyncResult } from "../../core";

const validateToken = async (
  _token: string
): AsyncResult<{ userId: string; valid: boolean }, "INVALID_TOKEN"> => {
  return ok({ userId: "123", valid: true });
};

const refreshToken = async (
  _token: string
): AsyncResult<{ newToken: string }, "REFRESH_FAILED"> => {
  return ok({ newToken: "new-token" });
};

export const authWorkflow = createWorkflow("authWorkflow", {
  validateToken,
  refreshToken,
});

export async function runAuthWorkflow(token: string) {
  return await authWorkflow(async (step, deps) => {
    const validation = await step(() => deps.validateToken(token), {
      key: "validate",
      name: "Validate Token",
    });

    if (!validation.valid) {
      const refreshed = await step(() => deps.refreshToken(token), {
        key: "refresh",
        name: "Refresh Token",
      });
      return { authenticated: true, token: refreshed.newToken };
    }

    return { authenticated: true, token };
  });
}
