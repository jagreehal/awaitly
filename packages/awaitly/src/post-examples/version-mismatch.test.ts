/**
 * Blog series: Code Is the Workflow
 * Post 7 — Changing Code While Workflows Are Still Running
 * https://arrangeactassert.com/posts/changing-code-while-workflows-are-still-running/
 *
 * Runnable example: reject resume when workflow logic version changes.
 */
import { describe, it, expect } from "vitest";
import { ok, type AsyncResult } from "../core";
import { durable, isVersionMismatch } from "../durable";
import type { SnapshotStore, WorkflowSnapshot } from "../persistence";

function createTestSnapshotStore(): SnapshotStore {
  const store = new Map<string, { snapshot: WorkflowSnapshot; updatedAt: Date }>();
  return {
    async save(id: string, snapshot: WorkflowSnapshot) {
      store.set(id, { snapshot, updatedAt: new Date() });
    },
    async load(id: string) {
      return store.get(id)?.snapshot ?? null;
    },
    async delete(id: string) {
      store.delete(id);
    },
    async list() {
      return [];
    },
    async close() {},
  };
}

async function calculateRefund(): AsyncResult<{ amount: number }, never> {
  return ok({ amount: 240 });
}

describe("post-examples: version mismatch (post 7)", () => {
  it("rejects resume when stored version differs from requested version", async () => {
    const store = createTestSnapshotStore();

    await store.save("refund-exp-42", {
      formatVersion: 1,
      steps: {},
      execution: { status: "running", lastUpdated: new Date().toISOString() },
      metadata: { version: 1 },
    } as WorkflowSnapshot);

    const result = await durable.run(
      { calculateRefund },
      async ({ step, deps }) => {
        return await step("calculate", () => deps.calculateRefund(), {
          key: "calc:exp-42",
        });
      },
      { id: "refund-exp-42", store, version: 2 }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isVersionMismatch(result.error)).toBe(true);
      if (isVersionMismatch(result.error)) {
        expect(result.error.storedVersion).toBe(1);
        expect(result.error.requestedVersion).toBe(2);
      }
    }
  });

  it("clears stale state when onVersionMismatch returns clear", async () => {
    const store = createTestSnapshotStore();

    await store.save("refund-exp-clear", {
      formatVersion: 1,
      steps: {},
      execution: { status: "running", lastUpdated: new Date().toISOString() },
      metadata: { version: 1 },
    } as WorkflowSnapshot);

    const result = await durable.run(
      { calculateRefund },
      async ({ step, deps }) => {
        return await step("calculate", () => deps.calculateRefund());
      },
      {
        id: "refund-exp-clear",
        store,
        version: 2,
        onVersionMismatch: () => "clear",
      }
    );

    expect(result.ok).toBe(true);
    expect(await durable.hasState(store, "refund-exp-clear")).toBe(false);
  });
});
