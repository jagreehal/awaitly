/**
 * The function deployed for the AWS end-to-end suite, written as a native
 * durable function. The event picks the scenario, which keeps each execution
 * deterministic.
 */
import { err, ok, type AsyncResult } from "awaitly";
import { withDurableExecution, type RetryDecision } from "../src/index";

type User = { id: string; name: string };

export type E2eEvent =
  | { scenario: "checkout"; userId: string }
  | { scenario: "approval"; userId: string }
  | { scenario: "alwaysThrows" };

const getUser = async (id: string): AsyncResult<User, "NOT_FOUND"> =>
  id === "missing" ? err("NOT_FOUND") : ok({ id, name: "Ada" });

const charge = async (user: User): AsyncResult<{ receipt: string }, "DECLINED"> =>
  user.id === "broke" ? err("DECLINED") : ok({ receipt: `r-${user.id}` });

// Two attempts, one second apart, so the retry scenario finishes in seconds.
const twoAttempts = (_error: Error, attempt: number): RetryDecision =>
  attempt < 2 ? { shouldRetry: true, delay: { seconds: 1 } } : { shouldRetry: false };

export const handler = withDurableExecution(async (event: E2eEvent, context) => {
  switch (event.scenario) {
    case "checkout": {
      const user = await context.step("getUser", () => getUser(event.userId));
      if (!user.ok) return user;
      await context.wait("coolingOff", { seconds: 3 });
      return context.step("charge", () => charge(user.value));
    }
    case "approval": {
      const user = await context.step("getUser", () => getUser(event.userId));
      if (!user.ok) return user;
      await context.waitForCallback("approve", async () => {}, { timeout: { minutes: 10 } });
      return context.step("charge", () => charge(user.value));
    }
    case "alwaysThrows":
      return context.step(
        "callApi",
        async (): AsyncResult<{ receipt: string }, never> => {
          throw new Error("ECONNRESET");
        },
        { retryStrategy: twoAttempts }
      );
  }
});
