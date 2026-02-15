import { describe, it, expect, vi } from "vitest";
import {
  createAutotelAdapter,
  createAutotelEventHandler,
  withAutotelTracing,
} from "./autotel";

describe("Autotel Adapter", () => {
  describe("createAutotelAdapter", () => {
    it("should create an adapter instance", () => {
      const adapter = createAutotelAdapter({ serviceName: "checkout" });
      expect(adapter).toBeDefined();
      expect(adapter.handleEvent).toBeInstanceOf(Function);
      expect(adapter.getMetrics).toBeInstanceOf(Function);
    });

    it("should track workflow start/end", () => {
      const adapter = createAutotelAdapter({ serviceName: "checkout" });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      expect(adapter.getActiveSpansCount().workflows).toBe(1);

      adapter.handleEvent({
        type: "workflow_success",
        workflowId: "wf-1",
        ts: Date.now(),
        durationMs: 100,
      });

      expect(adapter.getActiveSpansCount().workflows).toBe(0);
    });

    it("should track step start/success", () => {
      const adapter = createAutotelAdapter({ serviceName: "checkout" });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        stepKey: "user:1",
        ts: Date.now(),
      });

      expect(adapter.getActiveSpansCount().steps).toBe(1);

      adapter.handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        stepKey: "user:1",
        ts: Date.now(),
        durationMs: 45,
      });

      expect(adapter.getActiveSpansCount().steps).toBe(0);
    });

    it("should record step durations in metrics", () => {
      const adapter = createAutotelAdapter({ serviceName: "checkout" });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
        durationMs: 45,
      });

      const metrics = adapter.getMetrics();
      expect(metrics.stepDurations).toHaveLength(1);
      expect(metrics.stepDurations[0].durationMs).toBe(45);
      expect(metrics.stepDurations[0].success).toBe(true);
    });

    it("should track errors", () => {
      const adapter = createAutotelAdapter({ serviceName: "checkout" });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_error",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
        durationMs: 45,
        error: { code: "NOT_FOUND" },
      });

      const metrics = adapter.getMetrics();
      expect(metrics.errorCount).toBe(1);
      expect(metrics.stepDurations[0].success).toBe(false);
    });

    it("should track retries", () => {
      const adapter = createAutotelAdapter({ serviceName: "checkout" });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_retry",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
        attempt: 1,
        maxAttempts: 3,
        error: "timeout",
        delayMs: 1000,
      });

      adapter.handleEvent({
        type: "step_retry",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
        attempt: 2,
        maxAttempts: 3,
        error: "timeout",
        delayMs: 2000,
      });

      const metrics = adapter.getMetrics();
      expect(metrics.retryCount).toBe(2);
    });

    it("should track cache hits and misses", () => {
      const adapter = createAutotelAdapter({ serviceName: "checkout" });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_cache_hit",
        workflowId: "wf-1",
        stepKey: "user:1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_cache_miss",
        workflowId: "wf-1",
        stepKey: "user:2",
        ts: Date.now(),
      });

      const metrics = adapter.getMetrics();
      expect(metrics.cacheHits).toBe(1);
      expect(metrics.cacheMisses).toBe(1);
    });

    it("should include default attributes in metrics", () => {
      const adapter = createAutotelAdapter({
        serviceName: "checkout",
        defaultAttributes: {
          environment: "production",
          version: "1.0.0",
        },
      });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_success",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
        durationMs: 45,
      });

      const metrics = adapter.getMetrics();
      expect(metrics.defaultAttributes).toEqual({
        environment: "production",
        version: "1.0.0",
      });
      expect(metrics.stepDurations[0].attributes).toEqual({
        environment: "production",
        version: "1.0.0",
      });
    });

    it("should respect createStepSpans option", () => {
      const adapter = createAutotelAdapter({
        serviceName: "checkout",
        createStepSpans: false,
      });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
      });

      // Should not track step when createStepSpans is false
      expect(adapter.getActiveSpansCount().steps).toBe(0);
    });

    it("should reset metrics", () => {
      const adapter = createAutotelAdapter({ serviceName: "checkout" });

      adapter.handleEvent({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      adapter.handleEvent({
        type: "step_retry",
        workflowId: "wf-1",
        stepId: "step-1",
        ts: Date.now(),
        attempt: 1,
        maxAttempts: 3,
        error: "timeout",
        delayMs: 1000,
      });

      adapter.reset();

      const metrics = adapter.getMetrics();
      expect(metrics.retryCount).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.cacheHits).toBe(0);
      expect(metrics.stepDurations).toHaveLength(0);
    });
  });

  describe("createAutotelEventHandler", () => {
    it("should create an event handler function", () => {
      const handler = createAutotelEventHandler({ serviceName: "checkout" });
      expect(handler).toBeInstanceOf(Function);
    });

    it("should log events when AUTOTEL_DEBUG is set", () => {
      const originalEnv = process.env.AUTOTEL_DEBUG;
      process.env.AUTOTEL_DEBUG = "true";

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const handler = createAutotelEventHandler({ serviceName: "checkout" });

      handler({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0][0] as string;
      expect(call).toContain("[checkout]");
      expect(call).toContain("Workflow started");

      consoleSpy.mockRestore();
      process.env.AUTOTEL_DEBUG = originalEnv;
    });

    it("should not log when AUTOTEL_DEBUG is not set", () => {
      const originalEnv = process.env.AUTOTEL_DEBUG;
      delete process.env.AUTOTEL_DEBUG;

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const handler = createAutotelEventHandler({ serviceName: "checkout" });

      handler({
        type: "workflow_start",
        workflowId: "wf-1",
        ts: Date.now(),
      });

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      process.env.AUTOTEL_DEBUG = originalEnv;
    });

    it("should log step details when includeStepDetails is true", () => {
      const originalEnv = process.env.AUTOTEL_DEBUG;
      process.env.AUTOTEL_DEBUG = "true";

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const handler = createAutotelEventHandler({
        serviceName: "checkout",
        includeStepDetails: true,
      });

      handler({
        type: "step_start",
        workflowId: "wf-1",
        stepId: "step-1",
        name: "Fetch user",
        ts: Date.now(),
      });

      expect(consoleSpy).toHaveBeenCalled();
      const call = consoleSpy.mock.calls[0][0] as string;
      expect(call).toContain("Fetch user");

      consoleSpy.mockRestore();
      process.env.AUTOTEL_DEBUG = originalEnv;
    });
  });

  describe("withAutotelTracing", () => {
    it("should wrap workflow execution with tracing", async () => {
      const mockTraceFn = vi.fn().mockImplementation(async (name, fn) => {
        return fn({ setAttribute: vi.fn() });
      });

      const traced = withAutotelTracing(mockTraceFn, { serviceName: "checkout" });

      const result = await traced("process-order", async () => {
        return { orderId: "123" };
      });

      expect(result).toEqual({ orderId: "123" });
      expect(mockTraceFn).toHaveBeenCalledWith(
        "checkout.process-order",
        expect.any(Function)
      );
    });

    it("should pass attributes to trace context", async () => {
      const setAttributeMock = vi.fn();
      const mockTraceFn = vi.fn().mockImplementation(async (name, fn) => {
        return fn({ setAttribute: setAttributeMock });
      });

      const traced = withAutotelTracing(mockTraceFn, { serviceName: "checkout" });

      await traced(
        "process-order",
        async () => ({ orderId: "123" }),
        { userId: "user-1", region: "us-east-1" }
      );

      expect(setAttributeMock).toHaveBeenCalledWith("userId", "user-1");
      expect(setAttributeMock).toHaveBeenCalledWith("region", "us-east-1");
    });

    it("should use default service name", async () => {
      const mockTraceFn = vi.fn().mockImplementation(async (name, fn) => {
        return fn({ setAttribute: vi.fn() });
      });

      const traced = withAutotelTracing(mockTraceFn);

      await traced("my-workflow", async () => "result");

      expect(mockTraceFn).toHaveBeenCalledWith(
        "workflow.my-workflow",
        expect.any(Function)
      );
    });
  });
});
