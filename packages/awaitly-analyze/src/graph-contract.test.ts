/**
 * Analyzer → runtime graph contract: the DSL produced by renderWorkflowDSL
 * must be directly usable as the runtime `graph` option. Decisions keep their
 * authored ids, steps keep their semantic ids (even with custom keys), so a
 * valid workflow validates cleanly and a rogue id still fails.
 */
import { describe, expect, it } from "vitest";
import { ok, type AsyncResult } from "awaitly";
import { createWorkflow } from "awaitly/workflow";
import { analyzeWorkflowSource } from "./static-analyzer";
import { renderWorkflowDSL } from "./output/dsl";

const SOURCE = `
  import { createWorkflow } from "awaitly/workflow";
  declare const fetchUser: (id: string) => Promise<any>;
  declare const charge: (u: any) => Promise<any>;

  const wf = createWorkflow("checkout", { fetchUser, charge });
  export async function runIt() {
    return await wf.run(async ({ step, deps }) => {
      const user = await step("fetchUser", () => deps.fetchUser("1"), { key: "user-123" });
      if (step.if("premium-check", "user.premium", () => user.premium)) {
        return await step("charge", () => deps.charge(user));
      }
      return undefined;
    });
  }
`;

const fetchUser = async (id: string): AsyncResult<{ id: string; premium: boolean }, "NOT_FOUND"> =>
  ok({ id, premium: true });
const charge = async (_u: unknown): AsyncResult<{ txId: string }, "CHARGE_DECLINED"> =>
  ok({ txId: "tx-1" });

describe("analyzer DSL as runtime graph", () => {
  it("uses semantic step ids and authored decision ids as state ids", () => {
    const [ir] = analyzeWorkflowSource(SOURCE);
    const dsl = renderWorkflowDSL(ir);
    const ids = dsl.states.map((s) => s.id);
    expect(ids).toContain("fetchUser"); // semantic id, not the "user-123" key
    expect(ids).not.toContain("user-123");
    expect(ids).toContain("premium-check"); // authored decision id, not decision_N
    expect(ids).toContain("charge");
  });

  it("carries literal cache keys on state.key for snapshot highlighting", () => {
    const [ir] = analyzeWorkflowSource(SOURCE);
    const dsl = renderWorkflowDSL(ir);
    const fetchState = dsl.states.find((s) => s.id === "fetchUser");
    expect(fetchState?.key).toBe("user-123");
    // Snapshot contract: currentStepId (= key ?? id) matches key ?? id.
    const currentStepId = "user-123"; // what a durable snapshot stores for this step
    const highlighted = dsl.states.find((s) => (s.key ?? s.id) === currentStepId);
    expect(highlighted?.id).toBe("fetchUser");
  });

  it("keeps state ids unique when steps collide with start/end or each other", () => {
    const [ir] = analyzeWorkflowSource(`
      import { createWorkflow } from "awaitly/workflow";
      declare const op: () => Promise<any>;
      const wf = createWorkflow("edgeCase", { op });
      export async function runIt() {
        return await wf.run(async ({ step, deps }) => {
          await step("start", () => deps.op());
          await step("fetchUser", () => deps.op());
          await step("fetchUser", () => deps.op());
          return await step("end", () => deps.op());
        });
      }
    `);
    const dsl = renderWorkflowDSL(ir);
    const ids = dsl.states.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(dsl.initialStateId).toBe("start"); // reserved initial survives
    expect(ids).toContain("start#2"); // the authored "start" step got suffixed
    expect(ids).toContain("end#2");
    expect(ids).toContain("fetchUser");
    expect(ids).toContain("fetchUser#2");
    expect(dsl.states.find((s) => s.id === "start#2")?.semanticId).toBe("start");
    expect(dsl.states.find((s) => s.id === "end#2")?.semanticId).toBe("end");
    expect(dsl.states.find((s) => s.id === "fetchUser#2")?.semanticId).toBe("fetchUser");
  });

  it("a valid workflow passes runtime validation against the analyzer DSL", async () => {
    const [ir] = analyzeWorkflowSource(SOURCE);
    const dsl = renderWorkflowDSL(ir);

    const workflow = createWorkflow("checkout", { fetchUser, charge }, { graph: dsl });
    const result = await workflow.run(async ({ step, deps }) => {
      const user = await step("fetchUser", () => deps.fetchUser("1"), { key: "user-123" });
      if (step.if("premium-check", "user.premium", () => user.premium)) {
        return await step("charge", () => deps.charge(user));
      }
      return undefined;
    });

    expect(result.ok).toBe(true);
  });

  it("a rogue step id still fails against the analyzer DSL", async () => {
    const [ir] = analyzeWorkflowSource(SOURCE);
    const dsl = renderWorkflowDSL(ir);

    const workflow = createWorkflow("checkout", { fetchUser, charge }, { graph: dsl });
    const result = await workflow.run(async ({ step, deps }) => {
      return await step("rogueStep", () => deps.fetchUser("1"));
    });

    expect(result.ok).toBe(false);
  });
});
