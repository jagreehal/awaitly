/**
 * Core `decision` events (emitted automatically by step.if / step.branch)
 * must produce DecisionNodes in the runtime IR without trackIf instrumentation.
 */
import { describe, expect, it } from "vitest";
import { ok, type AsyncResult } from "awaitly";
import { createWorkflow } from "awaitly/workflow";
import { createVisualizer } from "./index";
import type { DecisionNode, FlowNode } from "./types";

const fetchUser = async (id: string): AsyncResult<{ id: string; premium: boolean }, "NOT_FOUND"> =>
  ok({ id, premium: true });

function findDecisions(nodes: FlowNode[]): DecisionNode[] {
  const out: DecisionNode[] = [];
  for (const n of nodes) {
    if (n.type === "decision") out.push(n);
    const children =
      "children" in n && Array.isArray((n as { children?: FlowNode[] }).children)
        ? (n as { children: FlowNode[] }).children
        : [];
    out.push(...findDecisions(children));
  }
  return out;
}

describe("core decision events in the runtime IR", () => {
  it("step.if produces a decision node with both branches, no trackIf needed", async () => {
    const viz = createVisualizer({ workflowName: "checkout" });
    const workflow = createWorkflow("checkout", { fetchUser }, { onEvent: viz.handleEvent });

    await workflow.run(async ({ step, deps }) => {
      const user = await step("fetchUser", () => deps.fetchUser("1"));
      if (step.if("premium-check", "user.premium", () => user.premium)) {
        return "premium";
      }
      return "basic";
    });

    const ir = viz.getIR();
    const decisions = findDecisions(ir.root.children);
    expect(decisions).toHaveLength(1);
    const decision = decisions[0];
    expect(decision.id).toBe("premium-check");
    expect(decision.branchTaken).toBe("then");
    expect(decision.branches.map((b) => ({ label: b.label, taken: b.taken }))).toEqual([
      { label: "then", taken: true },
      { label: "else", taken: false },
    ]);
  });

  it("step.branch nests the arm's steps inside the taken branch", async () => {
    const charge = async (_u: unknown) => ok({ txId: "tx-1" });
    const viz = createVisualizer({ workflowName: "checkout" });
    const workflow = createWorkflow(
      "checkout",
      { fetchUser, charge },
      { onEvent: viz.handleEvent }
    );

    await workflow.run(async ({ step, deps }) => {
      const user = await step("fetchUser", () => deps.fetchUser("1"));
      return step.branch("route", {
        conditionLabel: "user.premium",
        condition: () => user.premium,
        then: async () => step("charge", () => deps.charge(user)),
        else: () => undefined,
      });
    });

    const ir = viz.getIR();
    const decisions = findDecisions(ir.root.children);
    expect(decisions).toHaveLength(1);
    const decision = decisions[0];
    expect(decision.id).toBe("route");
    expect(decision.branchTaken).toBe("then");

    const thenBranch = decision.branches.find((b) => b.label === "then");
    const elseBranch = decision.branches.find((b) => b.label === "else");
    expect(thenBranch?.taken).toBe(true);
    expect(elseBranch?.taken).toBe(false);
    // The charge step executed inside the arm is a child of the taken
    // branch, not a root-level sibling.
    expect(thenBranch?.children.map((c) => ("name" in c ? c.name : undefined))).toContain("charge");
    const rootStepNames = ir.root.children
      .filter((n) => n.type === "step")
      .map((n) => ("name" in n ? n.name : undefined));
    expect(rootStepNames).not.toContain("charge");
  });
});
