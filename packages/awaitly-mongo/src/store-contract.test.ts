/**
 * awaitly-mongo against the shared durable store contract.
 *
 * The suite lives in awaitly/testing so all three adapters assert the same
 * behaviour. It caught this adapter reporting a held lease as lost.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { durableStoreContract, supportsLock } from "awaitly/testing";
import { mongo } from "./index";

const URL =
  process.env.TEST_MONGODB_URI ??
  (process.env.CI ? "mongodb://localhost:27017/test_awaitly" : undefined);

describe.skipIf(!URL)("durable store contract", () => {
  let store: ReturnType<typeof mongo> | undefined;

  beforeAll(async () => {
    const stamp = Date.now();
    store = mongo({ url: URL!, collection: `contract_${stamp}`, lock: { lockCollectionName: `contract_lock_${stamp}` }, clientOptions: { serverSelectionTimeoutMS: 3000 } });
    // A configured database is required. Connection and setup failures must
    // fail the suite, including in CI, rather than turn its assertions into skips.
    await store.list({ limit: 1 });
  }, 10_000);

  afterAll(async () => {
    await store?.close();
  });

  for (const contractCase of durableStoreContract) {
    it(contractCase.name, async () => {
      if (contractCase.requires === "lock") expect(supportsLock(store!)).toBe(true);
      await contractCase.run(store!);
    });
  }
});
