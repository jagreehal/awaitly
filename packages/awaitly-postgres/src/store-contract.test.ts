/**
 * awaitly-postgres against the shared durable store contract.
 *
 * The suite lives in awaitly/testing so all three adapters assert the same
 * behaviour rather than each adapter's own reading of it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { durableStoreContract, supportsLock } from "awaitly/testing";
import { postgres } from "./index";

const URL =
  process.env.TEST_POSTGRES_CONNECTION_STRING ??
  (process.env.CI ? "postgresql://postgres:postgres@localhost:5432/test_awaitly" : undefined);

describe.skipIf(!URL)("durable store contract", () => {
  let store: ReturnType<typeof postgres> | undefined;

  beforeAll(async () => {
    const stamp = Date.now();
    store = postgres({ url: URL!, table: `contract_${stamp}`, lock: { lockTableName: `contract_lock_${stamp}` } });
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
