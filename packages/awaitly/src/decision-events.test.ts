import { describe, expect, it } from "vitest";

import { ok, run, type AsyncResult, type WorkflowEvent } from "./index";
import { createWorkflow } from "./workflow-entry";

const fetchUser = async (id: string): AsyncResult<{ id: string; premium: boolean }, "NOT_FOUND"> =>
  ok({ id, premium: true });

describe("decision events", () => {
  it("step.if emits a decision event with the taken branch", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        const user = await step("fetchUser", () => fetchUser("1"));
        if (step.if("premium-check", "user.premium", () => user.premium)) {
          return "premium";
        }
        return "basic";
      },
      { onEvent: (e) => events.push(e) }
    );

    expect(result.ok).toBe(true);
    const decisions = events.filter((e) => e.type === "decision");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      type: "decision",
      decisionId: "premium-check",
      label: "user.premium",
      branch: "then",
      value: true,
    });
  });

  it("step.if emits branch 'else' when condition is false", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    await run(
      async ({ step }) => {
        if (step.if("flag", "always false", () => false)) {
          return "a";
        }
        return "b";
      },
      { onEvent: (e) => events.push(e) }
    );

    const decisions = events.filter((e) => e.type === "decision");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ branch: "else", value: false });
  });

  it("step.branch emits a scoped decision (phase start/end) with conditionLabel", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        return step.branch("route", {
          conditionLabel: "amount > 100",
          condition: () => true,
          then: () => "big",
          else: () => "small",
        });
      },
      { onEvent: (e) => events.push(e) }
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("big");
    const decisions = events.filter((e) => e.type === "decision");
    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({
      decisionId: "route",
      label: "amount > 100",
      branch: "then",
      phase: "start",
    });
    expect(decisions[1]).toMatchObject({
      decisionId: "route",
      branch: "then",
      phase: "end",
    });
    expect(typeof (decisions[1] as { durationMs?: number }).durationMs).toBe("number");
  });

  it("step.branch emits phase end even when the arm throws", async () => {
    const events: WorkflowEvent<unknown>[] = [];

    const result = await run(
      async ({ step }) => {
        return step.branch("route", {
          conditionLabel: "always",
          condition: () => true,
          then: () => {
            throw new Error("arm failed");
          },
        });
      },
      { onEvent: (e) => events.push(e) }
    );

    expect(result.ok).toBe(false);
    const phases = events.filter((e) => e.type === "decision").map((e) => (e as { phase?: string }).phase);
    expect(phases).toEqual(["start", "end"]);
  });

  it("createWorkflow path emits decision events with workflowName", async () => {
    const events: WorkflowEvent<unknown>[] = [];
    const workflow = createWorkflow(
      "checkout",
      { fetchUser },
      { onEvent: (e) => events.push(e) }
    );

    await workflow.run(async ({ step, deps }) => {
      const user = await step("fetchUser", () => deps.fetchUser("1"));
      if (step.if("premium-check", "user.premium", () => user.premium)) {
        return "premium";
      }
      return "basic";
    });

    const decisions = events.filter((e) => e.type === "decision");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decisionId: "premium-check",
      branch: "then",
      workflowName: "checkout",
    });
  });
});
