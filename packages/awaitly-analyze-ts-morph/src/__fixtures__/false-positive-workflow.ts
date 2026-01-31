/**
 * Workflow with helpers whose names include "parallel", "race", or "withTimeout".
 * These are NOT step.parallel/race/withTimeout calls and should be ignored by the analyzer.
 */
import { createWorkflow } from "../../workflow";
import { ok, type AsyncResult } from "../../core";

const fetchUser = async (
  id: string
): AsyncResult<{ id: string }, "NOT_FOUND"> => {
  return ok({ id });
};

const parallelFetch = async (
  _id: string
): AsyncResult<{ ok: boolean }, "FETCH_ERROR"> => {
  return ok({ ok: true });
};

const raceConditionCheck = async (): AsyncResult<boolean, "CHECK_ERROR"> => {
  return ok(true);
};

const withTimeoutHelper = async (): AsyncResult<string, "TIMEOUT"> => {
  return ok("ok");
};

export const falsePositiveWorkflow = createWorkflow({
  fetchUser,
  parallelFetch,
  raceConditionCheck,
  withTimeoutHelper,
});

export async function runFalsePositiveWorkflow(userId: string) {
  return await falsePositiveWorkflow(async (step, deps) => {
    const user = await step(() => deps.fetchUser(userId));

    await deps.parallelFetch(user.id);
    await deps.raceConditionCheck();
    await deps.withTimeoutHelper();

    return user;
  });
}
