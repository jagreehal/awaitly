/**
 * awaitly-libsql against the shared durable store contract.
 *
 * Runs in-memory, so this adapter gets contract coverage on every CI run with
 * no service to stand up. It previously had no integration test at all.
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { durableStoreContract, supportsLock } from "awaitly/testing";
import { libsql } from "./index";

let store: ReturnType<typeof libsql>;

beforeAll(() => {
  store = libsql({ url: "file::memory:", lock: {} });
});

afterAll(async () => {
  await store.close();
});

describe("durable store contract", () => {
  for (const contractCase of durableStoreContract) {
    it(contractCase.name, async (context) => {
      if (contractCase.requires === "lock" && !supportsLock(store)) return context.skip();
      await contractCase.run(store);
    });
  }
});
