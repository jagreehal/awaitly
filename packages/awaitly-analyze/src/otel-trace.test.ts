/**
 * OpenTelemetry spans to traces to autovisualizer counts.
 *
 * `otel-checkout.tempo.json` holds three runs of `otel-checkout.ts`, exported
 * over OTLP by the Node SDK and fetched back from Tempo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeWorkflowFile, analyzeWorkflowSource } from "./static-analyzer";
import { countsFromTraces } from "./output/autovisualizer";
import { renderMachineJSON, type MachineJSON } from "./output/machine-json";
import { renderStaticMermaidWithTrace } from "./output/mermaid";
import { isSpanExport, tracesFromSpans, traceFromEvents } from "./trace";

const fixtures = join(__dirname, "__fixtures__");
const tempo: unknown = JSON.parse(readFileSync(join(fixtures, "otel-checkout.tempo.json"), "utf8"));

describe("tracesFromSpans", () => {
  it("reads awaitly runs back out of a Tempo trace", () => {
    const runs = tracesFromSpans(tempo);
    expect(runs.map((r) => r.workflowName)).toEqual(["otelCheckout", "otelCheckout", "otelCheckout"]);

    const declined = runs.find((r) => r.trace.steps.some((s) => s.status === "error"))!;
    expect(declined.trace.steps.map(({ stepId, status, retries, location }) => ({ stepId, status, retries, line: location?.line }))).toEqual([
      { stepId: "load-cart", status: "success", retries: undefined, line: 25 },
      { stepId: "review-order", status: "success", retries: undefined, line: 27 },
      { stepId: "charge", status: "error", retries: 1, line: 29 },
    ]);
    expect(declined.trace.decisions).toEqual([{ decisionId: "needs-review", branch: "then", label: "total > 100" }]);
  });

  it("tells span exports from workflow event streams", () => {
    expect(isSpanExport(tempo)).toBe(true);
    expect(isSpanExport({ resourceSpans: [] })).toBe(true);
    expect(isSpanExport([{ type: "step_start", ts: 1, stepId: "a" }])).toBe(false);
  });

  it("reads SDK ReadableSpans, cache hits and compensations", () => {
    const span = (name: string, attributes: Record<string, unknown>, start: number, events: unknown[] = []) => ({
      name,
      attributes: { "awaitly.workflow.id": "w1", ...attributes },
      events,
      startTime: [0, start],
      endTime: [0, start + 1_000_000],
    });
    const [run] = tracesFromSpans([
      span("run refund", { "awaitly.workflow.name": "refund", "awaitly.outcome": "error" }, 0, [
        { name: "awaitly.step.cache_hit", attributes: { "awaitly.step.name": "load" } },
      ]),
      span("step charge", { "awaitly.step.name": "charge", "awaitly.outcome": "success" }, 10),
      span("step notify", { "awaitly.step.name": "notify", "awaitly.outcome": "error" }, 20),
      span("compensate charge", { "awaitly.step.name": "charge", "awaitly.outcome": "success" }, 30),
    ]);
    expect(run).toEqual({
      workflowId: "w1",
      workflowName: "refund",
      trace: {
        steps: [
          { stepId: "load", status: "cache-hit" },
          { stepId: "charge", status: "success", durationMs: 1 },
          { stepId: "notify", status: "error", durationMs: 1 },
        ],
        decisions: [],
        compensations: [{ stepId: "charge", status: "success" }],
      },
    });
  });
});

describe("countsFromTraces", () => {
  const [ir] = analyzeWorkflowFile(join(fixtures, "otel-checkout.ts"));
  const machine = renderMachineJSON(ir!);

  it("counts every transition the traced runs took, and 0 for the rest", () => {
    const { counts, unmatched } = countsFromTraces(machine, tracesFromSpans(tempo).map((r) => r.trace));
    expect(unmatched).toEqual([]);
    expect(counts).toEqual({
      "load-cart": { "xstate.done.actor": 3, "xstate.error.actor": 0 },
      "needs-review": { "total > 100": 1, "Not total > 100": 2 },
      "review-order": { "xstate.done.actor": 1, "xstate.error.actor": 0 },
      charge: { "xstate.done.actor": 2, "xstate.error.actor": 1 },
      "send-receipt": { "xstate.done.actor": 2, "xstate.error.actor": 0 },
    });
  });

  it("gives span traces and event traces the same Mermaid overlay", () => {
    const run = tracesFromSpans(tempo)[0]!.trace;
    const fromEvents = traceFromEvents([
      ...run.steps.flatMap((s) => [
        { type: "step_start", workflowId: "w", ts: 0, stepId: s.stepId, name: s.stepId },
        { type: s.status === "success" ? "step_success" : "step_error", workflowId: "w", ts: 0, stepId: s.stepId, name: s.stepId },
      ]),
      ...(run.decisions ?? []).map((d) => ({ type: "decision", workflowId: "w", ts: 0, ...d })),
    ] as never);
    expect(fromEvents.decisions).toHaveLength(1);
    expect(renderStaticMermaidWithTrace(ir!, run).mermaid).toBe(renderStaticMermaidWithTrace(ir!, fromEvents).mermaid);
  });

  it("uses the call-site line to pick between steps that share an id", () => {
    const source = `
      import { createWorkflow, ok } from "awaitly";
      const save = async () => ok(1);
      export const wf = createWorkflow("dupes", { save });
      export const go = (fast: boolean) => wf.run(async ({ step, deps }) => {
        if (fast) {
          await step("save", () => deps.save());
        } else {
          await step("save", () => deps.save());
        }
      });
    `;
    const [dupes] = analyzeWorkflowSource(source);
    const m = renderMachineJSON(dupes!);
    const lines = Object.values(m.states)
      .filter((s) => s.invoke)
      .map((s) => [s.id, (s.meta?.location as { line: number }).line] as const);
    expect(lines.map(([id]) => id)).toEqual(["save", "save_2"]);

    const { counts } = countsFromTraces(m, [
      { steps: [{ stepId: "save", status: "success", location: { filePath: "x.ts", line: lines[1]![1] } }] },
    ]);
    expect(counts.save).toEqual({ "xstate.done.actor": 0, "xstate.error.actor": 0 });
    expect(counts.save_2).toEqual({ "xstate.done.actor": 1, "xstate.error.actor": 0 });
  });

  it("counts compensations on the rollback state, not its after-failure copy", () => {
    const invoke = (id: string) => ({ id, src: id, onDone: { target: "#done" }, onError: { target: "#failed" } });
    const m: MachineJSON = {
      id: "saga",
      initial: "charge",
      states: {
        charge: { id: "charge", invoke: invoke("charge"), meta: {} },
        undo_charge: { id: "undo_charge", invoke: invoke("refund"), meta: { compensationFor: "charge" } },
        undo_charge_after_failure: {
          id: "undo_charge_after_failure",
          invoke: invoke("refund"),
          meta: { compensationFor: "charge" },
        },
        done: { id: "done", type: "final" },
        failed: { id: "failed", type: "final" },
      },
    };
    const { counts } = countsFromTraces(m, [
      { steps: [{ stepId: "charge", status: "success" }], compensations: [{ stepId: "charge", status: "error" }] },
    ]);
    expect(counts.undo_charge).toEqual({ "xstate.done.actor": 0, "xstate.error.actor": 1 });
    expect(counts.undo_charge_after_failure).toEqual({ "xstate.done.actor": 0, "xstate.error.actor": 0 });
  });
});
