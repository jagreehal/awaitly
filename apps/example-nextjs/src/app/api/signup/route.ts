import { NextRequest, NextResponse } from "next/server";
import {
  signupWorkflow,
  signupErrorMessages,
  type SignupError,
} from "../../../lib/workflows/signup";

const errorMap: Record<
  SignupError,
  { status: number; message: string }
> = {
  INVALID_EMAIL: { status: 400, message: signupErrorMessages.INVALID_EMAIL },
  EMAIL_EXISTS: { status: 409, message: signupErrorMessages.EMAIL_EXISTS },
  DB_ERROR: { status: 500, message: signupErrorMessages.DB_ERROR },
  EMAIL_FAILED: { status: 500, message: signupErrorMessages.EMAIL_FAILED },
};

export async function POST(req: NextRequest) {
  const { email, password } = (await req.json()) as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password required" },
      { status: 400 }
    );
  }

  const result = await signupWorkflow(async (step, deps) => {
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
    return NextResponse.json(
      { userId: result.value.userId },
      { status: 201 }
    );
  }

  const errorInfo =
    errorMap[result.error as SignupError] ?? {
      status: 500,
      message: "Unknown error",
    };
  return NextResponse.json(
    { error: errorInfo.message },
    { status: errorInfo.status }
  );
}
