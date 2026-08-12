/**
 * Showcase: the static workflow remains visible when a recorded run aborts.
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

type Profile = { email: string };

const loadProfile = async (): AsyncResult<Profile, "PROFILE_FAILED"> =>
  ok({ email: "alice@example.com" });
const sendEmail = async (_email: string): AsyncResult<"sent", "EMAIL_FAILED"> =>
  ok("sent");

export function notifyUser(signal: AbortSignal) {
  const notify = createWorkflow(
    "notifyUser",
    { loadProfile, sendEmail },
    { signal },
  );

  return notify.run(async ({ step, deps }) => {
    const profile = await step("loadProfile", () => deps.loadProfile());
    await step("sendEmail", () => deps.sendEmail(profile.email));
    return profile;
  });
}
