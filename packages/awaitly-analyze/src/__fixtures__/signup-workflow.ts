import { ok, err, type AsyncResult } from "awaitly";
import { createWorkflow } from "awaitly/workflow";

type User = { id: string; email: string };
type CreateUserInput = { email: string; passwordHash: string };

const isValidEmail = (e: string) => e.includes("@");
const hash = async (s: string) => `hashed:${s}`;

const validateEmail = async (
  email: string
): AsyncResult<string, "INVALID_EMAIL"> =>
  isValidEmail(email) ? ok(email) : err("INVALID_EMAIL");

const findUser = async (
  email: string
): AsyncResult<User | null, "DB_ERROR"> =>
  email === "taken@example.com"
    ? ok({ id: "existing", email })
    : ok(null);

const checkNotTaken = async (
  user: User | null
): AsyncResult<void, "EMAIL_TAKEN"> =>
  user ? err("EMAIL_TAKEN") : ok();

const createUser = async (
  input: CreateUserInput
): AsyncResult<User, "DB_ERROR"> =>
  ok({ id: "new-user", email: input.email });

const sendWelcome = async (
  email: string
): AsyncResult<void, "EMAIL_SERVICE_DOWN"> => {
  void email;
  return ok();
};

export const signup = createWorkflow("signup", {
  validateEmail,
  findUser,
  checkNotTaken,
  createUser,
  sendWelcome,
});

export async function run(rawEmail: string, password: string) {
  return signup.run(async ({ step, deps }) => {
    const email = await step("validate", () => deps.validateEmail(rawEmail));
    const existing = await step("find", () => deps.findUser(email));
    await step("checkNotTaken", () => deps.checkNotTaken(existing));
    const user = await step("create", async () =>
      deps.createUser({ email, passwordHash: await hash(password) })
    );
    await step("welcome", () => deps.sendWelcome(email));
    return user;
  });
}
