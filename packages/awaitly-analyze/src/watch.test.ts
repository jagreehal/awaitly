import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { FSWatcher } from "fs";

const { closeMock, watchMock, getListener } = vi.hoisted(() => {
  const closeMock = vi.fn();
  let listener: ((eventType: string) => void) | undefined;
  const watchMock = vi.fn((_filePath: string, _listener: (eventType: string) => void) => {
    listener = _listener;
    return {
      close: closeMock,
    } as unknown as FSWatcher;
  });

  return { closeMock, watchMock, getListener: () => listener };
});

vi.mock("fs", () => ({
  watch: watchMock,
}));

import { startWatch } from "./watch";

describe("startWatch", () => {
  beforeEach(() => {
    closeMock.mockClear();
    watchMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes installed signal handlers when stopped", () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    const handle = startWatch({
      filePath: "/tmp/workflow.ts",
      onRebuild: () => {},
      onError: () => {},
    });

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

    handle.stop();

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  it("rebuilds on rename events as well as change events", async () => {
    const onRebuild = vi.fn();

    const handle = startWatch({
      filePath: "/tmp/workflow.ts",
      debounceMs: 0,
      onRebuild,
      onError: () => {},
    });

    const listener = getListener();
    expect(listener).toBeTypeOf("function");

    listener!("rename");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onRebuild).toHaveBeenCalledTimes(1);

    handle.stop();
  });
});
