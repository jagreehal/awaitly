import { describe, expect, it, vi } from "vitest";
import { tryAsyncRetry } from "./retry";

describe("awaitly/result/retry surface", () => {
  it("exports tryAsyncRetry from awaitly/result/retry", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await tryAsyncRetry(fn, { retry: { times: 1, delayMs: 1 } });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
