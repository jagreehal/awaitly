/**
 * Regression: renewing twice inside one millisecond.
 *
 * The shared store contract states the rule, but cannot force two renewals to
 * compute the same expiry across a real network round-trip. Freezing the clock
 * here makes the collision deterministic.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { MongoClient } from "mongodb";
import { createMongoLock } from "./mongo-lock";

const URL =
  process.env.TEST_MONGODB_URI ??
  (process.env.CI ? "mongodb://localhost:27017/test_awaitly" : undefined);

afterEach(() => {
  vi.useRealTimers();
});

describe.skipIf(!URL)("mongo lock renew", () => {
  it("still holds the lease when two renewals land on the same millisecond", async () => {
    const client = new MongoClient(URL!, { directConnection: true, serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      const lock = createMongoLock(client.db(), {
        lockCollectionName: `renew_same_ms_${Date.now()}`,
      });
      const id = `lease-${Date.now()}`;
      const lease = await lock.tryAcquire(id, { ttlMs: 30_000 });
      expect(lease).toBeTruthy();

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-05T12:00:00.000Z"));
      await lock.renew(id, lease!.ownerToken, { ttlMs: 30_000 });
      // Identical expiresAt: Mongo modifies no document, but the owner token
      // still matches, so the lease is held.
      const second = await lock.renew(id, lease!.ownerToken, { ttlMs: 30_000 });
      vi.useRealTimers();

      expect(second).toBe(true);
    } finally {
      await client.close();
    }
  }, 20_000);

  it("refuses to renew for a token that does not own the lease", async () => {
    const client = new MongoClient(URL!, { directConnection: true, serverSelectionTimeoutMS: 3000 });
    try {
      await client.connect();
      const lock = createMongoLock(client.db(), {
        lockCollectionName: `renew_wrong_${Date.now()}`,
      });
      const id = `lease-${Date.now()}`;
      await lock.tryAcquire(id, { ttlMs: 30_000 });
      expect(await lock.renew(id, "not-the-owner", { ttlMs: 30_000 })).toBe(false);
    } finally {
      await client.close();
    }
  }, 20_000);
});
