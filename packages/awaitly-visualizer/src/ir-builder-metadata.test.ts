import { describe, it, expect } from "vitest";
import { createIRBuilder } from "./ir-builder";
import type { WorkflowEvent } from "awaitly/workflow";
import type { StepNode } from "./types";
import { loggerRenderer } from "./renderers/logger";
import type { LoggerOutput } from "./renderers/logger";

const WF_ID = "wf-meta-1";

function baseStart(): WorkflowEvent<unknown> {
  return { type: "workflow_start", workflowId: WF_ID, ts: 0 };
}

function baseEnd(ts = 200): WorkflowEvent<unknown> {
  return { type: "workflow_success", workflowId: WF_ID, ts, durationMs: ts };
}

const sampleMetadata = {
  domain: "payments",
  intent: "charge-card",
  owner: "billing-team",
  calls: ["stripe.charges.create"] as readonly string[],
};

const sampleDiagnostics = {
  tag: "StripeRateLimitError",
  classification: {
    retryable: true,
    severity: "infrastructure" as const,
    description: "Rate limit exceeded",
  },
  attempt: 2,
  cumulativeDurationMs: 150,
  origin: "throw" as const,
};

describe("IR builder metadata", () => {
  it("stores metadata from step_start on StepNode at step_success", () => {
    const builder = createIRBuilder({ detectParallel: false });
    builder.handleEvent(baseStart());

    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 10,
      metadata: sampleMetadata,
    } as any);

    builder.handleEvent({
      type: "step_success",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 50,
      durationMs: 40,
    } as any);

    builder.handleEvent(baseEnd());

    const ir = builder.getIR();
    const step = ir.root.children[0] as StepNode;
    expect(step.metadata).toEqual(sampleMetadata);
  });

  it("preserves metadata through retry sequences", () => {
    const builder = createIRBuilder({ detectParallel: false });
    builder.handleEvent(baseStart());

    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 10,
      metadata: sampleMetadata,
    } as any);

    builder.handleEvent({
      type: "step_retry",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 30,
      attempt: 2,
    } as any);

    builder.handleEvent({
      type: "step_success",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 60,
      durationMs: 50,
    } as any);

    builder.handleEvent(baseEnd());

    const ir = builder.getIR();
    const step = ir.root.children[0] as StepNode;
    expect(step.metadata).toEqual(sampleMetadata);
    expect(step.retryCount).toBe(1);
  });

  it("includes errorDiagnostics on error StepNode", () => {
    const builder = createIRBuilder({ detectParallel: false });
    builder.handleEvent(baseStart());

    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 10,
      metadata: sampleMetadata,
    } as any);

    builder.handleEvent({
      type: "step_error",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 50,
      durationMs: 40,
      error: "Rate limit exceeded",
      diagnostics: sampleDiagnostics,
    } as any);

    builder.handleEvent({
      type: "workflow_error",
      workflowId: WF_ID,
      ts: 60,
      durationMs: 60,
      error: "Rate limit exceeded",
    } as any);

    const ir = builder.getIR();
    const step = ir.root.children[0] as StepNode;
    expect(step.metadata).toEqual(sampleMetadata);
    expect(step.errorDiagnostics).toEqual(sampleDiagnostics);
  });

  it("includes metadata on aborted StepNode", () => {
    const builder = createIRBuilder({ detectParallel: false });
    builder.handleEvent(baseStart());

    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 10,
      metadata: sampleMetadata,
    } as any);

    builder.handleEvent({
      type: "step_aborted",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 50,
      durationMs: 40,
    } as any);

    builder.handleEvent(baseEnd());

    const ir = builder.getIR();
    const step = ir.root.children[0] as StepNode;
    expect(step.state).toBe("aborted");
    expect(step.metadata).toEqual(sampleMetadata);
  });
});

describe("Logger renderer metadata", () => {
  function buildIRWithMetadata() {
    const builder = createIRBuilder({ detectParallel: false });
    builder.handleEvent(baseStart());

    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 10,
      metadata: sampleMetadata,
    } as any);

    builder.handleEvent({
      type: "step_success",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 50,
      durationMs: 40,
    } as any);

    builder.handleEvent(baseEnd());
    return builder.getIR();
  }

  it("includes domain, intent, owner, calls from metadata", () => {
    const ir = buildIRWithMetadata();
    const renderer = loggerRenderer();
    const output: LoggerOutput = JSON.parse(
      renderer.render(ir, {
        showTimings: true,
        showKeys: false,
        colors: {
          pending: "",
          running: "",
          success: "",
          error: "",
          aborted: "",
          cached: "",
          skipped: "",
        },
        includeDiagram: false,
      } as any)
    );

    const stepLog = output.steps[0];
    expect(stepLog.domain).toBe("payments");
    expect(stepLog.intent).toBe("charge-card");
    expect(stepLog.owner).toBe("billing-team");
    expect(stepLog.calls).toEqual(["stripe.charges.create"]);
  });

  it("includes errorDiagnostics summary", () => {
    const builder = createIRBuilder({ detectParallel: false });
    builder.handleEvent(baseStart());

    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 10,
      metadata: sampleMetadata,
    } as any);

    builder.handleEvent({
      type: "step_error",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 50,
      durationMs: 40,
      error: "Rate limit exceeded",
      diagnostics: sampleDiagnostics,
    } as any);

    builder.handleEvent({
      type: "workflow_error",
      workflowId: WF_ID,
      ts: 60,
      durationMs: 60,
      error: "Rate limit exceeded",
    } as any);

    const ir = builder.getIR();
    const renderer = loggerRenderer();
    const output: LoggerOutput = JSON.parse(
      renderer.render(ir, {
        showTimings: true,
        showKeys: false,
        colors: {
          pending: "",
          running: "",
          success: "",
          error: "",
          aborted: "",
          cached: "",
          skipped: "",
        },
        includeDiagram: false,
      } as any)
    );

    const stepLog = output.steps[0];
    expect(stepLog.errorDiagnostics).toEqual({
      tag: "StripeRateLimitError",
      origin: "throw",
      severity: "infrastructure",
      retryable: true,
    });
  });

  it("summary includes byDomain grouping", () => {
    const builder = createIRBuilder({ detectParallel: false });
    builder.handleEvent(baseStart());

    // Two steps in "payments" domain
    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 10,
      metadata: { domain: "payments" },
    } as any);
    builder.handleEvent({
      type: "step_success",
      workflowId: WF_ID,
      stepId: "s1",
      name: "chargeCard",
      stepKey: "charge",
      ts: 50,
      durationMs: 40,
    } as any);

    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s2",
      name: "refund",
      stepKey: "refund",
      ts: 60,
      metadata: { domain: "payments" },
    } as any);
    builder.handleEvent({
      type: "step_error",
      workflowId: WF_ID,
      stepId: "s2",
      name: "refund",
      stepKey: "refund",
      ts: 80,
      durationMs: 20,
      error: "refund failed",
    } as any);

    // One step in "notifications" domain
    builder.handleEvent({
      type: "step_start",
      workflowId: WF_ID,
      stepId: "s3",
      name: "sendEmail",
      stepKey: "email",
      ts: 90,
      metadata: { domain: "notifications" },
    } as any);
    builder.handleEvent({
      type: "step_success",
      workflowId: WF_ID,
      stepId: "s3",
      name: "sendEmail",
      stepKey: "email",
      ts: 100,
      durationMs: 10,
    } as any);

    builder.handleEvent({
      type: "workflow_error",
      workflowId: WF_ID,
      ts: 110,
      durationMs: 110,
      error: "refund failed",
    } as any);

    const ir = builder.getIR();
    const renderer = loggerRenderer();
    const output: LoggerOutput = JSON.parse(
      renderer.render(ir, {
        showTimings: true,
        showKeys: false,
        colors: {
          pending: "",
          running: "",
          success: "",
          error: "",
          aborted: "",
          cached: "",
          skipped: "",
        },
        includeDiagram: false,
      } as any)
    );

    expect(output.summary.byDomain).toEqual({
      payments: { total: 2, errors: 1, avgDurationMs: 30 },
      notifications: { total: 1, errors: 0, avgDurationMs: 10 },
    });
  });
});
