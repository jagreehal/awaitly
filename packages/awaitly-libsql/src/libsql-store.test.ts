import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LibSqlKeyValueStore } from "./libsql-store";
import * as fs from "node:fs/promises";

const DB_PATH = "./.tmp-libsql-test.db";

describe("LibSqlKeyValueStore", () => {
  let store: LibSqlKeyValueStore;

  beforeEach(async () => {
    // Ensure a clean database file for each test
    try {
      await fs.unlink(DB_PATH);
    } catch {
      // ignore missing file
    }
    store = new LibSqlKeyValueStore({ url: `file:${DB_PATH}` });
    // Trigger initialization
    await store.get("init");
  });

  afterEach(async () => {
    await store.close();
    try {
      await fs.unlink(DB_PATH);
    } catch {
      // ignore
    }
  });

  it("stores and retrieves values", async () => {
    await store.set("key1", "value1");
    const value = await store.get("key1");
    expect(value).toBe("value1");
  });

  it("returns null for missing keys", async () => {
    const value = await store.get("missing");
    expect(value).toBeNull();
  });

  it("deletes keys", async () => {
    await store.set("k", "v");
    const deleted = await store.delete("k");
    expect(deleted).toBe(true);
    expect(await store.get("k")).toBeNull();
  });

  it("supports TTL expiration", async () => {
    await store.set("ttl-key", "short-lived", { ttl: 1 });
    expect(await store.get("ttl-key")).toBe("short-lived");
    await new Promise((r) => setTimeout(r, 1200));
    expect(await store.get("ttl-key")).toBeNull();
  });

  it("filters keys by pattern", async () => {
    await store.set("workflow:state:one", "1");
    await store.set("workflow:state:two", "2");
    await store.set("other:thing", "x");

    const keys = await store.keys("workflow:state:*");
    expect(keys).toContain("workflow:state:one");
    expect(keys).toContain("workflow:state:two");
    expect(keys).not.toContain("other:thing");
  });
});

