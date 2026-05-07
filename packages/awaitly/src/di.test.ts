import { describe, it, expect } from "vitest";
import { ok } from "./core";
import { createWorkflow } from "./workflow/execute";
import { provide } from "./di";

describe("provide()", () => {
  it("is available as workflow.provide() (fluent form)", async () => {
    const workflow = createWorkflow("di-method", {
      getValue: async () => ok("base"),
    });

    const result = await workflow
      .provide({ getValue: async () => ok("provided") })
      .run(async ({ step, deps }) => step("value", () => deps.getValue()));

    expect(result).toEqual({ ok: true, value: "provided" });
  });

  it("applies provided deps for run() (standalone form)", async () => {
    const workflow = createWorkflow("di-provide-run", {
      getValue: async () => ok("base"),
    });

    const provided = provide(workflow, {
      getValue: async () => ok("provided"),
    });

    const result = await provided.run(async ({ step, deps }) =>
      step("value", () => deps.getValue())
    );

    expect(result).toEqual({ ok: true, value: "provided" });
  });

  it("supports named run overload and run config deps override precedence", async () => {
    const workflow = createWorkflow("di-provide-precedence", {
      getValue: async () => ok("base"),
    });

    const provided = provide(workflow, {
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
    const workflow = createWorkflow("di-provide-state", {
      getValue: async () => ok("base"),
    });

    const provided = provide(workflow, {
      getValue: async () => ok("provided"),
    });

    const { result, resumeState } = await provided.runWithState(
      async ({ step, deps }) => step("value", () => deps.getValue())
    );

    expect(result).toEqual({ ok: true, value: "provided" });
    expect(resumeState.steps).toBeInstanceOf(Map);
  });

  it("supports chained provide() with right-most precedence", async () => {
    const workflow = createWorkflow("di-provide-chain", {
      getValue: async () => ok("base"),
    });

    const provided = workflow
      .provide({ getValue: async () => ok("first") })
      .provide({ getValue: async () => ok("second") });

    const result = await provided.run(async ({ step, deps }) =>
      step("value", () => deps.getValue())
    );

    expect(result).toEqual({ ok: true, value: "second" });
  });
});
