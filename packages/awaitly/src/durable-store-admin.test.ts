/**
 * The zero-config store and the admin helpers around it.
 *
 * Mutation testing reported this region unmutated: the default in-memory
 * store's `list` could drop its prefix filter, ignore its limit or stop
 * sorting, and every admin helper's error fallback could be deleted, with the
 * suite still green. These are the calls an operator reaches for when a batch
 * is stuck, so what they report has to be pinned.
 */

import { describe, it, expect, vi } from "vitest";
import { ok, type AsyncResult } from "./core";
import { createMemorySnapshotStore, durable, type SnapshotStore } from "./durable";
import { durableStoreContract, supportsLock } from "./testing/store-contract";
import type { WorkflowSnapshot } from "./persistence";

const deps = {
  work: async (): AsyncResult<string, never> => ok("done"),
};

function snapshot(): WorkflowSnapshot {
  return {
    formatVersion: 1,
    steps: {},
    execution: { status: "completed", lastUpdated: new Date().toISOString() },
  } as unknown as WorkflowSnapshot;
}

/** A store whose every method rejects, standing in for an outage. */
function brokenStore(): SnapshotStore {
  const boom = async (): Promise<never> => {
    throw new Error("store unreachable");
  };
  return { save: boom, load: boom, delete: boom, list: boom, close: boom };
}

describe("zero-config default store", () => {
  it("runs and resumes without a store being configured", async () => {
    const id = `default-store-${Date.now()}`;
    const first = await durable.run(deps, async ({ step }) => step("work", () => deps.work()), { id });
    expect(first.ok).toBe(true);

    // A successful run deletes its snapshot, so the id is free again and a
    // second run under it executes rather than replaying a finished workflow.
    const ran = vi.fn(async (): AsyncResult<string, never> => ok("again"));
    const second = await durable.run({ ran }, async ({ step }) => step("work", () => ran()), { id });
    expect(second.ok).toBe(true);
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("reports a cleanup delete that fails rather than claiming plain success", async () => {
    const rows = new Map<string, WorkflowSnapshot>();
    const store: SnapshotStore = {
      async save(id, snap) {
        rows.set(id, snap);
      },
      async load(id) {
        return rows.get(id) ?? null;
      },
      async delete() {
        throw new Error("delete rejected");
      },
      async list() {
        return [];
      },
      async close() {},
    };

    const result = await durable.run(
      deps,
      async ({ step }) => step("work", () => deps.work()),
      { id: `cleanup-fail-${Date.now()}`, store }
    );

    // A snapshot left behind means the next run under this id replays a
    // finished workflow, so the failure has to reach the caller.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { type: string }).type).toBe("PERSISTENCE_ERROR");
    expect((result.error as { operation: string }).operation).toBe("delete");
  });
});

describe("the default store satisfies the same contract as the adapters", () => {
  // The first version of this block built its own store and asserted against
  // that, so mutating the real one changed nothing. Driving the exported
  // factory through the shared contract is the whole point.
  for (const contractCase of durableStoreContract) {
    it(contractCase.name, async (context) => {
      const store = createMemorySnapshotStore();
      if (contractCase.requires === "lock" && !supportsLock(store)) return context.skip();
      await contractCase.run(store);
    });
  }

  it("caps its listing at the limit and sorts newest first", async () => {
    const store = createMemorySnapshotStore();
    const prefix = `mem-list-${Date.now()}`;

    await store.save(`${prefix}-a`, snapshot());
    await new Promise((r) => setTimeout(r, 5));
    await store.save(`${prefix}-b`, snapshot());
    await store.save("unrelated", snapshot());

    expect((await store.list({ prefix })).map((r) => r.id)).toEqual([
      `${prefix}-b`,
      `${prefix}-a`,
    ]);
    expect(await store.list({ prefix, limit: 1 })).toHaveLength(1);
  });

  it("defaults its listing to 100 entries", async () => {
    const store = createMemorySnapshotStore();
    for (let i = 0; i < 150; i++) await store.save(`bulk-${i}`, snapshot());

    expect(await store.list()).toHaveLength(100);
  });
});

describe("admin helpers report store failures as absence", () => {
  it("hasState is true for a saved id and false for an unknown one", async () => {
    const rows = new Map<string, WorkflowSnapshot>();
    const store: SnapshotStore = {
      async save(id, s) {
        rows.set(id, s);
      },
      async load(id) {
        return rows.get(id) ?? null;
      },
      async delete(id) {
        rows.delete(id);
      },
      async list() {
        return [];
      },
      async close() {},
    };

    await store.save("known", snapshot());
    expect(await durable.hasState(store, "known")).toBe(true);
    expect(await durable.hasState(store, "unknown")).toBe(false);
  });

  it("hasState answers false rather than throwing when the store is down", async () => {
    expect(await durable.hasState(brokenStore(), "any")).toBe(false);
  });

  it("listPending answers empty rather than throwing when the store is down", async () => {
    expect(await durable.listPending(brokenStore())).toEqual([]);
  });

  it("deleteState reports true on success and false when the store is down", async () => {
    const deleted: string[] = [];
    const store: SnapshotStore = {
      ...brokenStore(),
      async delete(id) {
        deleted.push(id);
      },
    };

    expect(await durable.deleteState(store, "gone")).toBe(true);
    expect(deleted).toEqual(["gone"]);
    expect(await durable.deleteState(brokenStore(), "gone")).toBe(false);
  });
});

describe("deleteStates", () => {
  function countingStore(failOn: Set<string> = new Set()): SnapshotStore & { deletes: string[] } {
    const deletes: string[] = [];
    return {
      deletes,
      async save() {},
      async load() {
        return null;
      },
      async delete(id) {
        if (failOn.has(id)) throw new Error(`cannot delete ${id}`);
        deletes.push(id);
      },
      async list() {
        return [];
      },
      async close() {},
    };
  }

  it("returns a zero count for an empty id list without touching the store", async () => {
    const store = countingStore();
    expect(await durable.deleteStates(store, [])).toEqual({ deleted: 0 });
    expect(store.deletes).toEqual([]);
  });

  it("deletes every id and reports the count", async () => {
    const store = countingStore();
    const result = await durable.deleteStates(store, ["a", "b", "c"]);

    expect(result).toEqual({ deleted: 3 });
    expect(store.deletes.sort()).toEqual(["a", "b", "c"]);
  });

  it("processes more ids than the concurrency limit", async () => {
    const store = countingStore();
    const ids = Array.from({ length: 25 }, (_, i) => `id-${i}`);

    // Batches of 10 mean three passes; an off-by-one in the loop drops ids.
    const result = await durable.deleteStates(store, ids, { concurrency: 10 });

    expect(result).toEqual({ deleted: 25 });
    expect(store.deletes).toHaveLength(25);
  });

  it("treats a concurrency below one as one rather than looping forever", async () => {
    const store = countingStore();
    const result = await durable.deleteStates(store, ["a", "b"], { concurrency: 0 });

    expect(result).toEqual({ deleted: 2 });
  });

  it("collects per-id errors and still deletes the rest when continueOnError", async () => {
    const store = countingStore(new Set(["b"]));
    const result = await durable.deleteStates(store, ["a", "b", "c"], {
      continueOnError: true,
    });

    expect(result.deleted).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.id).toBe("b");
  });

  it("omits the errors key entirely when every delete succeeded", async () => {
    const result = await durable.deleteStates(countingStore(), ["a"]);

    // An always-present `errors: []` reads as a partial failure to a caller
    // checking for the key.
    expect("errors" in result).toBe(false);
  });

  it("throws on the first failure when continueOnError is false", async () => {
    const store = countingStore(new Set(["b"]));

    await expect(
      durable.deleteStates(store, ["a", "b", "c"], { continueOnError: false, concurrency: 1 })
    ).rejects.toThrow("cannot delete b");
  });
});

describe("clearState", () => {
  it("pages through the store until it is empty", async () => {
    const rows = new Map<string, WorkflowSnapshot>();
    for (let i = 0; i < 250; i++) rows.set(`w-${i}`, snapshot());

    const store: SnapshotStore = {
      async save(id, s) {
        rows.set(id, s);
      },
      async load(id) {
        return rows.get(id) ?? null;
      },
      async delete(id) {
        rows.delete(id);
      },
      async list(options) {
        const limit = options?.limit ?? 100;
        return [...rows.keys()]
          .slice(0, limit)
          .map((id) => ({ id, updatedAt: new Date().toISOString() }));
      },
      async close() {},
    };

    await durable.clearState(store);

    // Stopping after one page would leave 150 behind.
    expect(rows.size).toBe(0);
  });
});
