import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LibSqlKeyValueStore, createLibSqlPersistence } from "./index";
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

  it("listKeys returns paginated keys with limit and offset", async () => {
    await store.set("p:1", "v1");
    await store.set("p:2", "v2");
    await store.set("p:3", "v3");

    const page1 = await store.listKeys("p:*", { limit: 2, offset: 0 });
    expect(page1.keys.length).toBe(2);
    expect(page1.keys.every((k) => k.startsWith("p:"))).toBe(true);

    const page2 = await store.listKeys("p:*", { limit: 2, offset: 2 });
    expect(page2.keys.length).toBe(1);
  });

  it("listKeys returns total when includeTotal is true", async () => {
    await store.set("t:1", "v1");
    await store.set("t:2", "v2");

    const result = await store.listKeys("t:*", { limit: 10, includeTotal: true });
    expect(result.keys.length).toBe(2);
    expect(result.total).toBe(2);
  });
});

describe("createLibSqlPersistence listPage", () => {
  const DB_PATH_PAGE = "./.tmp-libsql-listpage.db";

  beforeEach(async () => {
    try {
      await fs.unlink(DB_PATH_PAGE);
    } catch {
      // ignore
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(DB_PATH_PAGE);
    } catch {
      // ignore
    }
  });

  it("listPage returns ids with nextOffset when more results exist", async () => {
    const persistence = await createLibSqlPersistence({ url: `file:${DB_PATH_PAGE}` });
    await persistence.save("run-1", { steps: new Map() });
    await persistence.save("run-2", { steps: new Map() });
    await persistence.save("run-3", { steps: new Map() });

    const page1 = await persistence.listPage({ limit: 2, offset: 0 });
    expect(page1.ids.length).toBe(2);
    expect(page1.nextOffset).toBe(2);

    const page2 = await persistence.listPage({ limit: 2, offset: 2 });
    expect(page2.ids.length).toBe(1);
    expect(page2.nextOffset).toBeUndefined();
  });
});

describe("createLibSqlPersistence with lock", () => {
  const DB_PATH_LOCK = "./.tmp-libsql-lock.db";

  beforeEach(async () => {
    try {
      await fs.unlink(DB_PATH_LOCK);
    } catch {
      // ignore
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(DB_PATH_LOCK);
    } catch {
      // ignore
    }
  });

  it("lock: second tryAcquire returns null when lease is still active", async () => {
    const persistence = await createLibSqlPersistence({
      url: `file:${DB_PATH_LOCK}`,
      lock: { lockTableName: "test_workflow_lock" },
    });
    const lockStore = persistence as unknown as {
      tryAcquire(id: string, opts?: { ttlMs?: number }): Promise<{ ownerToken: string } | null>;
      release(id: string, ownerToken: string): Promise<void>;
    };

    const id = `lock-${Date.now()}`;
    const lease1 = await lockStore.tryAcquire(id, { ttlMs: 60_000 });
    expect(lease1).toBeTruthy();

    const lease2 = await lockStore.tryAcquire(id, { ttlMs: 60_000 });
    expect(lease2).toBeNull();

    if (lease1) {
      await lockStore.release(id, lease1.ownerToken);
    }
    const lease3 = await lockStore.tryAcquire(id, { ttlMs: 60_000 });
    expect(lease3).toBeTruthy();
  });
});

