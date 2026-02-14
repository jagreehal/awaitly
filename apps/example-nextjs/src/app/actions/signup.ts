"use server";

import {
  signupWorkflow,
  signupErrorMessages,
  type SignupError,
} from "../../lib/workflows/signup";

export type SignupActionResult =
  | { success: true; userId: number }
  | { success: false; error: string };

export async function signup(
  email: string,
  password: string
): Promise<SignupActionResult> {
  const result = await signupWorkflow(async ({ step, deps }) => {
    const validEmail = await step("validateEmail", () =>
      deps.validateEmail(email)
    );
    await step("checkDuplicate", () => deps.checkDuplicate(validEmail));
    const user = await step("createUser", () =>
      deps.createUser(validEmail, password)
    );
    await step("sendWelcome", () => deps.sendWelcome(user.email));
    return { userId: user.id };
  });

  if (result.ok) {
    return { success: true, userId: result.value.userId };
  }

  const message =
    signupErrorMessages[result.error as SignupError] ?? "Something went wrong";
  return { success: false, error: message };
}
