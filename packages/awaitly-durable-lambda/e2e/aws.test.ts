/**
 * End-to-end against real AWS Lambda durable functions.
 *
 *   AWS_PROFILE=my-profile AWS_REGION=eu-north-1 pnpm aws:deploy
 *   AWS_PROFILE=my-profile AWS_REGION=eu-north-1 pnpm test:aws
 *   AWS_PROFILE=my-profile AWS_REGION=eu-north-1 pnpm aws:destroy
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { InvocationType, LambdaClient } from "@aws-sdk/client-lambda";
import { CloudDurableTestRunner, WaitingOperationStatus } from "../src/testing";
import { deployedFile, type Deployed } from "./aws";
import { durableFunction } from "../src/index";
import type { handler, E2eEvent } from "./handler";

if (!existsSync(deployedFile)) {
  throw new Error("Nothing deployed. Run `pnpm aws:deploy` with AWS_PROFILE and AWS_REGION set first.");
}
const { aliasArn, region }: Deployed = JSON.parse(readFileSync(deployedFile, "utf8"));
// The region the function was deployed to, whatever AWS_REGION says now.
const client = new LambdaClient({ region });

// Event (async) invocation: the runner polls history, and can wait on callbacks.
const runner = () =>
  new CloudDurableTestRunner({
    functionName: durableFunction<typeof handler>(aliasArn),
    client,
    config: { invocationType: InvocationType.Event },
  });
const run = (payload: E2eEvent) => runner().run({ payload });

/** How many times a step actually ran: one `StepStarted` history event per attempt. */
const attempts = (execution: Awaited<ReturnType<typeof run>>, name: string) =>
  execution.getHistoryEvents().filter((e) => e.EventType === "StepStarted" && e.Name === name).length;

describe("awaitly-durable-lambda on AWS", () => {
  it("checkpoints each step, suspends on sleep, and replays without re-running", async () => {
    const execution = await run({ scenario: "checkout", userId: "u1" });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ ok: true, value: { receipt: "r-u1" } });
    expect(execution.getOperations().map((op) => [op.getName(), op.getType()])).toEqual([
      ["getUser", "STEP"],
      ["coolingOff", "WAIT"],
      ["charge", "STEP"],
    ]);
    // The wait ended the first invocation; getUser was replayed, not re-run.
    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
    expect(attempts(execution, "getUser")).toBe(1);
  });

  it("records an expected failure once instead of retrying it", async () => {
    const execution = await run({ scenario: "checkout", userId: "broke" });

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ ok: false, error: "DECLINED" });
    expect(attempts(execution, "charge")).toBe(1);
  });

  it("retries a throwing step through Lambda, then fails the execution", async () => {
    const execution = await run({ scenario: "alwaysThrows" });

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError().errorMessage).toContain("ECONNRESET");
    expect(attempts(execution, "callApi")).toBe(2);
  });

  it("suspends on a callback and resumes with completed steps replayed", async () => {
    const approval = runner();
    const pending = approval.run({ payload: { scenario: "approval", userId: "u2" } });
    const callback = await approval.getOperation("approve").waitForData(WaitingOperationStatus.SUBMITTED);
    await callback.sendCallbackSuccess(JSON.stringify("approved"));
    const execution = await pending;

    expect(execution.getStatus()).toBe("SUCCEEDED");
    expect(execution.getResult()).toEqual({ ok: true, value: { receipt: "r-u2" } });
    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
    expect(attempts(execution, "getUser")).toBe(1);
  });
});
