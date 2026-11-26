import { describe, expect, it } from "vitest";
import { analyzeErrorFlow } from "./error-flow";
import { diffWorkflows } from "./diff/diff-engine";
import { renderMachineJSON } from "./output/machine-json";
import { renderStaticMermaid } from "./output/mermaid";
import { renderRailwayMermaid } from "./output/railway";
import { analyzeWorkflowSource } from "./static-analyzer";
import { validateStrict } from "./strict-diagnostics";

const PRELUDE = `
  type Ok<T> = { ok: true; value: T };
  type Err<E> = { ok: false; error: E };
  type Result<T, E> = Ok<T> | Err<E>;
  type AsyncResult<T, E> = Promise<Result<T, E>>;
  declare const getUser: (id: string) => AsyncResult<{ name: string; age: number }, { type: "NOT_FOUND" }>;
  declare const checkName: (n: string) => AsyncResult<void, { type: "NAME_REQUIRED" }>;
  declare const checkAge: (n: number) => AsyncResult<void, { type: "TOO_YOUNG" }>;
`;
const analyze = (operations: string) =>
  analyzeWorkflowSource(`
    import { run } from "awaitly";
    ${PRELUDE}
    export const preview = (id: string) =>
      run({ getUser }, async (s, { step }) => {
        const user = await s.getUser(id);
        const { errors } = await step.allSettled("checks", {${operations}});
        return errors;
      }, { workflowName: "preview" });
  `)[0]!;

const CHECKS = `
  name: () => checkName(user.name),
  age: () => checkAge(user.age),
`;

describe("step.allSettled", () => {
  it("gives each operation the step id it runs under", () => {
    const ids = analyzeErrorFlow(analyze(CHECKS)).stepErrors.map((s) => s.stepId);
    expect(ids).toEqual(["getUser", "checks.name", "checks.age"]);
  });

  it("keeps the operations' errors out of the workflow's errors", () => {
    expect(analyzeErrorFlow(analyze(CHECKS)).allErrors).toEqual(["NOT_FOUND"]);
  });

  it("labels the kept errors in Mermaid and draws no exit for them", () => {
    const mermaid = renderStaticMermaid(analyze(CHECKS));
    expect(mermaid).toContain("keeps NAME_REQUIRED");
    expect(mermaid).toContain("keeps TOO_YOUNG");
    expect(mermaid).not.toMatch(/err_\w+_(NAME_REQUIRED|TOO_YOUNG)/);
    expect(renderRailwayMermaid(analyze(CHECKS))).toContain("-->|ok or NAME_REQUIRED|");
    expect(renderRailwayMermaid(analyze(CHECKS))).not.toMatch(/\|err\|.*(NAME_REQUIRED|TOO_YOUNG)/);
  });

  it("sends a failed check on past the join in the XState machine", () => {
    const machine = renderMachineJSON(analyze(CHECKS));
    const checks = machine.states.checks!;
    const region = Object.values(checks.states!)[0]!;
    const step = Object.values(region.states!).find((s) => s.invoke)!;
    const kept = step.invoke!.onError.target!.slice(1);
    expect(region.states![kept]).toEqual({ id: kept, type: "final" });
    expect(checks.on!["xstate.done.state"]).toEqual({ target: "#done", matches: { stateId: "checks" } });
  });

  it("draws the exit when a dep ends the run on a kept error", () => {
    const ir = analyzeWorkflowSource(`
      import { run } from "awaitly";
      ${PRELUDE}
      declare const screen: () => AsyncResult<void, { type: "OUTAGE" } | { type: "RULE" }>;
      declare const failOnOutage: (o: { type: "OUTAGE" } | undefined) => AsyncResult<void, { type: "OUTAGE" }>;
      export const preview = () =>
        run({ failOnOutage }, async (s, { step }) => {
          const { errors } = await step.allSettled("checks", { fraud: () => screen() });
          await s.failOnOutage(errors.find((e) => e.type === "OUTAGE"));
        }, { workflowName: "preview" });
    `)[0]!;
    expect(analyzeErrorFlow(ir).allErrors).toEqual(["OUTAGE"]);
    const railway = renderRailwayMermaid(ir);
    expect(railway).toContain("|ok or OUTAGE / RULE|");
    expect(railway).toMatch(/failOnOutage[^]*\|err\| \w+\["OUTAGE"\]/);
  });

  it("raises no strict diagnostics for the operations", () => {
    const { diagnostics } = validateStrict(analyze(CHECKS));
    expect(diagnostics.filter((d) => /name|age/.test(d.message))).toEqual([]);
  });

  it("reports an added check in a diff", () => {
    const { summary, steps } = diffWorkflows(analyze(`name: () => checkName(user.name),`), analyze(CHECKS));
    expect(summary.stepsAdded).toBe(1);
    expect(steps.find((s) => s.kind === "added")!.stepId).toBe("checks.age");
  });

  it("draws nested steps, which can still end the workflow", () => {
    const ir = analyze(`
      "other-user": async () => { const o = await s.getUser("2"); return checkAge(o.age); },
      async age() { return checkAge(user.age); },
    `);
    const flow = analyzeErrorFlow(ir);
    expect(flow.stepErrors.map((s) => s.stepId)).toEqual(["getUser", "getUser", "checks.other-user", "checks.age"]);
    expect(flow.allErrors).toEqual(["NOT_FOUND"]);

    const machine = JSON.stringify(renderMachineJSON(ir).states.checks);
    expect(machine).toContain('"onError":{"target":"#failed"}');
  });
});
