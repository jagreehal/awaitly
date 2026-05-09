import { describe, it, expect } from "vitest";
import { ok } from "./core";
import { createWorkflow } from "./workflow/execute";
import { withDeps } from "./di";

describe("withDeps()", () => {
  it("is available as workflow.withDeps() (fluent form)", async () => {
    const workflow = createWorkflow("di-method", {
      getValue: async () => ok("base"),
    });

    const result = await workflow
      .withDeps({ getValue: async () => ok("provided") })
      .run(async ({ step, deps }) => step("value", () => deps.getValue()));

    expect(result).toEqual({ ok: true, value: "provided" });
  });

  it("applies provided deps for run() (standalone form)", async () => {
    const workflow = createWorkflow("di-withdeps-run", {
      getValue: async () => ok("base"),
    });

    const provided = withDeps(workflow, {
      getValue: async () => ok("provided"),
    });

    const result = await provided.run(async ({ step, deps }) =>
      step("value", () => deps.getValue())
    );

    expect(result).toEqual({ ok: true, value: "provided" });
  });

  it("supports named run overload and run config deps override precedence", async () => {
    const workflow = createWorkflow("di-withdeps-precedence", {
      getValue: async () => ok("base"),
    });

    const provided = withDeps(workflow, {
      getValue: async () => ok("provided"),
    });

    const result = await provided.run(
      "named-run",
      async ({ step, deps }) => step("value", () => deps.getValue()),
      {
        deps: {
          getValue: async () => ok("run"),
        },
      }
    );

    expect(result).toEqual({ ok: true, value: "run" });
  });

  it("applies provided deps for runWithState()", async () => {
    const workflow = createWorkflow("di-withdeps-state", {
      getValue: async () => ok("base"),
    });

    const provided = withDeps(workflow, {
      getValue: async () => ok("provided"),
    });

    const { result, resumeState } = await provided.runWithState(
      async ({ step, deps }) => step("value", () => deps.getValue())
    );

    expect(result).toEqual({ ok: true, value: "provided" });
    expect(resumeState.steps).toBeInstanceOf(Map);
  });

  it("supports chained withDeps() with right-most precedence", async () => {
    const workflow = createWorkflow("di-withdeps-chain", {
      getValue: async () => ok("base"),
    });

    const provided = workflow
      .withDeps({ getValue: async () => ok("first") })
      .withDeps({ getValue: async () => ok("second") });

    const result = await provided.run(async ({ step, deps }) =>
      step("value", () => deps.getValue())
    );

    expect(result).toEqual({ ok: true, value: "second" });
  });
});
