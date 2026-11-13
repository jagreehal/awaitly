import { ok, err, type AsyncResult } from "awaitly";
import { createWorkflow } from "awaitly";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type User } from "../db/schema";

const validateEmail = async (
  email: string
): AsyncResult<string, { type: "INVALID_EMAIL" }> => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) ? ok(email) : err({ type: "INVALID_EMAIL" });
};

const checkDuplicate = async (
  email: string
): AsyncResult<void, { type: "EMAIL_EXISTS" }> => {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return existing.length > 0 ? err({ type: "EMAIL_EXISTS" }) : ok(undefined);
};

const createUser = async (
  email: string,
  password: string
): AsyncResult<User, { type: "DB_ERROR" }> => {
  try {
    const [inserted] = await db
      .insert(users)
      .values({ email, password })
      .returning();
    if (!inserted) return err({ type: "DB_ERROR" });
    return ok(inserted);
  } catch {
    return err({ type: "DB_ERROR" });
  }
};

const sendWelcome = async (
  email: string
): AsyncResult<void, { type: "EMAIL_FAILED" }> => {
  // Mock: no real email in playground (email kept for API shape)
  void email;
  return ok(undefined);
};

export const signupWorkflow = createWorkflow("signup", {
  validateEmail,
  checkDuplicate,
  createUser,
  sendWelcome,
});

export type SignupError =
  | { type: "INVALID_EMAIL" }
  | { type: "EMAIL_EXISTS" }
  | { type: "DB_ERROR" }
  | { type: "EMAIL_FAILED" };

export const signupErrorMessages: Record<SignupError["type"], string> = {
  INVALID_EMAIL: "Invalid email address",
  EMAIL_EXISTS: "Email already registered",
  DB_ERROR: "Failed to create account",
  EMAIL_FAILED: "Account created but welcome email failed",
};
