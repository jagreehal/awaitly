import { describe, expect, it } from "vitest";
import * as root from "./index";
import * as resultEntry from "./result";
import * as workflowEntry from "./workflow-entry";
import * as runEntry from "./run-entry";
import * as reliabilityEntry from "./reliability-entry";
import * as durableEntry from "./durable-entry";
import * as persistenceEntry from "./persistence-entry";
import * as sagaEntry from "./saga-entry";
import * as hitlEntry from "./hitl-entry";
import * as streamingEntry from "./streaming-entry";
import * as webhookEntry from "./webhook-entry";
import * as engineEntry from "./engine-entry";

/**
 * Canonical surface contract.
 *
 * There is no `Awaitly` namespace object — one way to write it: named
 * imports. These tests pin the canonical names at each entry and that
 * shared names resolve to the same declarations across entries.
 */
describe("canonical root exports", () => {
  it("exports the Result primitives", () => {
    expect(root.ok(1)).toEqual({ ok: true, value: 1 });
    expect(root.err("E")).toEqual({ ok: false, error: "E" });
    expect(root.isOk(root.ok(1))).toBe(true);
    expect(root.isErr(root.err("E"))).toBe(true);
    expect(typeof root.flatten).toBe("function");
    expect(typeof root.deserialize).toBe("function");
    expect(root.DESERIALIZATION_ERROR).toBeDefined();
  });

  it("exports the engine and per-dep policies", () => {
    expect(typeof root.run).toBe("function");
    expect(typeof root.run.strict).toBe("function");
    expect(typeof root.retry).toBe("function");
    expect(typeof root.timeout).toBe("function");
    expect(typeof root.fallback).toBe("function");
  });

  it("exports the absorbed canonical modules", () => {
    // errors (formerly awaitly/errors)
    expect(typeof root.TimeoutError).toBe("function");
    expect(typeof root.makeError).toBe("function");
    // durations (formerly awaitly/duration)
    expect(typeof root.seconds).toBe("function");
    expect(typeof root.toMillis).toBe("function");
    // match (formerly awaitly/match; clashing names pre-renamed)
    expect(typeof root.matchValue).toBe("function");
    expect(root.Match).toBeDefined();
    // reliability instances (formerly awaitly/circuit-breaker, awaitly/ratelimit)
    expect(typeof root.createCircuitBreaker).toBe("function");
    expect(typeof root.createRateLimiter).toBe("function");
    // caching + dedupe (formerly awaitly/cache, awaitly/singleflight)
    expect(typeof root.createCache).toBe("function");
  });

  it("does not export the removed dialects", () => {
    const removed = ["Awaitly", "pipe", "flow", "compose", "identity", "R"];
    for (const name of removed) {
      expect((root as Record<string, unknown>)[name], name).toBeUndefined();
    }
  });

  it("keeps root and result entries sharing the same primitive declarations", () => {
    expect(root.ok).toBe(resultEntry.ok);
    expect(root.err).toBe(resultEntry.err);
    expect(root.isUnexpectedError).toBe(resultEntry.isUnexpectedError);
  });

  it("exports UnexpectedError from the workflow entrypoint", () => {
    expect(workflowEntry.UnexpectedError).toBe(root.UnexpectedError);
  });

  it("exports the production tier from the workflow entry", () => {
    const wf = workflowEntry as Record<string, unknown>;
    for (const name of [
      "createWorkflow",
      "isPendingApproval",
      "injectApproval",
      "validateSnapshot",
      "processInBatches",
      "withScope",
    ]) {
      expect(wf[name], name).toBeDefined();
    }

    for (const name of ["durable", "createSagaWorkflow", "createEngine", "createMemoryStreamStore"]) {
      expect(wf[name], name).toBeUndefined();
    }
  });

  it("gives each production module a focused public seam", () => {
    expect(runEntry.run).toBe(root.run);

    expect(typeof reliabilityEntry.retry).toBe("function");
    expect(typeof reliabilityEntry.createCircuitBreaker).toBe("function");
    expect(typeof reliabilityEntry.createRateLimiter).toBe("function");
    expect(typeof reliabilityEntry.createCache).toBe("function");
    expect(typeof reliabilityEntry.singleflight).toBe("function");

    expect(typeof durableEntry.durable).toBe("object");
    expect(typeof durableEntry.validateSnapshot).toBe("function");
    expect(typeof durableEntry.createVersionedState).toBe("function");

    expect(typeof persistenceEntry.validateSnapshot).toBe("function");
    expect(typeof persistenceEntry.createVersionedState).toBe("function");
    expect((persistenceEntry as Record<string, unknown>).durable).toBeUndefined();

    expect(typeof sagaEntry.createSagaWorkflow).toBe("function");
    expect(typeof hitlEntry.createHITLOrchestrator).toBe("function");
    expect(typeof streamingEntry.createMemoryStreamStore).toBe("function");
    expect(typeof webhookEntry.createWebhookHandler).toBe("function");
    expect(typeof engineEntry.createEngine).toBe("function");
  });
});
