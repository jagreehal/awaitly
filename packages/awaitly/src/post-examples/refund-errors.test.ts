/**
 * Blog series: Code Is the Workflow
 * Post 4 — Two Kinds of Failure in Long Running Code
 * https://arrangeactassert.com/posts/two-kinds-of-failure-in-long-running-code/
 *
 * Runnable example: expected business errors vs UnexpectedError at the boundary.
 */
import { describe, it, expect } from "vitest";
import {
  ok,
  err,
  match,
  isUnexpectedError,
  type AsyncResult,
} from "../core";
import { createWorkflow } from "../workflow";

type Approval = { approved: boolean; managerId: string };

async function waitForApproval(
  expenseId: string
): AsyncResult<Approval, "APPROVAL_DECLINED"> {
  if (expenseId === "exp-declined") {
    return err("APPROVAL_DECLINED");
  }
  return ok({ approved: true, managerId: "mgr-1" });
}

async function flakyProvider(): AsyncResult<{ chargeId: string }, never> {
  throw new Error("Stripe timeout");
}

describe("post-examples: refund errors (post 4)", () => {
  it("maps expected approval decline to a 400 response", async () => {
    const workflow = createWorkflow("refund-approval", { waitForApproval });

    const result = await workflow.run(async ({ step, deps }) => {
      return await step("approve", () => deps.waitForApproval("exp-declined"));
    });

    const http = match(result, {
      ok: () => ({ statusCode: 200 as const }),
      err: (error) => {
        if (error === "APPROVAL_DECLINED") {
          return {
            statusCode: 400 as const,
            body: { message: "Manager declined" },
          };
        }
        return { statusCode: 500 as const };
      },
    });

    expect(http.statusCode).toBe(400);
  });

  it("treats thrown SDK errors as UnexpectedError at the boundary", async () => {
    const workflow = createWorkflow("refund-charge-flaky", {
      flakyProvider,
    });

    const result = await workflow.run(async ({ step, deps }) => {
      return await step.try("charge", () => deps.flakyProvider(), {
        error: "CHARGE_FAILED",
      });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isUnexpectedError(result.error)).toBe(false);
      expect(result.error).toBe("CHARGE_FAILED");
    }
  });

  it("surfaces uncaught throws as UnexpectedError when step.try is not used", async () => {
    const workflow = createWorkflow("refund-raw-throw", { flakyProvider });

    const result = await workflow.run(async ({ step, deps }) => {
      return await step("charge", () => deps.flakyProvider());
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isUnexpectedError(result.error)).toBe(true);
    }
  });
});
