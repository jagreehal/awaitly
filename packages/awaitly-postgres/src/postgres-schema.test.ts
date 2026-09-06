import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createSchemaInitializer } from "./postgres-schema";

describe("schema initialization", () => {
  it("rolls back a failed initialization, releases its connection, and retries", async () => {
    const failure = new Error("connection interrupted during DDL");
    let fail = true;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === "CREATE TABLE example ()" && fail) {
          fail = false;
          throw failure;
        }
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const initialize = createSchemaInitializer(pool as unknown as Pool, "example", "CREATE TABLE example ()");
    await expect(initialize()).rejects.toBe(failure);
    expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
    await expect(initialize()).resolves.toBeUndefined();
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(2);
    await initialize();
    expect(pool.connect).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight initialization instead of consuming more pool connections", async () => {
    let unblock!: () => void;
    const ready = new Promise<void>((resolve) => { unblock = resolve; });
    const client = { query: vi.fn(async () => ready), release: vi.fn() };
    const pool = { connect: vi.fn(async () => client) };
    const initialize = createSchemaInitializer(pool as unknown as Pool, "example", "CREATE TABLE example ()");
    const first = initialize();
    const second = initialize();
    expect(first).toBe(second);
    unblock();
    await Promise.all([first, second]);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
