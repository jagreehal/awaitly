import { afterEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { postgres } from "./index";

afterEach(() => vi.restoreAllMocks());

describe("background connection errors", () => {
  it.each([false, true])("keeps an owned pool alive, with reporting=%s", async (reporting) => {
    const on = vi.spyOn(Pool.prototype, "on");
    const report = vi.fn();
    const store = postgres({ url: "postgresql://localhost/test", onPoolError: reporting ? report : undefined });
    try {
      const pool = on.mock.contexts.find((context) => context instanceof Pool)!;
      const error = new Error("database restarted");
      expect(() => pool.emit("error", error)).not.toThrow();
      if (reporting) expect(report).toHaveBeenCalledWith(error);
      else expect(report).not.toHaveBeenCalled();
    } finally {
      await store.close();
    }
  });

  it("leaves caller-owned pool error handling and lifecycle intact", async () => {
    const pool = new Pool({ connectionString: "postgresql://localhost/test" });
    const report = vi.fn();
    pool.on("error", report);
    const listeners = pool.listeners("error");
    const end = vi.spyOn(pool, "end");
    const store = postgres({ url: "postgresql://localhost/test", pool });
    await store.close();
    expect(end).not.toHaveBeenCalled();
    expect(pool.listeners("error")).toEqual(listeners);
    await pool.end();
  });
});
