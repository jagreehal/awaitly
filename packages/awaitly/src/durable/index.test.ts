import { describe, it, expect, vi } from "vitest";
import { ok, err, type AsyncResult } from "../core";
import {
  durable,
  isVersionMismatch,
  isConcurrentExecution,
  isWorkflowCancelled,
  isPersistenceError,
  type DurableWorkflowEvent,
  type SnapshotStore,
} from ".";
import type { WorkflowSnapshot } from "../persistence";

// Helper functions for testing
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Test helper: Create an in-memory SnapshotStore for testing
function createTestSnapshotStore(): SnapshotStore {
  const store = new Map<string, { snapshot: WorkflowSnapshot; updatedAt: Date }>();
  return {
    async save(id: string, snapshot: WorkflowSnapshot): Promise<void> {
      store.set(id, { snapshot, updatedAt: new Date() });
    },
    async load(id: string): Promise<WorkflowSnapshot | null> {
      const entry = store.get(id);
      return entry ? entry.snapshot : null;
    },
    async delete(id: string): Promise<void> {
      store.delete(id);
    },
    async list(options?: { prefix?: string; limit?: number }): Promise<Array<{ id: string; updatedAt: string }>> {
      const entries = Array.from(store.entries())
        .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
        .map(([id, { updatedAt }]) => ({ id, updatedAt: updatedAt.toISOString() }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return options?.limit ? entries.slice(0, options.limit) : entries;
    },
    async close(): Promise<void> {},
  };
}

async function fetchUser(id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> {
  if (id === "unknown") return err("NOT_FOUND");
  return ok({ id, name: `User ${id}` });
}

async function createOrder(
  userId: string
): AsyncResult<{ orderId: string; userId: string }, "CREATE_FAILED"> {
  if (userId === "fail") return err("CREATE_FAILED");
  return ok({ orderId: `order-${userId}`, userId });
}

async function sendEmail(orderId: string): AsyncResult<{ sent: boolean }, "EMAIL_FAILED"> {
  if (orderId === "order-fail") return err("EMAIL_FAILED");
  return ok({ sent: true });
}

describe("Durable Execution", () => {
  describe("durable.run", () => {
    it("should execute workflow and clean up state on success", async () => {
      const store = createTestSnapshotStore();

      const result = await durable.run(
        { fetchUser, createOrder, sendEmail },
        async ({ step, deps: { fetchUser, createOrder, sendEmail } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          const order = await step("create-order", () => createOrder(user.id));
          await step("send-email", () => sendEmail(order.orderId));
          return order;
        },
        {
          id: "test-workflow-1",
          store,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.orderId).toBe("order-123");
      }

      // State should be cleaned up on success
      const hasState = await durable.hasState(store, "test-workflow-1");
      expect(hasState).toBe(false);
    });

    it("succeeds without passing store (uses default in-memory store)", async () => {
      const result = await durable.run(
        { fetchUser, createOrder, sendEmail },
        async ({ step, deps: { fetchUser, createOrder, sendEmail } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          const order = await step("create-order", () => createOrder(user.id));
          await step("send-email", () => sendEmail(order.orderId));
          return order;
        },
        { id: "no-store-test" }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.orderId).toBe("order-123");
      }
    });

    it("default store: second run with same id reuses cached step (side effect runs once)", async () => {
      let keyedStepCalls = 0;
      async function stepWithSideEffect(): AsyncResult<string, never> {
        keyedStepCalls++;
        return ok("cached");
      }
      async function failingStep(): AsyncResult<never, "FAIL"> {
        return err("FAIL");
      }

      const id = "default-store-resume-test";

      const result1 = await durable.run(
        { stepWithSideEffect, failingStep },
        async ({ step, deps: { stepWithSideEffect, failingStep } }) => {
          const value = await step("side-effect-step", () => stepWithSideEffect());
          await step("fail-step", () => failingStep());
          return value;
        },
        { id }
      );

      expect(result1.ok).toBe(false);
      expect(keyedStepCalls).toBe(1);

      const result2 = await durable.run(
        { stepWithSideEffect, failingStep },
        async ({ step, deps: { stepWithSideEffect, failingStep } }) => {
          const value = await step("side-effect-step", () => stepWithSideEffect());
          await step("fail-step", () => failingStep());
          return value;
        },
        { id }
      );

      expect(result2.ok).toBe(false);
      expect(keyedStepCalls).toBe(1);
    });

    it("should persist state after each keyed step", async () => {
      const store = createTestSnapshotStore();
      const events: DurableWorkflowEvent<unknown>[] = [];

      const result = await durable.run(
        { fetchUser, createOrder },
        async ({ step, deps: { fetchUser, createOrder } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          const order = await step("create-order", () => createOrder(user.id));
          return order;
        },
        {
          id: "test-workflow-persist",
          store,
          onEvent: (event) => events.push(event),
        }
      );

      expect(result.ok).toBe(true);

      // Should have persist_success events
      const persistEvents = events.filter((e) => e.type === "persist_success");
      expect(persistEvents.length).toBe(2);
    });

    it("should keep state on error for resume", async () => {
      const store = createTestSnapshotStore();

      const result = await durable.run(
        { fetchUser, createOrder },
        async ({ step, deps: { fetchUser, createOrder } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          // This will fail
          await step("create-order", () => createOrder("fail"));
          return user;
        },
        {
          id: "test-workflow-error",
          store,
        }
      );

      expect(result.ok).toBe(false);

      // State should remain for resume
      const hasState = await durable.hasState(store, "test-workflow-error");
      expect(hasState).toBe(true);
    });

    it("should resume from saved state (skip completed steps)", async () => {
      const store = createTestSnapshotStore();
      let step1Count = 0;
      let step2Count = 0;

      async function step1Op(): AsyncResult<string, never> {
        step1Count++;
        return ok("step1-result");
      }

      async function step2Op(): AsyncResult<string, "STEP2_ERROR"> {
        step2Count++;
        return ok("step2-result");
      }

      // First run - completes successfully
      const result1 = await durable.run(
        { step1Op, step2Op },
        async ({ step, deps: { step1Op, step2Op } }) => {
          const r1 = await step("step-1", () => step1Op());
          const r2 = await step("step-2", () => step2Op());
          return { r1, r2 };
        },
        {
          id: "test-resume-success",
          store,
        }
      );

      expect(result1.ok).toBe(true);
      expect(step1Count).toBe(1);
      expect(step2Count).toBe(1);

      // State should be cleaned up on success
      expect(await durable.hasState(store, "test-resume-success")).toBe(false);

      // Test resume behavior: Manually populate state as if step-1 completed
      // but workflow didn't finish
      const partialSnapshot: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "step-1": { ok: true, value: "cached-step1-result" },
        },
        execution: { status: "running", lastUpdated: new Date().toISOString() },
      };
      await store.save("test-resume-partial", partialSnapshot);

      // Reset counters
      step1Count = 0;
      step2Count = 0;

      // Second run with partial state - step-1 should be skipped
      const result2 = await durable.run(
        { step1Op, step2Op },
        async ({ step, deps: { step1Op, step2Op } }) => {
          const r1 = await step("step-1", () => step1Op());
          const r2 = await step("step-2", () => step2Op());
          return { r1, r2 };
        },
        {
          id: "test-resume-partial",
          store,
        }
      );

      expect(result2.ok).toBe(true);
      // step1Op should NOT be called (cached from partial state)
      expect(step1Count).toBe(0);
      // step2Op should be called
      expect(step2Count).toBe(1);
      if (result2.ok) {
        // r1 should be from cache
        expect(result2.value.r1).toBe("cached-step1-result");
        expect(result2.value.r2).toBe("step2-result");
      }
    });

    it("full crash/restart/resume: fail after step 1, listPending, run by id, step 1 not re-run", async () => {
      const store = createTestSnapshotStore();
      const id = "crash-restart-demo";
      let counter = 0;

      async function firstStep(): AsyncResult<string, never> {
        counter++;
        return ok("first");
      }
      async function secondStep(): AsyncResult<never, "STEP2_FAIL"> {
        return err("STEP2_FAIL");
      }

      // Run 1: fails at step 2; step 1 ran once, state left in store
      const run1 = await durable.run(
        { firstStep, secondStep },
        async ({ step, deps: { firstStep, secondStep } }) => {
          await step("step-1", () => firstStep());
          await step("step-2", () => secondStep());
          return "done";
        },
        { id, store }
      );
      expect(run1.ok).toBe(false);
      expect(counter).toBe(1);
      expect(await durable.hasState(store, id)).toBe(true);

      // Simulate restart: no in-process state; discover pending from store
      const pendingIds = await durable.listPending(store);
      expect(pendingIds.map(p => p.id)).toContain(id);

      // Run 2 (resume): same id and store; step 1 must not run again
      const run2 = await durable.run(
        { firstStep, secondStep },
        async ({ step, deps: { firstStep, secondStep } }) => {
          await step("step-1", () => firstStep());
          await step("step-2", () => secondStep());
          return "done";
        },
        { id, store }
      );
      expect(counter).toBe(1);
      expect(run2.ok).toBe(false);
    });
  });

  describe("Version Checking", () => {
    it("should accept matching metadata version via snapshot metadata", async () => {
      const store = createTestSnapshotStore();

      // Save snapshot with version in metadata
      const snapshot: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "fetch-user": { ok: true, value: { id: "123", name: "User 123" } },
        },
        execution: { status: "completed", lastUpdated: new Date().toISOString() },
        metadata: { version: 2 },
      };
      await store.save("test-version-metadata", snapshot);

      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "test-version-metadata",
          store,
          version: 2,
        }
      );

      expect(result.ok).toBe(true);
    });

    it("should treat missing metadata version as default 1", async () => {
      const store = createTestSnapshotStore();

      // Save snapshot without version in metadata
      const snapshot: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "fetch-user": { ok: true, value: { id: "123", name: "User 123" } },
        },
        execution: { status: "completed", lastUpdated: new Date().toISOString() },
        // No metadata.version
      };
      await store.save("test-version-missing-meta", snapshot);

      // Try to run with version 2 - should be rejected as mismatch
      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "test-version-missing-meta",
          store,
          version: 2,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok && isVersionMismatch(result.error)) {
        expect(result.error.storedVersion).toBe(1);
        expect(result.error.requestedVersion).toBe(2);
        expect(result.error.workflowId).toBeDefined();
        expect(String(result.error.message)).toContain("durable.deleteState");
      } else {
        throw new Error("Expected VersionMismatchError");
      }
    });

    it("should reject resume when store cannot expose metadata version", async () => {
      const storeData = new Map<string, { state: { steps: Map<string, unknown> }; metadata?: Record<string, unknown> }>();
      const store = {
        save: vi.fn(async (runId, state, metadata) => {
          storeData.set(runId, { state, metadata });
        }),
        load: vi.fn(async (runId) => storeData.get(runId)?.state),
        delete: vi.fn(async () => true),
        list: vi.fn(async () => []),
      };

      // Save with version metadata, but store does not expose loadRaw
      const partialState = {
        steps: new Map([
          ["fetch-user", { result: ok({ id: "123", name: "User 123" }) }]
        ])
      };
      await store.save("test-version-no-raw", partialState, { version: 1 });

      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "test-version-no-raw",
          store,
          version: 2,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok && isVersionMismatch(result.error)) {
        expect(result.error.storedVersion).toBe(1);
        expect(result.error.requestedVersion).toBe(2);
        expect(result.error.workflowId).toBeDefined();
        expect(String(result.error.message)).toContain("durable.deleteState");
      } else {
        throw new Error("Expected VersionMismatchError");
      }
    });

    it("should reject resume on version mismatch", async () => {
      const store = createTestSnapshotStore();

      // Manually save state with version 1 (simulating incomplete workflow)
      const partialState = {
        steps: new Map([
          ["fetch-user", { result: ok({ id: "123", name: "User 123" }) }]
        ])
      };
      // Save with metadata including version
      await store.save("test-version", partialState, { version: 1 });

      // Try to run with version 2 - should be rejected
      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "test-version",
          store,
          version: 2,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok && isVersionMismatch(result.error)) {
        expect(result.error.storedVersion).toBe(1);
        expect(result.error.requestedVersion).toBe(2);
        expect(result.error.workflowId).toBeDefined();
        expect(String(result.error.message)).toContain("durable.deleteState");
      } else {
        throw new Error("Expected VersionMismatchError");
      }
    });

    it("onVersionMismatch 'clear' deletes state and runs from scratch", async () => {
      const store = createTestSnapshotStore();
      const partialState = {
        steps: new Map([
          ["fetch-user", { result: ok({ id: "123", name: "User 123" }) }]
        ])
      };
      await store.save("test-clear", partialState, { version: 1 });

      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "test-clear",
          store,
          version: 2,
          onVersionMismatch: () => "clear",
        }
      );

      expect(result.ok).toBe(true);
      expect(await durable.hasState(store, "test-clear")).toBe(false);
    });

    it("onVersionMismatch 'throw' returns VersionMismatchError", async () => {
      const store = createTestSnapshotStore();
      await store.save("test-throw", { steps: new Map([["a", { result: ok(1) }]]) }, { version: 1 });

      const result = await durable.run(
        { fetchUser },
        async ({ step }) => step("u", () => fetchUser("1")),
        { id: "test-throw", store, version: 2, onVersionMismatch: () => "throw" }
      );

      expect(result.ok).toBe(false);
      if (!result.ok && isVersionMismatch(result.error)) {
        expect(result.error.requestedVersion).toBe(2);
      } else {
        throw new Error("Expected VersionMismatchError");
      }
    });

    it("onVersionMismatch { migratedState } resumes with supplied state", async () => {
      const store = createTestSnapshotStore();
      await store.save("test-migrate", { steps: new Map([["old-key", { result: ok("old") }]]) }, { version: 1 });

      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "test-migrate",
          store,
          version: 2,
          onVersionMismatch: () => ({
            migratedState: {
              steps: new Map([["fetch-user", { result: ok({ id: "123", name: "User 123" }) }]]),
            },
          }),
        }
      );

      expect(result.ok).toBe(true);
    });

  });

  describe("Concurrent Execution", () => {
    it("should reject concurrent execution by default", async () => {
      const store = createTestSnapshotStore();
      let resolveFirst: () => void;
      const firstStarted = new Promise<void>((r) => (resolveFirst = r));

      async function slowFetch(id: string): AsyncResult<string, never> {
        resolveFirst!();
        await delay(100);
        return ok(id);
      }

      // Start first workflow
      const first = durable.run(
        { slowFetch },
        async ({ step, deps: { slowFetch } }) => {
          return await step("slow", () => slowFetch("123"));
        },
        {
          id: "test-concurrent",
          store,
        }
      );

      // Wait for first to start
      await firstStarted;

      // Try to start second with same ID
      const second = await durable.run(
        { slowFetch },
        async ({ step, deps: { slowFetch } }) => {
          return await step("slow", () => slowFetch("456"));
        },
        {
          id: "test-concurrent",
          store,
        }
      );

      // Second should be rejected (in-process: activeWorkflows)
      expect(second.ok).toBe(false);
      if (!second.ok && isConcurrentExecution(second.error)) {
        expect(second.error.workflowId).toBe("test-concurrent");
        expect(second.error.reason).toBe("in-process");
      } else {
        throw new Error("Expected ConcurrentExecutionError");
      }

      // First should complete successfully
      const firstResult = await first;
      expect(firstResult.ok).toBe(true);
    });

    it("should allow concurrent execution when enabled", async () => {
      const store = createTestSnapshotStore();
      let call1Started = false;
      let call2Started = false;

      async function trackFetch(id: string): AsyncResult<string, never> {
        if (id === "1") call1Started = true;
        if (id === "2") call2Started = true;
        await delay(10);
        return ok(id);
      }

      // Start both concurrently
      const [result1, result2] = await Promise.all([
        durable.run(
          { trackFetch },
          async ({ step, deps: { trackFetch } }) => {
            return await step("track", () => trackFetch("1"));
          },
          {
            id: "test-allow-concurrent",
            store,
            allowConcurrent: true,
          }
        ),
        durable.run(
          { trackFetch },
          async ({ step, deps: { trackFetch } }) => {
            return await step("track", () => trackFetch("2"));
          },
          {
            id: "test-allow-concurrent",
            store,
            allowConcurrent: true,
          }
        ),
      ]);

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      expect(call1Started).toBe(true);
      expect(call2Started).toBe(true);
    });

    it("should not throw if cross-process lock release fails", async () => {
      const store = {
        load: vi.fn(async () => undefined),
        save: vi.fn(async () => undefined),
        delete: vi.fn(async () => true),
        list: vi.fn(async () => []),
        tryAcquire: vi.fn(async () => ({ ownerToken: "token-1" })),
        release: vi.fn(async () => {
          throw new Error("Release failed");
        }),
      };

      await expect(
        durable.run(
          { fetchUser },
          async ({ step, deps: { fetchUser } }) => {
            const user = await step("fetch-user", () => fetchUser("123"));
            return user;
          },
          {
            id: "test-lock-release-error",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            store: store as any,
          }
        )
      ).resolves.toMatchObject({ ok: true });
    });

    it("returns PersistenceError when lock acquisition throws", async () => {
      const store: SnapshotStore & { tryAcquire: () => Promise<never>; release: () => Promise<void> } = {
        async save() {},
        async load() {
          return null;
        },
        async delete() {},
        async list() {
          return [];
        },
        async close() {},
        async tryAcquire() {
          throw new Error("lock failed");
        },
        async release() {},
      };

      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        { id: "lock-error", store }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isPersistenceError(result.error)).toBe(true);
      }
    });
  });

  describe("Cancellation", () => {
    it("should handle cancellation and preserve state", async () => {
      const store = createTestSnapshotStore();
      const controller = new AbortController();

      async function slowOp(id: string): AsyncResult<string, never> {
        await delay(100);
        return ok(id);
      }

      // Start workflow and cancel during execution
      const resultPromise = durable.run(
        { slowOp },
        async ({ step, deps: { slowOp } }) => {
          const first = await step("step-1", () => slowOp("1"));
          const second = await step("step-2", () => slowOp("2"));
          return { first, second };
        },
        {
          id: "test-cancel",
          store,
          signal: controller.signal,
        }
      );

      // Cancel after a short delay
      await delay(50);
      controller.abort("User cancelled");

      const result = await resultPromise;

      // Should be cancelled
      expect(result.ok).toBe(false);
      if (!result.ok && isWorkflowCancelled(result.error)) {
        expect(result.error.reason).toBe("User cancelled");
      }

      // State should be preserved for resume
      const hasState = await durable.hasState(store, "test-cancel");
      expect(hasState).toBe(true);
    });
  });

  describe("Persistence Errors", () => {
    it("returns PersistenceError when store returns an invalid snapshot", async () => {
      const store: SnapshotStore = {
        async save() {},
        async load() {
          // Missing formatVersion and other required fields
          return {
            steps: {},
            execution: { status: "running", lastUpdated: new Date().toISOString() },
          } as unknown as WorkflowSnapshot;
        },
        async delete() {},
        async list() {
          return [];
        },
        async close() {},
      };

      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        { id: "invalid-snapshot", store }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isPersistenceError(result.error)).toBe(true);
      }
    });

    it("should return a PersistenceError when delete fails after success", async () => {
      const storeData = new Map<string, { state: { steps: Map<string, unknown> } }>();
      const store = {
        save: vi.fn(async (runId, state) => {
          storeData.set(runId, { state });
        }),
        load: vi.fn(async (runId) => storeData.get(runId)?.state),
        delete: vi.fn().mockRejectedValue(new Error("Delete failed")),
        list: vi.fn(async () => []),
      };

      await expect(
        durable.run(
          { fetchUser },
          async ({ step, deps: { fetchUser } }) => {
            const user = await step("fetch-user", () => fetchUser("123"));
            return user;
          },
          {
            id: "test-delete-error",
            store,
          }
        )
      ).resolves.toSatisfy((result: unknown) => {
        if (typeof result !== "object" || result === null) return false;
        const typed = result as { ok: boolean; error?: unknown };
        return typed.ok === false && isPersistenceError(typed.error);
      });
    });

    it("should emit persist_error event when store.save throws", async () => {
      const events: DurableWorkflowEvent<unknown>[] = [];
      const store = {
        save: vi.fn().mockRejectedValue(new Error("Save failed")),
        load: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
      };

      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "test-save-error-event",
          store,
          onEvent: (event) => events.push(event),
        }
      );

      expect(result.ok).toBe(true);
      expect(events.some((event) => event.type === "persist_error")).toBe(true);
    });

    it("should return a Result when store load throws", async () => {
      const store = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockRejectedValue(new Error("Load failed")),
        delete: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
      };

      await expect(
        durable.run(
          { fetchUser },
          async ({ step, deps: { fetchUser } }) => {
            const user = await step("fetch-user", () => fetchUser("123"));
            return user;
          },
          {
            id: "test-load-error",
            store,
          }
        )
      ).resolves.toMatchObject({ ok: false });
    });

    it("should emit persist_error event but continue workflow", async () => {
      const events: DurableWorkflowEvent<unknown>[] = [];

      // Create a store that fails on save
      const failingStore = {
        save: vi.fn().mockRejectedValue(new Error("Storage unavailable")),
        load: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
      };

      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "test-persist-error",
          store: failingStore,
          onEvent: (event) => events.push(event),
        }
      );

      // Workflow should still succeed
      expect(result.ok).toBe(true);

      // Should have persist_error event
      const persistErrors = events.filter((e) => e.type === "persist_error");
      expect(persistErrors.length).toBeGreaterThan(0);
    });

    it("does not reintroduce stale snapshot warnings when a step becomes serializable", async () => {
      const store = createTestSnapshotStore();
      const now = new Date().toISOString();
      const existingSnapshot: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "lossy:1": { ok: true, value: null },
        },
        execution: { status: "running", lastUpdated: now },
        warnings: [
          { type: "lossy_value", stepId: "lossy:1", path: "value", reason: "non-json" },
        ],
      };
      await store.save("warn-clear", existingSnapshot);

      const result = await durable.run(
        {
          okStep: async (): AsyncResult<{ value: number }, "NEVER"> => ok({ value: 123 }),
          failStep: async (): AsyncResult<never, "FAIL"> => err("FAIL"),
        },
        async ({ step, deps: { okStep, failStep } }) => {
          await step("lossy:1", () => okStep());
          await step("fail:1", () => failStep());
          return 0;
        },
        { id: "warn-clear", store }
      );

      expect(result.ok).toBe(false);
      const updated = await store.load("warn-clear");
      expect(updated).not.toBeNull();
      expect(updated?.warnings?.some((w) => w.stepId === "lossy:1") ?? false).toBe(false);
    });
  });

  describe("Helper Methods", () => {
    it("durable.hasState should check if state exists", async () => {
      const store = createTestSnapshotStore();

      // No state initially
      expect(await durable.hasState(store, "nonexistent")).toBe(false);

      // Create state by running incomplete workflow
      await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          await step("fetch", () => fetchUser("unknown"));
          return null;
        },
        {
          id: "test-has-state",
          store,
        }
      );

      // State should exist after error
      expect(await durable.hasState(store, "test-has-state")).toBe(true);
    });

    it("durable.deleteState should remove persisted state", async () => {
      const store = createTestSnapshotStore();

      // Create state
      await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          await step("fetch", () => fetchUser("unknown"));
          return null;
        },
        {
          id: "test-delete-state",
          store,
        }
      );

      expect(await durable.hasState(store, "test-delete-state")).toBe(true);

      // Delete state
      const deleted = await durable.deleteState(store, "test-delete-state");
      expect(deleted).toBe(true);

      expect(await durable.hasState(store, "test-delete-state")).toBe(false);
    });

    it("durable.deleteState should return false on store errors", async () => {
      const store = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockRejectedValue(new Error("Delete failed")),
        list: vi.fn().mockResolvedValue([]),
      };

      await expect(durable.deleteState(store, "test-delete-error")).resolves.toBe(false);
    });

    it("durable.deleteStates returns { deleted: 0 } for empty ids", async () => {
      const store = createTestSnapshotStore();
      const result = await durable.deleteStates(store, []);
      expect(result).toEqual({ deleted: 0 });
    });

    it("durable.deleteStates loops store.delete for each ID", async () => {
      const store = createTestSnapshotStore();
      await store.save("d1", { formatVersion: 1, steps: {}, execution: { status: "running", lastUpdated: new Date().toISOString() } });
      await store.save("d2", { formatVersion: 1, steps: {}, execution: { status: "running", lastUpdated: new Date().toISOString() } });

      const result = await durable.deleteStates(store, ["d1", "d2"]);
      expect(result.deleted).toBe(2);
      expect(await store.load("d1")).toBeNull();
      expect(await store.load("d2")).toBeNull();
    });

    it("durable.clearState uses store.clear when present", async () => {
      const store = createTestSnapshotStore();
      await store.save("c1", { formatVersion: 1, steps: {}, execution: { status: "running", lastUpdated: new Date().toISOString() } });
      const clearFn = vi.fn().mockResolvedValue(undefined);
      const storeWithClear = Object.assign(store, { clear: clearFn });

      await durable.clearState(storeWithClear);
      expect(clearFn).toHaveBeenCalledOnce();
    });

    it("durable.clearState paginated when store has no clear", async () => {
      const store = createTestSnapshotStore();
      await store.save("c1", { formatVersion: 1, steps: {}, execution: { status: "running", lastUpdated: new Date().toISOString() } });
      await store.save("c2", { formatVersion: 1, steps: {}, execution: { status: "running", lastUpdated: new Date().toISOString() } });

      await durable.clearState(store);
      const pending = await store.list();
      expect(pending).toHaveLength(0);
    });

    it("durable.deleteStates with continueOnError collects errors when looping", async () => {
      const store = createTestSnapshotStore();
      await store.save("e1", { steps: new Map() });
      const failingStore = {
        ...store,
        delete: vi.fn().mockImplementation(async (id: string) => {
          if (id === "e1") throw new Error("db error");
          return true;
        }),
      };

      const result = await durable.deleteStates(failingStore, ["e1", "e2"], {
        continueOnError: true,
      });
      expect(result.deleted).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].id).toBe("e1");
      expect((result.errors?.[0].error as Error).message).toBe("db error");
    });

    it("durable.listPending should list all workflow IDs with state", async () => {
      const store = createTestSnapshotStore();

      // Create multiple incomplete workflows
      for (const id of ["workflow-1", "workflow-2", "workflow-3"]) {
        await durable.run(
          { fetchUser },
          async ({ step, deps: { fetchUser } }) => {
            await step("fetch", () => fetchUser("unknown"));
            return null;
          },
          {
            id,
            store,
          }
        );
      }

      const pending = await durable.listPending(store);
      const ids = pending.map((p) => p.id);
      expect(ids).toContain("workflow-1");
      expect(ids).toContain("workflow-2");
      expect(ids).toContain("workflow-3");
    });

    it("durable.listPending(store, options) returns array with id and updatedAt", async () => {
      const store = createTestSnapshotStore();
      await store.save("id-1", { formatVersion: 1, steps: {}, execution: { status: "running", lastUpdated: new Date().toISOString() } });
      await store.save("id-2", { formatVersion: 1, steps: {}, execution: { status: "running", lastUpdated: new Date().toISOString() } });

      const result = await durable.listPending(store, { limit: 10 });
      expect(Array.isArray(result)).toBe(true);
      const ids = result.map((r) => r.id);
      expect(ids).toContain("id-1");
      expect(ids).toContain("id-2");
      // Each entry should have updatedAt
      expect(result.every((r) => typeof r.updatedAt === "string")).toBe(true);
    });
  });

  describe("Type Guards", () => {
    it("isVersionMismatch should correctly identify version errors", () => {
      expect(
        isVersionMismatch({
          type: "VERSION_MISMATCH",
          workflowId: "test",
          storedVersion: 1,
          requestedVersion: 2,
          message: "",
        })
      ).toBe(true);
      expect(isVersionMismatch({ type: "OTHER_ERROR" })).toBe(false);
      expect(isVersionMismatch(null)).toBe(false);
      expect(isVersionMismatch("string")).toBe(false);
    });

    it("isConcurrentExecution should correctly identify concurrent errors", () => {
      expect(
        isConcurrentExecution({
          type: "CONCURRENT_EXECUTION",
          workflowId: "test",
          message: "",
          reason: "in-process",
        })
      ).toBe(true);
      expect(isConcurrentExecution({ type: "OTHER_ERROR" })).toBe(false);
      expect(isConcurrentExecution(null)).toBe(false);
    });

    it("ConcurrentExecutionError has reason in-process when activeWorkflows blocks", async () => {
      const store = createTestSnapshotStore();
      const id = "reason-in-process";
      const first = durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          await delay(50);
          return step("u", () => fetchUser("1"));
        },
        { id, store }
      );
      const second = durable.run(
        { fetchUser },
        async ({ step }) => step("u2", () => fetchUser("2")),
        { id, store }
      );
      const secondResult = await second;
      expect(secondResult.ok).toBe(false);
      if (!secondResult.ok && isConcurrentExecution(secondResult.error)) {
        expect(secondResult.error.reason).toBe("in-process");
      }
      await first;
    });

    it("ConcurrentExecutionError has reason cross-process when tryAcquire returns null", async () => {
      const store = {
        load: vi.fn(async () => undefined),
        save: vi.fn(async () => undefined),
        delete: vi.fn(async () => true),
        list: vi.fn(async () => []),
        tryAcquire: vi.fn(async () => null),
        release: vi.fn(async () => undefined),
      };
      const result = await durable.run(
        { fetchUser },
        async ({ step, deps: { fetchUser } }) => {
          const user = await step("fetch-user", () => fetchUser("123"));
          return user;
        },
        {
          id: "reason-cross-process",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          store: store as any,
        }
      );
      expect(result.ok).toBe(false);
      if (!result.ok && isConcurrentExecution(result.error)) {
        expect(result.error.reason).toBe("cross-process");
      }
    });
  });
});
