import { describe, it, expect, afterEach } from "vitest";
import { createEngine } from ".";
import { ok, err } from "../core";
import type { SnapshotStore, WorkflowSnapshot } from "../persistence";
import type { EngineEvent, WorkflowRegistration } from "./types";

// Simple in-memory store for tests
function createTestStore(): SnapshotStore {
  const data = new Map<string, { snapshot: WorkflowSnapshot; updatedAt: Date }>();
  return {
    async save(id, snapshot) { data.set(id, { snapshot, updatedAt: new Date() }); },
    async load(id) { return data.get(id)?.snapshot ?? null; },
    async delete(id) { data.delete(id); },
    async list(opts) {
      const prefix = opts?.prefix ?? "";
      const limit = opts?.limit ?? 100;
      return Array.from(data.entries())
        .filter(([id]) => !prefix || id.startsWith(prefix))
        .sort(([, a], [, b]) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit)
        .map(([id, e]) => ({ id, updatedAt: e.updatedAt.toISOString() }));
    },
    async close() {},
  };
}

const testDeps = {
  greet: async (name: string) => ok(`Hello ${name}`),
};
const testFn: WorkflowRegistration['fn'] = async ({ step, deps }) => {
  return await step("greet", () => deps.greet("world"));
};

const failDeps = {
  fail: async () => err({ type: "FAIL" as const, message: "boom" }),
};
const failFn: WorkflowRegistration['fn'] = async ({ step, deps }) => {
  return await step("fail-step", () => deps.fail());
};

let engine: ReturnType<typeof createEngine> | undefined;

afterEach(async () => {
  if (engine) {
    await engine.stop();
    engine = undefined;
  }
});

describe("createEngine", () => {
  it("enqueue + tick: enqueues a workflow and processes it", async () => {
    const store = createTestStore();
    const events: EngineEvent[] = [];

    engine = createEngine({
      store,
      workflows: { greet: { deps: testDeps, fn: testFn } },
      onEvent: (e) => events.push(e),
    });

    const id = await engine.enqueue("greet");
    expect(id).toContain("greet:");

    const processed = await engine.tick();
    expect(processed).toBe(1);

    // Should have emitted enqueued, started, completed, tick events
    const types = events.map(e => e.type);
    expect(types).toContain("workflow_enqueued");
    expect(types).toContain("workflow_started");
    expect(types).toContain("workflow_completed");
    expect(types).toContain("engine_tick");
  });

  it("throws on unknown workflow name", async () => {
    const store = createTestStore();
    engine = createEngine({
      store,
      workflows: { greet: { deps: testDeps, fn: testFn } },
    });

    await expect(engine.enqueue("nonexistent")).rejects.toThrow("Unknown workflow: 'nonexistent'");
  });

  it("respects concurrency limit", async () => {
    const store = createTestStore();
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const slowDeps = {
      slow: async () => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise(r => setTimeout(r, 50));
        currentConcurrent--;
        return ok("done");
      },
    };
    const slowFn: WorkflowRegistration['fn'] = async ({ step, deps }) => {
      return await step("slow", () => deps.slow());
    };

    engine = createEngine({
      store,
      workflows: { slow: { deps: slowDeps, fn: slowFn } },
      concurrency: 2,
    });

    // Enqueue 10 workflows
    for (let i = 0; i < 10; i++) {
      await engine.enqueue("slow", { id: `slow:${i}` });
    }

    await engine.tick();

    // Should have processed at most 2 (concurrency limit)
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("schedule + unschedule", () => {
    const store = createTestStore();
    const events: EngineEvent[] = [];

    engine = createEngine({
      store,
      workflows: { greet: { deps: testDeps, fn: testFn } },
      onEvent: (e) => events.push(e),
    });

    const scheduleId = engine.schedule("greet", { intervalMs: 60000 });
    expect(scheduleId).toContain("schedule:");
    expect(engine.status().pendingSchedules).toBe(1);

    const removed = engine.unschedule(scheduleId);
    expect(removed).toBe(true);
    expect(engine.status().pendingSchedules).toBe(0);

    // Unschedule non-existent returns false
    expect(engine.unschedule("nonexistent")).toBe(false);

    const types = events.map(e => e.type);
    expect(types).toContain("schedule_created");
    expect(types).toContain("schedule_removed");
  });

  it("start/stop lifecycle emits events", async () => {
    const store = createTestStore();
    const events: EngineEvent[] = [];

    engine = createEngine({
      store,
      workflows: { greet: { deps: testDeps, fn: testFn } },
      onEvent: (e) => events.push(e),
    });

    expect(engine.status().running).toBe(false);

    engine.start(5000); // Long interval so it doesn't tick again
    expect(engine.status().running).toBe(true);

    // Wait for initial tick to complete
    await new Promise(r => setTimeout(r, 100));

    await engine.stop();
    expect(engine.status().running).toBe(false);

    const types = events.map(e => e.type);
    expect(types).toContain("engine_start");
    expect(types).toContain("engine_stop");
  });

  it("emits correct event sequence", async () => {
    const store = createTestStore();
    const events: EngineEvent[] = [];

    engine = createEngine({
      store,
      workflows: { greet: { deps: testDeps, fn: testFn } },
      onEvent: (e) => events.push(e),
    });

    await engine.enqueue("greet", { id: "test-id" });
    await engine.tick();

    const types = events.map(e => e.type);
    expect(types).toEqual([
      "workflow_enqueued",
      "workflow_started",
      "workflow_completed",
      "engine_tick",
    ]);

    // Verify event data
    const enqueued = events.find(e => e.type === "workflow_enqueued");
    expect(enqueued).toBeDefined();
    if (enqueued && "workflowName" in enqueued) {
      expect(enqueued.workflowName).toBe("greet");
      expect(enqueued.id).toBe("test-id");
    }
  });

  it("emits workflow_failed for errored workflows", async () => {
    const store = createTestStore();
    const events: EngineEvent[] = [];

    engine = createEngine({
      store,
      workflows: { fail: { deps: failDeps, fn: failFn } },
      onEvent: (e) => events.push(e),
    });

    await engine.enqueue("fail", { id: "fail-id" });
    await engine.tick();

    const types = events.map(e => e.type);
    expect(types).toContain("workflow_started");
    expect(types).toContain("workflow_failed");

    const failed = events.find(e => e.type === "workflow_failed");
    expect(failed).toBeDefined();
    if (failed && "workflowName" in failed) {
      expect(failed.workflowName).toBe("fail");
      expect(failed.id).toBe("fail-id");
    }
    if (failed && "error" in failed) {
      expect(failed.error).toBeDefined();
    }
  });

  it("status() returns running state and schedule count", async () => {
    const store = createTestStore();

    engine = createEngine({
      store,
      workflows: { greet: { deps: testDeps, fn: testFn } },
    });

    expect(engine.status()).toEqual({ running: false, pendingSchedules: 0 });

    const sid = engine.schedule("greet", { intervalMs: 60000 });
    expect(engine.status()).toEqual({ running: false, pendingSchedules: 1 });

    engine.start(5000);
    expect(engine.status().running).toBe(true);
    expect(engine.status().pendingSchedules).toBe(1);

    engine.unschedule(sid);
    await engine.stop();
    expect(engine.status()).toEqual({ running: false, pendingSchedules: 0 });
  });

  it("enqueue with custom id uses that id", async () => {
    const store = createTestStore();

    engine = createEngine({
      store,
      workflows: { greet: { deps: testDeps, fn: testFn } },
    });

    const id = await engine.enqueue("greet", { id: "my-custom-id" });
    expect(id).toBe("my-custom-id");
  });

  it("onError is called for rejected promises in tick", async () => {
    const store = createTestStore();
    const errors: unknown[] = [];

    // Create a store that fails on the second save (processing mark)
    let saveCount = 0;
    const brokenStore: SnapshotStore = {
      ...store,
      async save(id, snapshot) {
        saveCount++;
        if (saveCount === 2) throw new Error("store broken");
        return store.save(id, snapshot);
      },
    };

    engine = createEngine({
      store: brokenStore,
      workflows: { greet: { deps: testDeps, fn: testFn } },
      onError: (e) => errors.push(e),
    });

    await engine.enqueue("greet");
    await engine.tick();

    expect(errors.length).toBeGreaterThan(0);
  });
});
