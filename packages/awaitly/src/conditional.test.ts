/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Tests for conditional.ts - when/unless helpers
 */
import { describe, it, expect, vi } from "vitest";
import { AsyncResult, err, ok } from "./index";
import { createWorkflow, run } from "./workflow-entry";
import {
  when,
  unless,
  whenOr,
  unlessOr,
  createConditionalHelpers,
  type ConditionalContext,
  type ConditionalOptions,
} from "./conditional";

describe("Conditional Helpers", () => {
  describe("when()", () => {
    it("executes operation when condition is true", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      const result = await when(true, operation);
      
      expect(operation).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it("skips operation when condition is false", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      const result = await when(false, operation);
      
      expect(operation).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("works with sync operations", () => {
      const operation = vi.fn(() => 42);
      const result = when(true, operation);
      
      expect(operation).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it("emits step_skipped event when condition is false and ctx provided", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflowId = "test-workflow";
      const onEvent = (event: WorkflowEvent<unknown>) => events.push(event);
      const ctx: ConditionalContext = { workflowId, onEvent };

      const operation = vi.fn(() => Promise.resolve(42));
      await when(false, operation, { name: "test-step", reason: "Condition false" }, ctx);

      expect(operation).not.toHaveBeenCalled();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("step_skipped");
      if (events[0].type === "step_skipped") {
        expect(events[0].name).toBe("test-step");
        expect(events[0].reason).toBe("Condition false");
        expect(events[0].workflowId).toBe(workflowId);
      }
    });

    it("does not emit event when ctx not provided", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      await when(false, operation, { name: "test-step" });

      expect(operation).not.toHaveBeenCalled();
      // No event emission without ctx
    });

    it("includes context in step_skipped event when provided", async () => {
      type RequestContext = { requestId: string; userId: string };
      const events: WorkflowEvent<unknown, RequestContext>[] = [];
      const workflowId = "test-workflow";
      const requestContext: RequestContext = { requestId: "req-123", userId: "user-456" };
      const onEvent = (event: WorkflowEvent<unknown, RequestContext>) => events.push(event);
      const ctx: ConditionalContext<RequestContext> = { workflowId, onEvent, context: requestContext };

      await when(false, () => Promise.resolve(42), { name: "test-step" }, ctx);

      expect(events.length).toBe(1);
      expect(events[0].context).toBeDefined();
      expect(events[0].context?.requestId).toBe("req-123");
      expect(events[0].context?.userId).toBe("user-456");
    });
  });

  describe("unless()", () => {
    it("executes operation when condition is false", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      const result = await unless(false, operation);
      
      expect(operation).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it("skips operation when condition is true", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      const result = await unless(true, operation);
      
      expect(operation).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("emits step_skipped event when condition is true and ctx provided", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflowId = "test-workflow";
      const onEvent = (event: WorkflowEvent<unknown>) => events.push(event);
      const ctx: ConditionalContext = { workflowId, onEvent };

      const operation = vi.fn(() => Promise.resolve(42));
      await unless(true, operation, { name: "test-step", reason: "Condition true" }, ctx);

      expect(operation).not.toHaveBeenCalled();
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("step_skipped");
    });
  });

  describe("whenOr()", () => {
    it("executes operation when condition is true", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      const result = await whenOr(true, operation, 0);
      
      expect(operation).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it("returns default value when condition is false", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      const defaultValue = { maxRequests: 100, maxStorage: 1000 };
      const result = await whenOr(false, operation, defaultValue);
      
      expect(operation).not.toHaveBeenCalled();
      expect(result).toEqual(defaultValue);
    });

    it("emits step_skipped event when condition is false and ctx provided", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflowId = "test-workflow";
      const onEvent = (event: WorkflowEvent<unknown>) => events.push(event);
      const ctx: ConditionalContext = { workflowId, onEvent };

      await whenOr(false, () => Promise.resolve(42), 0, { name: "test-step" }, ctx);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("step_skipped");
    });

    it("includes context in step_skipped event", async () => {
      type RequestContext = { requestId: string };
      const events: WorkflowEvent<unknown, RequestContext>[] = [];
      const workflowId = "test-workflow";
      const requestContext: RequestContext = { requestId: "req-123" };
      const onEvent = (event: WorkflowEvent<unknown, RequestContext>) => events.push(event);
      const ctx: ConditionalContext<RequestContext> = { workflowId, onEvent, context: requestContext };

      await whenOr(false, () => Promise.resolve(42), 0, { name: "test-step" }, ctx);

      expect(events[0].context?.requestId).toBe("req-123");
    });
  });

  describe("unlessOr()", () => {
    it("executes operation when condition is false", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      const result = await unlessOr(false, operation, 0);
      
      expect(operation).toHaveBeenCalledTimes(1);
      expect(result).toBe(42);
    });

    it("returns default value when condition is true", async () => {
      const operation = vi.fn(() => Promise.resolve(42));
      const defaultValue = "default";
      const result = await unlessOr(true, operation, defaultValue);
      
      expect(operation).not.toHaveBeenCalled();
      expect(result).toBe(defaultValue);
    });

    it("emits step_skipped event when condition is true and ctx provided", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflowId = "test-workflow";
      const onEvent = (event: WorkflowEvent<unknown>) => events.push(event);
      const ctx: ConditionalContext = { workflowId, onEvent };

      await unlessOr(true, () => Promise.resolve(42), 0, { name: "test-step" }, ctx);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("step_skipped");
    });
  });

  describe("createConditionalHelpers()", () => {
    it("creates bound helpers with context", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflowId = "test-workflow";
      const onEvent = (event: WorkflowEvent<unknown>) => events.push(event);
      const ctx: ConditionalContext = { workflowId, onEvent };

      const { when, unless, whenOr, unlessOr } = createConditionalHelpers(ctx);

      // Test when
      await when(false, () => Promise.resolve(42), { name: "when-test" });
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("step_skipped");

      // Test unless
      await unless(true, () => Promise.resolve(42), { name: "unless-test" });
      expect(events.length).toBe(2);
      expect(events[1].type).toBe("step_skipped");

      // Test whenOr
      await whenOr(false, () => Promise.resolve(42), 0, { name: "whenOr-test" });
      expect(events.length).toBe(3);
      expect(events[2].type).toBe("step_skipped");

      // Test unlessOr
      await unlessOr(true, () => Promise.resolve(42), 0, { name: "unlessOr-test" });
      expect(events.length).toBe(4);
      expect(events[3].type).toBe("step_skipped");
    });

    it("includes context in events when provided", async () => {
      type RequestContext = { requestId: string; userId: string };
      const events: WorkflowEvent<unknown, RequestContext>[] = [];
      const workflowId = "test-workflow";
      const requestContext: RequestContext = { requestId: "req-123", userId: "user-456" };
      const onEvent = (event: WorkflowEvent<unknown, RequestContext>) => events.push(event);
      const ctx: ConditionalContext<RequestContext> = { workflowId, onEvent, context: requestContext };

      const { when } = createConditionalHelpers(ctx);
      await when(false, () => Promise.resolve(42), { name: "test-step" });

      expect(events.length).toBe(1);
      expect(events[0].context).toBeDefined();
      expect(events[0].context?.requestId).toBe("req-123");
      expect(events[0].context?.userId).toBe("user-456");
    });

    it("works with run() integration", async () => {
      type RequestContext = { requestId: string };
      const events: WorkflowEvent<unknown, RequestContext>[] = [];
      const requestContext: RequestContext = { requestId: "req-123" };
      const workflowId = "test-workflow";
      const onEvent = (event: WorkflowEvent<unknown, RequestContext>) => events.push(event);

      const result = await run(async (step) => {
        const ctx: ConditionalContext<RequestContext> = { workflowId, onEvent, context: requestContext };
        const { when } = createConditionalHelpers(ctx);

        const user = await step('fetchUser', () => ok({ id: "1", isPremium: false }));

        const premium = await when(
          user.isPremium,
          () => step('fetchPremiumFeatures', () => ok({ features: ["feature1"] })),
          { name: "premium-data", reason: "User is not premium" }
        );

        return { user, premium };
      }, { onEvent, workflowId, context: requestContext });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.premium).toBeUndefined();
      }

      // Should have step_skipped event with context
      const skippedEvent = events.find(e => e.type === "step_skipped");
      expect(skippedEvent).toBeDefined();
      if (skippedEvent && skippedEvent.type === "step_skipped") {
        expect(skippedEvent.name).toBe("premium-data");
        expect(skippedEvent.reason).toBe("User is not premium");
        expect(skippedEvent.context?.requestId).toBe("req-123");
      }
    });

    it("does not add context property when context is undefined", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const workflowId = "test-workflow";
      const onEvent = (event: WorkflowEvent<unknown>) => events.push(event);
      const ctx: ConditionalContext = { workflowId, onEvent };
      // Note: ctx.context is undefined

      const { when } = createConditionalHelpers(ctx);
      await when(false, () => Promise.resolve(42), { name: "test-step" });

      expect(events.length).toBe(1);
      // Should not have context property when context is undefined
      expect("context" in events[0]).toBe(false);
    });
  });

  describe("Integration with createWorkflow", () => {
    it("works without ctx parameter (no events emitted)", async () => {
      const events: WorkflowEvent<unknown>[] = [];
      const fetchUser = async (): AsyncResult<{ id: string; isPremium: boolean }, never> => 
        ok({ id: "1", isPremium: false });

      const workflow = createWorkflow("workflow", { fetchUser }, {
        onEvent: (event) => events.push(event),
      });

      await workflow(async (step) => {
        const user = await step('fetchUser', () => fetchUser());

        // Use conditional helper without ctx - no step_skipped events
        const premium = await when(
          user.isPremium,
          () => step('fetchPremiumFeatures', () => ok({ features: [] })),
          { name: "premium-data" }
        );

        return { user, premium };
      });

      // Should not have step_skipped events
      const skippedEvents = events.filter(e => e.type === "step_skipped");
      expect(skippedEvents.length).toBe(0);
    });

    it("works with ctx parameter from WorkflowContext (events emitted)", async () => {
      type RequestContext = { requestId: string };
      const events: WorkflowEvent<unknown, RequestContext>[] = [];
      const fetchUser = async (): AsyncResult<{ id: string; isPremium: boolean }, never> => 
        ok({ id: "1", isPremium: false });

      const workflow = createWorkflow("workflow", { fetchUser }, {
        createContext: (): RequestContext => ({ requestId: "req-123" }),
        onEvent: (event) => events.push(event),
      });

      await workflow(async (step, deps, ctx) => {
        const user = await step('fetchUser', () => fetchUser());

        // ctx can be passed directly to createConditionalHelpers (same shape)
        const { when } = createConditionalHelpers(ctx);

        const premium = await when(
          user.isPremium,
          () => step('fetchPremiumFeatures', () => ok({ features: [] })),
          { name: "premium-data", reason: "User is not premium" }
        );

        return { user, premium };
      });

      // Should have step_skipped event with context
      const skippedEvents = events.filter(e => e.type === "step_skipped");
      expect(skippedEvents.length).toBe(1);
      expect(skippedEvents[0].context?.requestId).toBe("req-123");
    });

    it("ctx parameter can be ignored (backward compatible)", async () => {
      const fetchUser = async (): AsyncResult<{ id: string }, never> => ok({ id: "1" });

      const workflow = createWorkflow("workflow", { fetchUser });

      // Code that doesn't use ctx parameter still works (TypeScript allows unused parameters)
      const result = await workflow(async (step) => {
        const user = await step('fetchUser', () => fetchUser());
        return user;
      });

      expect(result.ok).toBe(true);
    });
  });
});