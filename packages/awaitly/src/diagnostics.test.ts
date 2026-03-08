import { describe, it, expect } from "vitest";
import { createDiagnosticsCollector } from "./diagnostics";
import type { WorkflowEvent, StepMetadata, StepErrorDiagnostics } from "./core";

type Evt = WorkflowEvent<unknown>;

function ev(partial: Evt): Evt {
  return partial;
}

describe("createDiagnosticsCollector", () => {
  // -----------------------------------------------------------------------
  // 1. Basic happy path
  // -----------------------------------------------------------------------
  it("produces correct wide event for a simple success workflow", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", workflowName: "checkout", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "charge", ts: 1001 }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "charge", ts: 1050, durationMs: 49 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1100, durationMs: 100 }));

    const wide = collector.wideEvent();
    expect(wide.workflowId).toBe("w1");
    expect(wide.workflowName).toBe("checkout");
    expect(wide.status).toBe("success");
    expect(wide.steps).toHaveLength(1);
    expect(wide.steps[0].stepId).toBe("s1");
    expect(wide.steps[0].name).toBe("charge");
    expect(wide.steps[0].status).toBe("success");
    expect(wide.steps[0].durationMs).toBe(49);
    expect(wide.summary.totalSteps).toBe(1);
    expect(wide.summary.errors).toBe(0);
    expect(wide.integrityWarnings).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 2. Timestamps
  // -----------------------------------------------------------------------
  it("startedAt/endedAt are ISO strings and durationMs is correct", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1500, durationMs: 500 }));

    const wide = collector.wideEvent();
    expect(wide.startedAt).toBe(new Date(1000).toISOString());
    expect(wide.endedAt).toBe(new Date(1500).toISOString());
    expect(wide.durationMs).toBe(500);
  });

  // -----------------------------------------------------------------------
  // 3. Step status mapping
  // -----------------------------------------------------------------------
  it("maps step_success → success", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "a", ts: 1001 }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "a", ts: 1010, durationMs: 9 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1020, durationMs: 20 }));
    expect(collector.wideEvent().steps[0].status).toBe("success");
  });

  it("maps step_error → error", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "a", ts: 1001 }));
    collector.handleEvent(ev({ type: "step_error", workflowId: "w1", stepId: "s1", name: "a", ts: 1010, durationMs: 9, error: new Error("boom") }));
    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 1020, durationMs: 20, error: new Error("boom") }));
    expect(collector.wideEvent().steps[0].status).toBe("error");
  });

  it("maps step_cache_hit → cached", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_cache_hit", workflowId: "w1", stepKey: "sk1", name: "a", ts: 1005 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1020, durationMs: 20 }));

    const wide = collector.wideEvent();
    const step = wide.steps.find((s) => s.stepId === "sk1");
    expect(step?.status).toBe("cached");
  });

  it("maps step_skipped → skipped", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_skipped", workflowId: "w1", stepKey: "sk1", name: "a", ts: 1005 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1020, durationMs: 20 }));

    const wide = collector.wideEvent();
    const step = wide.steps.find((s) => s.stepId === "sk1");
    expect(step?.status).toBe("skipped");
  });

  it("maps step_aborted → aborted", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "a", ts: 1001 }));
    collector.handleEvent(ev({ type: "step_aborted", workflowId: "w1", stepId: "s1", name: "a", ts: 1010, durationMs: 9 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1020, durationMs: 20 }));
    expect(collector.wideEvent().steps[0].status).toBe("aborted");
  });

  // -----------------------------------------------------------------------
  // 4. Metadata flows to step entries
  // -----------------------------------------------------------------------
  it("propagates metadata fields to step entries", () => {
    const metadata: StepMetadata = {
      domain: "payments",
      owner: "billing-team",
      intent: "charge customer",
      tags: ["critical", "payment"],
      calls: ["stripe.charges.create"],
    };
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "charge", ts: 1001, metadata }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "charge", ts: 1050, durationMs: 49 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1100, durationMs: 100 }));

    const step = collector.wideEvent().steps[0];
    expect(step.domain).toBe("payments");
    expect(step.owner).toBe("billing-team");
    expect(step.intent).toBe("charge customer");
    expect(step.tags).toEqual(["critical", "payment"]);
    expect(step.calls).toEqual(["stripe.charges.create"]);
  });

  // -----------------------------------------------------------------------
  // 5. Error diagnostics
  // -----------------------------------------------------------------------
  it("extracts tag, classification, origin from step_error diagnostics", () => {
    const diagnostics: StepErrorDiagnostics = {
      tag: "CARD_DECLINED",
      classification: { retryable: false, severity: "business" },
      origin: "result",
    };
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "charge", ts: 1001 }));
    collector.handleEvent(ev({
      type: "step_error",
      workflowId: "w1",
      stepId: "s1",
      name: "charge",
      ts: 1050,
      durationMs: 49,
      error: new Error("declined"),
      diagnostics,
    }));
    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 1100, durationMs: 100, error: new Error("declined") }));

    const step = collector.wideEvent().steps[0];
    expect(step.error?.tag).toBe("CARD_DECLINED");
    expect(step.error?.classification?.severity).toBe("business");
    expect(step.error?.origin).toBe("result");
  });

  // -----------------------------------------------------------------------
  // 6. Retry count
  // -----------------------------------------------------------------------
  it("retryCount equals number of step_retry events", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "charge", ts: 1001 }));
    collector.handleEvent(ev({
      type: "step_retry",
      workflowId: "w1",
      stepId: "s1",
      name: "charge",
      ts: 1010,
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      error: new Error("timeout"),
    }));
    collector.handleEvent(ev({
      type: "step_retry",
      workflowId: "w1",
      stepId: "s1",
      name: "charge",
      ts: 1120,
      attempt: 2,
      maxAttempts: 3,
      delayMs: 200,
      error: new Error("timeout"),
    }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "charge", ts: 1350, durationMs: 349 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1400, durationMs: 400 }));

    const wide = collector.wideEvent();
    expect(wide.steps[0].retryCount).toBe(2);
    expect(wide.summary.retries).toBe(2);
  });

  // -----------------------------------------------------------------------
  // 7. Timeout
  // -----------------------------------------------------------------------
  it("tracks timedOut flag and timeouts counter", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "slow", ts: 1001 }));
    collector.handleEvent(ev({
      type: "step_timeout",
      workflowId: "w1",
      stepId: "s1",
      name: "slow",
      ts: 6001,
      timeoutMs: 5000,
    }));
    collector.handleEvent(ev({
      type: "step_error",
      workflowId: "w1",
      stepId: "s1",
      name: "slow",
      ts: 6002,
      durationMs: 5001,
      error: new Error("timeout"),
    }));
    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 6010, durationMs: 5010, error: new Error("timeout") }));

    const wide = collector.wideEvent();
    expect(wide.steps[0].timedOut).toBe(true);
    expect(wide.summary.timeouts).toBe(1);
  });

  // -----------------------------------------------------------------------
  // 8. Integrity warnings
  // -----------------------------------------------------------------------
  it("warns when wideEvent() called before terminal event", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    const wide = collector.wideEvent();
    expect(wide.integrityWarnings).toContain("wideEvent() called before workflow terminal event");
  });

  it("warns when step terminal seen without step_start", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    // No step_start, directly step_success
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "charge", ts: 1050, durationMs: 49 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1100, durationMs: 100 }));

    const wide = collector.wideEvent();
    expect(wide.integrityWarnings).toContainEqual(
      expect.stringContaining('No step_start seen for step "s1"'),
    );
  });

  it("warns on duplicate step terminal event", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "charge", ts: 1001 }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "charge", ts: 1050, durationMs: 49 }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "charge", ts: 1060, durationMs: 59 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1100, durationMs: 100 }));

    const wide = collector.wideEvent();
    expect(wide.integrityWarnings).toContainEqual(
      expect.stringContaining('Duplicate step terminal event for step "s1"'),
    );
  });

  it("warns on duplicate workflow terminal event", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1100, durationMs: 100 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1200, durationMs: 200 }));

    const wide = collector.wideEvent();
    expect(wide.integrityWarnings).toContainEqual(
      expect.stringContaining("Duplicate workflow terminal event"),
    );
  });

  // -----------------------------------------------------------------------
  // 9. summary.byDomain
  // -----------------------------------------------------------------------
  it("groups steps by domain with correct avgDurationMs", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    // Two payment steps
    collector.handleEvent(ev({
      type: "step_start", workflowId: "w1", stepId: "s1", name: "charge", ts: 1001,
      metadata: { domain: "payments" },
    }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "charge", ts: 1101, durationMs: 100 }));

    collector.handleEvent(ev({
      type: "step_start", workflowId: "w1", stepId: "s2", name: "refund", ts: 1102,
      metadata: { domain: "payments" },
    }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s2", name: "refund", ts: 1302, durationMs: 200 }));

    // One shipping step that errors
    collector.handleEvent(ev({
      type: "step_start", workflowId: "w1", stepId: "s3", name: "ship", ts: 1303,
      metadata: { domain: "shipping" },
    }));
    collector.handleEvent(ev({
      type: "step_error", workflowId: "w1", stepId: "s3", name: "ship", ts: 1353, durationMs: 50,
      error: new Error("out of stock"),
    }));

    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 1400, durationMs: 400, error: new Error("fail") }));

    const wide = collector.wideEvent();
    expect(wide.summary.byDomain).toBeDefined();
    expect(wide.summary.byDomain!["payments"]).toEqual({
      total: 2,
      errors: 0,
      avgDurationMs: 150,
    });
    expect(wide.summary.byDomain!["shipping"]).toEqual({
      total: 1,
      errors: 1,
      avgDurationMs: 50,
    });
  });

  it("byDomain excludes cached/skipped/aborted steps", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    // Successful step in payments domain
    collector.handleEvent(ev({
      type: "step_start", workflowId: "w1", stepId: "s1", name: "charge", ts: 1001,
      metadata: { domain: "payments" },
    }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "charge", ts: 1101, durationMs: 100 }));

    // Cached step in payments domain — should NOT count in byDomain
    collector.handleEvent(ev({
      type: "step_start", workflowId: "w1", stepId: "s2", name: "lookup", ts: 1102,
      metadata: { domain: "payments" },
    }));
    collector.handleEvent(ev({
      type: "step_cache_hit", workflowId: "w1", stepKey: "s2", name: "lookup", ts: 1102,
    }));

    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1200, durationMs: 200 }));

    const wide = collector.wideEvent();
    expect(wide.summary.byDomain!["payments"]).toEqual({
      total: 1,
      errors: 0,
      avgDurationMs: 100,
    });
  });

  it("correlates step_cache_hit to prior step_start when stepKey differs from stepId", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    collector.handleEvent(ev({
      type: "step_start",
      workflowId: "w1",
      stepId: "lookup-user",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 1001,
      metadata: { domain: "payments" },
    }));
    collector.handleEvent(ev({
      type: "step_cache_hit",
      workflowId: "w1",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 1002,
    }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1010, durationMs: 10 }));

    const wide = collector.wideEvent();

    // Should keep one logical step and not create an orphan cache step.
    expect(wide.steps).toHaveLength(1);
    expect(wide.steps[0]).toMatchObject({
      stepId: "lookup-user",
      key: "cache:user:42",
      status: "cached",
      domain: "payments",
    });
    expect(wide.integrityWarnings ?? []).not.toContain(
      'No step_start seen for step "cache:user:42"'
    );
  });

  it("correlates step_cache_miss emitted before step_start when stepKey differs from stepId", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    // Real execution order: cache miss is emitted before the wrapped step emits step_start.
    collector.handleEvent(ev({
      type: "step_cache_miss",
      workflowId: "w1",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 1001,
    }));
    collector.handleEvent(ev({
      type: "step_start",
      workflowId: "w1",
      stepId: "lookup-user",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 1002,
      metadata: { domain: "payments" },
    }));
    collector.handleEvent(ev({
      type: "step_success",
      workflowId: "w1",
      stepId: "lookup-user",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 1006,
      durationMs: 4,
    }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1010, durationMs: 10 }));

    const wide = collector.wideEvent();

    // Should be one logical step, not an orphan "cache:user:42" + "lookup-user" pair.
    expect(wide.steps).toHaveLength(1);
    expect(wide.steps[0]).toMatchObject({
      stepId: "lookup-user",
      key: "cache:user:42",
      status: "success",
      domain: "payments",
    });
    expect(wide.integrityWarnings ?? []).not.toContain(
      'No step_start seen for step "cache:user:42"'
    );
  });

  it("does not merge unrelated real steps when one stepId equals another stepKey", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    // Real step A whose stepId collides with step B's custom stepKey.
    collector.handleEvent(ev({
      type: "step_start",
      workflowId: "w1",
      stepId: "cache:user:42",
      name: "existing-step",
      ts: 1001,
      metadata: { domain: "identity" },
    }));
    collector.handleEvent(ev({
      type: "step_success",
      workflowId: "w1",
      stepId: "cache:user:42",
      name: "existing-step",
      ts: 1003,
      durationMs: 2,
    }));

    // Real execution order for step B: cache miss first, then step_start.
    collector.handleEvent(ev({
      type: "step_cache_miss",
      workflowId: "w1",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 1004,
    }));
    collector.handleEvent(ev({
      type: "step_start",
      workflowId: "w1",
      stepId: "lookup-user",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 1005,
      metadata: { domain: "payments" },
    }));
    collector.handleEvent(ev({
      type: "step_success",
      workflowId: "w1",
      stepId: "lookup-user",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 1007,
      durationMs: 2,
    }));

    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1010, durationMs: 10 }));
    const wide = collector.wideEvent();

    // Must preserve both logical steps.
    expect(wide.steps).toHaveLength(2);
    expect(wide.steps.some((s) => s.stepId === "cache:user:42")).toBe(true);
    expect(wide.steps.some((s) => s.stepId === "lookup-user")).toBe(true);
  });

  it("does not treat startTs=0 as orphan during stepKey collision merge", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 0 }));

    // Real step A starts at Unix epoch (ts=0), which is falsy.
    collector.handleEvent(ev({
      type: "step_start",
      workflowId: "w1",
      stepId: "cache:user:42",
      name: "existing-step",
      ts: 0,
      metadata: { domain: "identity" },
    }));
    collector.handleEvent(ev({
      type: "step_success",
      workflowId: "w1",
      stepId: "cache:user:42",
      name: "existing-step",
      ts: 2,
      durationMs: 2,
    }));

    collector.handleEvent(ev({
      type: "step_cache_miss",
      workflowId: "w1",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 3,
    }));
    collector.handleEvent(ev({
      type: "step_start",
      workflowId: "w1",
      stepId: "lookup-user",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 4,
      metadata: { domain: "payments" },
    }));
    collector.handleEvent(ev({
      type: "step_success",
      workflowId: "w1",
      stepId: "lookup-user",
      stepKey: "cache:user:42",
      name: "lookup",
      ts: 6,
      durationMs: 2,
    }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 10, durationMs: 10 }));

    const wide = collector.wideEvent();
    expect(wide.steps).toHaveLength(2);
    expect(wide.steps.some((s) => s.stepId === "cache:user:42")).toBe(true);
    expect(wide.steps.some((s) => s.stepId === "lookup-user")).toBe(true);
  });

  it("does not let a later cache-hit with same key overwrite prior step terminal status", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    // First step (uncached path): miss -> start -> success
    collector.handleEvent(ev({
      type: "step_cache_miss",
      workflowId: "w1",
      stepKey: "shared:key",
      name: "firstCall",
      ts: 1001,
    }));
    collector.handleEvent(ev({
      type: "step_start",
      workflowId: "w1",
      stepId: "step-a",
      stepKey: "shared:key",
      name: "firstCall",
      ts: 1002,
    }));
    collector.handleEvent(ev({
      type: "step_success",
      workflowId: "w1",
      stepId: "step-a",
      stepKey: "shared:key",
      name: "firstCall",
      ts: 1004,
      durationMs: 2,
    }));

    // Second logical step uses same key and hits cache.
    collector.handleEvent(ev({
      type: "step_cache_hit",
      workflowId: "w1",
      stepKey: "shared:key",
      name: "secondCall",
      ts: 1005,
    }));

    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1010, durationMs: 10 }));
    const wide = collector.wideEvent();

    // Prior completed step should remain success.
    const first = wide.steps.find((s) => s.stepId === "step-a");
    expect(first).toBeDefined();
    expect(first!.status).toBe("success");
  });

  // -----------------------------------------------------------------------
  // 10. summary.bySeverity
  // -----------------------------------------------------------------------
  it("counts errors by severity", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "a", ts: 1001 }));
    collector.handleEvent(ev({
      type: "step_error", workflowId: "w1", stepId: "s1", name: "a", ts: 1010, durationMs: 9,
      error: new Error("e1"),
      diagnostics: { tag: "DB_DOWN", classification: { severity: "infrastructure" }, origin: "throw" },
    }));

    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s2", name: "b", ts: 1011 }));
    collector.handleEvent(ev({
      type: "step_error", workflowId: "w1", stepId: "s2", name: "b", ts: 1020, durationMs: 9,
      error: new Error("e2"),
      diagnostics: { tag: "INVALID_INPUT", classification: { severity: "validation" }, origin: "result" },
    }));

    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s3", name: "c", ts: 1021 }));
    collector.handleEvent(ev({
      type: "step_error", workflowId: "w1", stepId: "s3", name: "c", ts: 1030, durationMs: 9,
      error: new Error("e3"),
      diagnostics: { tag: "DB_TIMEOUT", classification: { severity: "infrastructure" }, origin: "throw" },
    }));

    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 1040, durationMs: 40, error: new Error("fail") }));

    const wide = collector.wideEvent();
    expect(wide.summary.bySeverity).toEqual({
      infrastructure: 2,
      validation: 1,
    });
  });

  // -----------------------------------------------------------------------
  // 11. summary.topFailingTags
  // -----------------------------------------------------------------------
  it("sorts topFailingTags by count descending", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));

    // Two DB_DOWN errors, one CARD_DECLINED
    for (let i = 0; i < 3; i++) {
      const id = `s${i}`;
      const tag = i < 2 ? "DB_DOWN" : "CARD_DECLINED";
      collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: id, name: id, ts: 1001 + i * 10 }));
      collector.handleEvent(ev({
        type: "step_error", workflowId: "w1", stepId: id, name: id, ts: 1005 + i * 10, durationMs: 4,
        error: new Error(tag),
        diagnostics: { tag, origin: "throw" },
      }));
    }

    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 2000, durationMs: 1000, error: new Error("fail") }));

    const wide = collector.wideEvent();
    expect(wide.summary.topFailingTags).toEqual([
      { tag: "DB_DOWN", count: 2 },
      { tag: "CARD_DECLINED", count: 1 },
    ]);
  });

  // -----------------------------------------------------------------------
  // 12. Stack capture omitted by default, included with includeStacks
  // -----------------------------------------------------------------------
  it("omits stack by default", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "a", ts: 1001 }));
    collector.handleEvent(ev({
      type: "step_error", workflowId: "w1", stepId: "s1", name: "a", ts: 1010, durationMs: 9,
      error: new Error("boom"),
      diagnostics: { tag: "ERR", origin: "throw" },
    }));
    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 1020, durationMs: 20, error: new Error("boom") }));

    const wide = collector.wideEvent();
    expect(wide.steps[0].error?.stack).toBeUndefined();
    expect(wide.error?.stack).toBeUndefined();
  });

  it("includes stack when includeStacks is true", () => {
    const collector = createDiagnosticsCollector({ includeStacks: true });
    const err = new Error("boom");
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "a", ts: 1001 }));
    collector.handleEvent(ev({
      type: "step_error", workflowId: "w1", stepId: "s1", name: "a", ts: 1010, durationMs: 9,
      error: err,
      diagnostics: { tag: "ERR", origin: "throw" },
    }));
    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 1020, durationMs: 20, error: err }));

    const wide = collector.wideEvent();
    expect(wide.steps[0].error?.stack).toBeDefined();
    expect(wide.steps[0].error!.stack!.length).toBeGreaterThan(0);
    expect(wide.error?.stack).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 13. Stack best-effort: absent for non-Error thrown values
  // -----------------------------------------------------------------------
  it("does not include stack for non-Error thrown values even with includeStacks", () => {
    const collector = createDiagnosticsCollector({ includeStacks: true });
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "a", ts: 1001 }));
    collector.handleEvent(ev({
      type: "step_error", workflowId: "w1", stepId: "s1", name: "a", ts: 1010, durationMs: 9,
      error: "string error",
      diagnostics: { tag: "STR_ERR", origin: "throw" },
    }));
    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 1020, durationMs: 20, error: "string error" }));

    const wide = collector.wideEvent();
    expect(wide.steps[0].error?.stack).toBeUndefined();
    expect(wide.error?.stack).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 14. redact callback
  // -----------------------------------------------------------------------
  it("passes wide event through redact callback", () => {
    const collector = createDiagnosticsCollector({
      redact: (event) => ({
        ...event,
        workflowId: "REDACTED",
      }),
    });
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1100, durationMs: 100 }));

    const wide = collector.wideEvent();
    expect(wide.workflowId).toBe("REDACTED");
  });

  // -----------------------------------------------------------------------
  // 15. reset()
  // -----------------------------------------------------------------------
  it("reset() clears all state", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "a", ts: 1001 }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", name: "a", ts: 1050, durationMs: 49 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1100, durationMs: 100 }));

    collector.reset();

    const wide = collector.wideEvent();
    expect(wide.workflowId).toBe("unknown");
    expect(wide.steps).toHaveLength(0);
    expect(wide.summary.totalSteps).toBe(0);
    expect(wide.integrityWarnings).toContain("wideEvent() called before workflow terminal event");
  });

  // -----------------------------------------------------------------------
  // 16. Workflow cancelled status mapping
  // -----------------------------------------------------------------------
  it("maps workflow_cancelled → cancelled status", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({
      type: "workflow_cancelled",
      workflowId: "w1",
      ts: 1500,
      durationMs: 500,
    }));

    const wide = collector.wideEvent();
    expect(wide.status).toBe("cancelled");
    expect(wide.error).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // 17. step_timeout as last event (no terminal after) → status 'error', timedOut: true
  // -----------------------------------------------------------------------
  it("step with only step_timeout and no terminal → status error with timedOut", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_start", workflowId: "w1", stepId: "s1", name: "slow", ts: 1001 }));
    collector.handleEvent(ev({
      type: "step_timeout",
      workflowId: "w1",
      stepId: "s1",
      name: "slow",
      ts: 6001,
      timeoutMs: 5000,
    }));
    // No step terminal event after timeout
    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 6010, durationMs: 5010, error: new Error("timeout") }));

    const wide = collector.wideEvent();
    const step = wide.steps[0];
    expect(step.status).toBe("error");
    expect(step.timedOut).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Extra: workflow error field from workflowError
  // -----------------------------------------------------------------------
  it("extracts workflow-level error info", () => {
    const err = Object.assign(new Error("big boom"), { _tag: "FATAL_CRASH" });
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "workflow_error", workflowId: "w1", ts: 1100, durationMs: 100, error: err }));

    const wide = collector.wideEvent();
    expect(wide.error?.tag).toBe("FATAL_CRASH");
  });

  // -----------------------------------------------------------------------
  // Extra: step key is captured
  // -----------------------------------------------------------------------
  it("captures stepKey in wide event step entry", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({
      type: "step_start", workflowId: "w1", stepId: "s1", stepKey: "charge-key", name: "charge", ts: 1001,
    }));
    collector.handleEvent(ev({ type: "step_success", workflowId: "w1", stepId: "s1", stepKey: "charge-key", name: "charge", ts: 1050, durationMs: 49 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1100, durationMs: 100 }));

    const wide = collector.wideEvent();
    expect(wide.steps[0].key).toBe("charge-key");
  });

  // -----------------------------------------------------------------------
  // Extra: cacheHits counter
  // -----------------------------------------------------------------------
  it("increments cacheHits counter for step_cache_hit", () => {
    const collector = createDiagnosticsCollector();
    collector.handleEvent(ev({ type: "workflow_start", workflowId: "w1", ts: 1000 }));
    collector.handleEvent(ev({ type: "step_cache_hit", workflowId: "w1", stepKey: "sk1", name: "a", ts: 1005 }));
    collector.handleEvent(ev({ type: "step_cache_hit", workflowId: "w1", stepKey: "sk2", name: "b", ts: 1006 }));
    collector.handleEvent(ev({ type: "workflow_success", workflowId: "w1", ts: 1020, durationMs: 20 }));

    const wide = collector.wideEvent();
    expect(wide.summary.cacheHits).toBe(2);
  });
});
