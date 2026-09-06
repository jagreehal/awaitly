/**
 * Lease heartbeat and idempotency guards.
 *
 * Mutation testing found this whole region unmutated: deleting the
 * `if (!renewed) abort` block, or flipping the idempotency conflict checks,
 * left the entire suite green. These are the guards that stop two workers
 * paying the same batch, so they are the last place to accept that.
 */

import { describe, it, expect, vi } from "vitest";
import { ok, type AsyncResult } from "./core";
import {
  durable,
  isConcurrentExecution,
  isLeaseExpired,
  isIdempotencyConflict,
  type SnapshotStore,
  type WorkflowLock,
} from "./durable";
import type { WorkflowSnapshot } from "./persistence";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function memoryStore(): SnapshotStore & { seed(id: string, s: WorkflowSnapshot): void } {
  const rows = new Map<string, WorkflowSnapshot>();
  return {
    seed: (id, s) => rows.set(id, s),
    async save(id, snapshot) {
      rows.set(id, snapshot);
    },
    async load(id) {
      return rows.get(id) ?? null;
    },
    async delete(id) {
      rows.delete(id);
    },
    async list() {
      return [...rows.keys()].map((id) => ({ id, updatedAt: new Date().toISOString() }));
    },
    async close() {},
  };
}

/** A snapshot as the idempotency marker writes it. */
function idemSnapshot(
  status: "running" | "completed",
  metadata: Record<string, unknown> = {}
): WorkflowSnapshot {
  return {
    formatVersion: 1,
    steps: {},
    execution: { status, startedAt: new Date().toISOString() },
    metadata,
  } as unknown as WorkflowSnapshot;
}

const deps = {
  work: async (): AsyncResult<string, never> => ok("done"),
};

describe("idempotency guards", () => {
  it("rejects a key already used with a different input", async () => {
    const store = memoryStore();
    store.seed("idem:key-1", idemSnapshot("completed", { input: { amount: 100 } }));

    const result = await durable.run(deps, async ({ step }) => step("work", () => deps.work()), {
      id: "payment-1",
      store,
      idempotencyKey: "key-1",
      input: { amount: 250 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { type: string }).type).toBe("IDEMPOTENCY_CONFLICT");
    expect((result.error as { message: string }).message).toContain("key-1");
  });

  it("accepts the same key with the identical input", async () => {
    const store = memoryStore();
    store.seed("idem:key-2", idemSnapshot("failed" as "running", { input: { amount: 100 } }));

    const result = await durable.run(deps, async ({ step }) => step("work", () => deps.work()), {
      id: "payment-2",
      store,
      idempotencyKey: "key-2",
      input: { amount: 100 },
    });

    expect(result.ok).toBe(true);
  });

  it("reports a key whose run is still in flight as concurrent", async () => {
    const store = memoryStore();
    store.seed("idem:key-3", idemSnapshot("running", { input: { amount: 100 } }));

    const result = await durable.run(deps, async ({ step }) => step("work", () => deps.work()), {
      id: "payment-3",
      store,
      idempotencyKey: "key-3",
      input: { amount: 100 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isConcurrentExecution(result.error)).toBe(true);
    expect((result.error as { reason: string }).reason).toBe("cross-process");
  });
});

describe("lease heartbeat", () => {
  /** A store whose lock behaviour each test dictates. */
  function lockingStore(renew: WorkflowLock["renew"]): SnapshotStore & WorkflowLock {
    return {
      ...memoryStore(),
      tryAcquire: async () => ({ ownerToken: "owner-1" }),
      release: async () => {},
      renew,
    };
  }

  it("renews the lease while the workflow runs", async () => {
    const renew = vi.fn(async () => true);
    const store = lockingStore(renew);

    const result = await durable.run(
      deps,
      async ({ step }) => step("slow", async () => {
        await delay(150);
        return ok("done");
      }),
      { id: "batch-1", store, lockTtlMs: 90 }
    );

    expect(result.ok).toBe(true);
    expect(renew).toHaveBeenCalled();
    // Renewal must carry the token acquired, or it extends nobody's lease.
    expect(renew).toHaveBeenCalledWith("batch-1", "owner-1", { ttlMs: 90 });
  });

  it("aborts the run when a renewal reports the lease lost", async () => {
    const store = lockingStore(async () => false);

    const result = await durable.run(
      deps,
      async ({ step }) => step("slow", async () => {
        await delay(200);
        return ok("done");
      }),
      { id: "batch-2", store, lockTtlMs: 60 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isLeaseExpired(result.error)).toBe(true);
  });

  it("aborts the run when a renewal throws", async () => {
    const store = lockingStore(async () => {
      throw new Error("connection reset");
    });

    const result = await durable.run(
      deps,
      async ({ step }) => step("slow", async () => {
        await delay(200);
        return ok("done");
      }),
      { id: "batch-3", store, lockTtlMs: 60 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isLeaseExpired(result.error)).toBe(true);
  });

  it("honours an explicit heartbeat interval over the ttl-derived default", async () => {
    const renew = vi.fn(async () => true);
    const store = lockingStore(renew);

    await durable.run(
      deps,
      async ({ step }) => step("slow", async () => {
        await delay(120);
        return ok("done");
      }),
      // ttl/3 would be 1000ms and never fire inside 120ms.
      { id: "batch-4", store, lockTtlMs: 3000, heartbeatIntervalMs: 25 }
    );

    expect(renew.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps running when the store offers no renew", async () => {
    const store = { ...memoryStore(), tryAcquire: async () => ({ ownerToken: "o" }), release: async () => {} };

    const result = await durable.run(
      deps,
      async ({ step }) => step("slow", async () => {
        await delay(80);
        return ok("done");
      }),
      { id: "batch-5", store, lockTtlMs: 60 }
    );

    expect(result.ok).toBe(true);
  });
});

describe("corrupt snapshots and cancellation", () => {
  /** A store returning whatever the test seeds, valid or not. */
  function storeReturning(value: unknown): SnapshotStore {
    return {
      ...memoryStore(),
      async load() {
        return value as WorkflowSnapshot | null;
      },
    };
  }

  it("reports a malformed snapshot rather than starting the workflow over", async () => {
    // Caught by assertValidSnapshot on load. A snapshot restarted instead of
    // reported is a batch paid twice, so the one thing this must not do is
    // fall through to a fresh run. The deeper decode guards inside
    // createWorkflow and run remain unpinned; they need a snapshot that passes
    // validation and fails decode, which no test builds yet.
    const ran = vi.fn(async () => ok("done"));

    const result = await durable.run(
      { ran },
      async ({ step }) => step("work", () => ran()),
      { id: "corrupt-1", store: storeReturning({ formatVersion: 99, nonsense: true }) }
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { type: string }).type).toBe("PERSISTENCE_ERROR");
    expect(ran).not.toHaveBeenCalled();
  });

  it("reports a snapshot that is not an object", async () => {
    const result = await durable.run(deps, async ({ step }) => step("work", () => deps.work()), {
      id: "corrupt-2",
      store: storeReturning("not a snapshot"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result.error as { type: string }).type).toBe("PERSISTENCE_ERROR");
  });

  it("honours an external abort signal alongside the lease", async () => {
    const controller = new AbortController();
    const store: SnapshotStore & WorkflowLock = {
      ...memoryStore(),
      tryAcquire: async () => ({ ownerToken: "owner-1" }),
      release: async () => {},
      renew: async () => true,
    };

    setTimeout(() => controller.abort(), 40);

    const result = await durable.run(
      deps,
      async ({ step }) => step("slow", async () => {
        await delay(300);
        return ok("done");
      }),
      { id: "cancel-1", store, lockTtlMs: 5000, signal: controller.signal }
    );

    // Both signals feed one combined signal; the caller's must still land.
    expect(result.ok).toBe(false);
  });
});

describe("error guards", () => {
  it("isIdempotencyConflict recognises its own error and nothing else", async () => {
    const store = memoryStore();
    store.seed("idem:guard", idemSnapshot("completed", { input: { amount: 1 } }));

    const result = await durable.run(deps, async ({ step }) => step("work", () => deps.work()), {
      id: "guard-1",
      store,
      idempotencyKey: "guard",
      input: { amount: 2 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isIdempotencyConflict(result.error)).toBe(true);
    expect(isIdempotencyConflict({ type: "PERSISTENCE_ERROR" })).toBe(false);
    expect(isIdempotencyConflict(null)).toBe(false);
    expect(isIdempotencyConflict("IDEMPOTENCY_CONFLICT")).toBe(false);
  });
});
