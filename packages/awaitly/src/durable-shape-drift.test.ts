import { describe, expect, it } from "vitest";
import { ok, type AsyncResult } from "./core";
import { durable, WorkflowShapeDriftError, type SnapshotStore } from "./durable";
import type { WorkflowSnapshot } from "./persistence";

/**
 * Step keys are position-derived: repeat calls to the same dep auto-suffix
 * (`getUser`, `getUser#2`, ...). Inserting or reordering a call shifts every
 * later suffix, so a resumed run could read a different step's checkpoint under
 * the same key. The snapshot records the executed order so that drift is caught
 * instead of silently replaying the wrong value — previously this relied on the
 * author remembering to bump `version`.
 */
function createTestStore(): SnapshotStore {
  const store = new Map<string, { snapshot: WorkflowSnapshot; updatedAt: Date }>();
  return {
    async save(id, snapshot) {
      store.set(id, { snapshot, updatedAt: new Date() });
    },
    async load(id) {
      return store.get(id)?.snapshot ?? null;
    },
    async delete(id) {
      store.delete(id);
    },
    async list() {
      return [...store.entries()].map(([id, { updatedAt }]) => ({
        id,
        updatedAt: updatedAt.toISOString(),
      }));
    },
    async close() {},
  };
}

const a = async (): AsyncResult<string, never> => ok("A");
const b = async (): AsyncResult<string, never> => ok("B");

describe("durable: workflow shape drift", () => {
  it("records the executed step order in a surviving snapshot", async () => {
    const store = createTestStore();

    // A completed run cleans up its state, so the order is observed on a run
    // that stops part-way — which is also the only case resume cares about.
    await durable.run({ a, b }, async ({ step, deps }) => {
      await step("a", () => deps.a());
      await step("b", () => deps.b());
      throw new Error("interrupted");
    }, { id: "wf-1", store });

    const snap = await store.load("wf-1");
    expect(snap?.metadata?.stepOrder).toEqual(["a", "b"]);
  });

  it("fails a resume whose step order diverged", async () => {
    const store = createTestStore();

    await durable.run({ a, b }, async ({ step, deps }) => {
      await step("a", () => deps.a());
      await step("b", () => deps.b());
      throw new Error("stop here");
    }, { id: "wf-2", store });

    expect((await store.load("wf-2"))?.metadata?.stepOrder).toEqual(["a", "b"]);

    // The workflow is edited: `b` now runs before `a`. Replaying against the
    // old checkpoint must not hand `a`'s stored value to `b`.
    const result = await durable.run({ a, b }, async ({ step, deps }) => {
      await step("b", () => deps.b());
      await step("a", () => deps.a());
      return "done";
    }, { id: "wf-2", store });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.error)).toMatch(/changed shape/i);
    }
  });

  it("allows a resume that appends steps without reordering existing ones", async () => {
    const store = createTestStore();

    await durable.run({ a, b }, async ({ step, deps }) => {
      await step("a", () => deps.a());
      throw new Error("stop");
    }, { id: "wf-3", store });

    const result = await durable.run({ a, b }, async ({ step, deps }) => {
      await step("a", () => deps.a());
      await step("b", () => deps.b());
      return "done";
    }, { id: "wf-3", store });

    expect(result.ok).toBe(true);
  });

  it("rejects the drifted step before its stored value is read", async () => {
    const store = createTestStore();
    const seen: string[] = [];

    // `a` and `b` return distinguishable values so a mis-replay is observable.
    const trackedA = async (): AsyncResult<string, never> => ok("A");
    const trackedB = async (): AsyncResult<string, never> => ok("B");

    await durable.run({ a: trackedA, b: trackedB }, async ({ step, deps }) => {
      await step("a", () => deps.a());
      await step("b", () => deps.b());
      throw new Error("stop");
    }, { id: "wf-4", store });

    // Reordered: `b` now occupies position 1, where the checkpoint holds `a`.
    const result = await durable.run({ a: trackedA, b: trackedB }, async ({ step, deps }) => {
      const first = await step("b", () => deps.b());
      seen.push(first);            // must never run
      const second = await step("a", () => deps.a());
      seen.push(second);
      return "done";
    }, { id: "wf-4", store });

    expect(result.ok).toBe(false);
    // The callback never observed a value at all — the drift was caught before
    // the stored result for position 1 was read.
    expect(seen).toEqual([]);
  });

  it("reports the drifting position and both step keys", async () => {
    const store = createTestStore();

    await durable.run({ a, b }, async ({ step, deps }) => {
      await step("a", () => deps.a());
      await step("b", () => deps.b());
      throw new Error("stop");
    }, { id: "wf-5", store });

    const result = await durable.run({ a, b }, async ({ step, deps }) => {
      await step("b", () => deps.b());
      return "done";
    }, { id: "wf-5", store });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const cause = (result.error as { cause?: WorkflowShapeDriftError }).cause;
      expect(cause).toBeInstanceOf(WorkflowShapeDriftError);
      expect(cause?.stepIndex).toBe(0);
      expect(cause?.expectedStepKey).toBe("a");
      expect(cause?.actualStepKey).toBe("b");
    }
  });

  it("leaves the original checkpoint intact after rejecting a drifted resume", async () => {
    const store = createTestStore();

    await durable.run({ a, b }, async ({ step, deps }) => {
      await step("a", () => deps.a());
      await step("b", () => deps.b());
      throw new Error("stop");
    }, { id: "wf-6", store });

    const before = JSON.stringify(await store.load("wf-6"));

    await durable.run({ a, b }, async ({ step, deps }) => {
      await step("b", () => deps.b());
      return "done";
    }, { id: "wf-6", store });

    expect(JSON.stringify(await store.load("wf-6"))).toBe(before);
  });

  // Regression: bound-step keys are position-derived, so two calls to the same
  // dep produce `getUser`, `getUser#2` regardless of their arguments. Swapping
  // them left the key sequence identical, and the resume silently handed one
  // argument's checkpoint to the other call.
  describe("repeated calls to the same dependency", () => {
    const getUser = async (id: string): AsyncResult<string, never> => ok(`user:${id}`);

    it("rejects a resume where the arguments moved but the keys did not", async () => {
      const store = createTestStore();

      await durable.run({ getUser }, async ({ steps }) => {
        await steps.getUser("a");
        await steps.getUser("b");
        throw new Error("stop");
      }, { id: "args-1", store });

      const snap = await store.load("args-1");
      expect(snap?.metadata?.stepOrder).toEqual(["getUser", "getUser#2"]);

      let firstSeen: string | undefined;
      const result = await durable.run({ getUser }, async ({ steps }) => {
        firstSeen = await steps.getUser("b");   // same key, different argument
        await steps.getUser("a");
        return "done";
      }, { id: "args-1", store });

      expect(result.ok).toBe(false);
      // The call never received the other argument's stored value.
      expect(firstSeen).toBeUndefined();
    });

    it("resumes normally when the arguments are unchanged", async () => {
      const store = createTestStore();

      await durable.run({ getUser }, async ({ steps }) => {
        await steps.getUser("a");
        await steps.getUser("b");
        throw new Error("stop");
      }, { id: "args-2", store });

      const result = await durable.run({ getUser }, async ({ steps }) => {
        const first = await steps.getUser("a");
        const second = await steps.getUser("b");
        return `${first}|${second}`;
      }, { id: "args-2", store });

      expect(result).toEqual({ ok: true, value: "user:a|user:b" });
    });

    it("records an argument fingerprint per step position", async () => {
      const store = createTestStore();

      await durable.run({ getUser }, async ({ steps }) => {
        await steps.getUser("a");
        await steps.getUser("b");
        throw new Error("stop");
      }, { id: "args-3", store });

      const args = (await store.load("args-3"))?.metadata?.stepArgs as string[];
      expect(args).toHaveLength(2);
      // Different arguments must fingerprint differently, or the guard is blind.
      expect(args[0]).not.toBe(args[1]);
    });
  });
});
