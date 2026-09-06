/**
 * Conformance checks every durable store adapter must satisfy.
 *
 * Three adapters ship (awaitly-mongo, awaitly-postgres, awaitly-libsql), each
 * with its own hand-written integration test, and they had drifted: Mongo's
 * `renew` reported a held lease as lost because it counted modified documents
 * rather than matched ones. A store that mis-reports a lease is a store that
 * lets two workers pay the same batch, so the contract is asserted once here
 * and every adapter runs it.
 *
 * The checks use `node:assert` rather than a test framework, so an adapter can
 * mount them under whichever runner it already uses:
 *
 * ```typescript
 * for (const c of durableStoreContract) {
 *   it(c.name, async () => c.run(await makeStore()));
 * }
 * ```
 */

import assert from "node:assert/strict";
import type { SnapshotStore, WorkflowSnapshot } from "../persistence";
import type { WorkflowLock } from "../durable";

/** The surface a contract case may use. */
export type ContractStore = SnapshotStore & Partial<WorkflowLock>;

export interface DurableStoreContractCase {
  /** Test name, unique within the suite. */
  name: string;
  /**
   * `"lock"` cases exercise `WorkflowLock`, which is optional. Skip them when
   * the adapter under test does not implement `tryAcquire`.
   */
  requires: "store" | "lock";
  run(store: ContractStore): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Unique per case so adapters can share one live database. */
const freshId = (label: string) =>
  `contract-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

function snapshot(step: string): WorkflowSnapshot {
  return {
    formatVersion: 1,
    steps: { [step]: { ok: true, value: step } },
    execution: { status: "completed", lastUpdated: new Date().toISOString() },
  } as unknown as WorkflowSnapshot;
}

export const durableStoreContract: DurableStoreContractCase[] = [
  {
    name: "load returns null for an id that was never saved",
    requires: "store",
    async run(store) {
      assert.equal(await store.load(freshId("missing")), null);
    },
  },
  {
    name: "save then load round-trips the snapshot",
    requires: "store",
    async run(store) {
      const id = freshId("roundtrip");
      await store.save(id, snapshot("first"));
      const loaded = await store.load(id);
      assert.ok(loaded, "expected a snapshot back");
      assert.deepEqual(Object.keys(loaded.steps ?? {}), ["first"]);
    },
  },
  {
    name: "save upserts rather than duplicating",
    requires: "store",
    async run(store) {
      const id = freshId("upsert");
      await store.save(id, snapshot("first"));
      await store.save(id, snapshot("second"));
      const loaded = await store.load(id);
      // A resume reads the newest snapshot. An adapter that inserts a second
      // row and loads the first replays steps that already ran.
      assert.deepEqual(Object.keys(loaded?.steps ?? {}), ["second"]);
    },
  },
  {
    name: "delete removes the snapshot",
    requires: "store",
    async run(store) {
      const id = freshId("delete");
      await store.save(id, snapshot("first"));
      await store.delete(id);
      assert.equal(await store.load(id), null);
    },
  },
  {
    name: "delete of an absent id is a no-op, not an error",
    requires: "store",
    async run(store) {
      await store.delete(freshId("absent"));
    },
  },
  {
    name: "list finds a saved id and honours prefix and limit",
    requires: "store",
    async run(store) {
      const prefix = freshId("list");
      await store.save(`${prefix}-a`, snapshot("a"));
      await store.save(`${prefix}-b`, snapshot("b"));

      const listed = await store.list({ prefix });
      assert.equal(listed.length, 2, "prefix should match exactly the two saved ids");
      for (const row of listed) {
        assert.ok(row.id.startsWith(prefix));
        assert.ok(!Number.isNaN(Date.parse(row.updatedAt)), "updatedAt must parse");
      }

      assert.equal((await store.list({ prefix, limit: 1 })).length, 1);
    },
  },

  {
    name: "tryAcquire grants a free lease",
    requires: "lock",
    async run(store) {
      const lease = await store.tryAcquire!(freshId("free"), { ttlMs: 30_000 });
      assert.ok(lease?.ownerToken, "expected an owner token");
    },
  },
  {
    name: "tryAcquire refuses a lease another owner holds",
    requires: "lock",
    async run(store) {
      const id = freshId("held");
      assert.ok(await store.tryAcquire!(id, { ttlMs: 30_000 }));
      assert.equal(
        await store.tryAcquire!(id, { ttlMs: 30_000 }),
        null,
        "a held lease must not be granted twice"
      );
    },
  },
  {
    name: "release frees the lease for the next owner",
    requires: "lock",
    async run(store) {
      const id = freshId("release");
      const lease = await store.tryAcquire!(id, { ttlMs: 30_000 });
      await store.release!(id, lease!.ownerToken);
      assert.ok(
        await store.tryAcquire!(id, { ttlMs: 30_000 }),
        "released lease should be acquirable"
      );
    },
  },
  {
    name: "release with the wrong token leaves the lease held",
    requires: "lock",
    async run(store) {
      const id = freshId("release-wrong");
      assert.ok(await store.tryAcquire!(id, { ttlMs: 30_000 }));
      // A worker whose lease already expired must not evict its successor.
      await store.release!(id, "not-the-owner");
      assert.equal(await store.tryAcquire!(id, { ttlMs: 30_000 }), null);
    },
  },
  {
    name: "an expired lease is acquirable again",
    requires: "lock",
    async run(store) {
      const id = freshId("expiry");
      assert.ok(await store.tryAcquire!(id, { ttlMs: 50 }));
      await sleep(120);
      assert.ok(
        await store.tryAcquire!(id, { ttlMs: 30_000 }),
        "a lease past its ttl must not strand the workflow"
      );
    },
  },
  {
    name: "renew extends a lease the caller owns",
    requires: "lock",
    async run(store) {
      const id = freshId("renew");
      const lease = await store.tryAcquire!(id, { ttlMs: 120 });
      if (!store.renew) return; // renew is optional; no heartbeat without it.
      assert.equal(await store.renew(id, lease!.ownerToken, { ttlMs: 30_000 }), true);
      await sleep(200);
      assert.equal(
        await store.tryAcquire!(id, { ttlMs: 30_000 }),
        null,
        "renewed lease must outlive the original ttl"
      );
    },
  },
  {
    name: "renew is idempotent within the same clock tick",
    requires: "lock",
    async run(store) {
      const id = freshId("renew-twice");
      const lease = await store.tryAcquire!(id, { ttlMs: 30_000 });
      if (!store.renew) return;
      // Back-to-back renewals can compute an identical expiry. An adapter that
      // reports "rows changed" rather than "row matched" then calls a held
      // lease lost, and the heartbeat aborts a workflow that owns its lease.
      await store.renew(id, lease!.ownerToken, { ttlMs: 30_000 });
      assert.equal(
        await store.renew(id, lease!.ownerToken, { ttlMs: 30_000 }),
        true,
        "a repeat renewal by the owner still holds the lease"
      );
    },
  },
  {
    name: "renew refuses a lease the caller does not own",
    requires: "lock",
    async run(store) {
      const id = freshId("renew-wrong");
      assert.ok(await store.tryAcquire!(id, { ttlMs: 30_000 }));
      if (!store.renew) return;
      assert.equal(await store.renew(id, "not-the-owner", { ttlMs: 30_000 }), false);
    },
  },
];

/** True when the adapter implements the optional `WorkflowLock` surface. */
export function supportsLock(store: ContractStore): boolean {
  return typeof store.tryAcquire === "function" && typeof store.release === "function";
}
