/**
 * Showcase: step.dep() wrapper
 * Step is wrapped with step.dep('serviceName', operation).
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const fetchUser = async (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> => ok({ id });

export const depWorkflow = createWorkflow("depWorkflow", { fetchUser });

export async function runDep(userId: string) {
  return await depWorkflow.run(async ({ step, deps }) => {
    const user = await step(
      "getUser",
      step.dep("userService", () => deps.fetchUser(userId))
    );
    return user;
  });
}
