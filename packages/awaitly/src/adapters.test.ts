/**
 * Tests for adapters.ts - fromCallback, fromEvent
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import {
  fromCallback,
  fromEvent,
  isEventTimeoutError,
  isInvalidEmitterError,
  isEventEmitterLike,
  type NodeCallback,
  type EventEmitterLike,
} from "./adapters";

// =============================================================================
// fromCallback() tests
// =============================================================================

describe("fromCallback()", () => {
  it("returns ok result for successful callback", async () => {
    const readFileCallback = (cb: NodeCallback<string>) => {
      setTimeout(() => cb(null, "file contents"), 10);
    };

    const result = await fromCallback<string>(readFileCallback);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("file contents");
    }
  });

  it("returns err result for failed callback", async () => {
    const readFileCallback = (cb: NodeCallback<string>) => {
      setTimeout(() => cb(new Error("ENOENT"), ""), 10);
    };

    const result = await fromCallback<string>(readFileCallback);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe("ENOENT");
    }
  });

  it("preserves original error in cause", async () => {
    const originalError = new Error("Original error");
    const readFileCallback = (cb: NodeCallback<string>) => {
      cb(originalError, "");
    };

    const result = await fromCallback<string>(readFileCallback);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cause).toBe(originalError);
    }
  });

  it("maps error with custom onError", async () => {
    type FileError = { type: "FILE_ERROR"; path: string };

    const readFileCallback = (cb: NodeCallback<string>) => {
      cb(new Error("ENOENT"), "");
    };

    const result = await fromCallback<string, FileError>(readFileCallback, {
      onError: () => ({ type: "FILE_ERROR", path: "/test" }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ type: "FILE_ERROR", path: "/test" });
    }
  });

  it("handles synchronous callbacks", async () => {
    const syncCallback = (cb: NodeCallback<number>) => {
      cb(null, 42); // Synchronous call
    };

    const result = await fromCallback<number>(syncCallback);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it("handles synchronous throws in executor", async () => {
    const throwingExecutor = () => {
      throw new Error("Executor threw");
    };

    const result = await fromCallback<string>(throwingExecutor);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as Error).message).toBe("Executor threw");
    }
  });

  it("handles undefined callback result as null error", async () => {
    const undefinedErrorCallback = (cb: NodeCallback<string>) => {
      // Passing undefined for error (common in some APIs)
      cb(undefined, "success");
    };

    const result = await fromCallback<string>(undefinedErrorCallback);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("success");
    }
  });
});

// =============================================================================
// fromEvent() tests
// =============================================================================

describe("fromEvent()", () => {
  describe("with Node.js EventEmitter", () => {
    it("returns ok result on success event", async () => {
      const emitter = new EventEmitter();

      const resultPromise = fromEvent<{ data: string }>(emitter, {
        success: "success",
      });

      // Emit after starting to listen
      setTimeout(() => emitter.emit("success", { data: "hello" }), 10);

      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ data: "hello" });
      }
    });

    it("returns err result on error event", async () => {
      const emitter = new EventEmitter();

      const resultPromise = fromEvent<{ data: string }>(emitter, {
        success: "success",
        error: "error",
      });

      setTimeout(() => emitter.emit("error", new Error("Something went wrong")), 10);

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toBe("Something went wrong");
      }
    });

    it("removes listeners after success", async () => {
      const emitter = new EventEmitter();

      const resultPromise = fromEvent<string>(emitter, {
        success: "data",
        error: "error",
      });

      expect(emitter.listenerCount("data")).toBe(1);
      expect(emitter.listenerCount("error")).toBe(1);

      emitter.emit("data", "value");
      await resultPromise;

      expect(emitter.listenerCount("data")).toBe(0);
      expect(emitter.listenerCount("error")).toBe(0);
    });

    it("removes listeners after error", async () => {
      const emitter = new EventEmitter();

      const resultPromise = fromEvent<string>(emitter, {
        success: "data",
        error: "error",
      });

      emitter.emit("error", new Error("fail"));
      await resultPromise;

      expect(emitter.listenerCount("data")).toBe(0);
      expect(emitter.listenerCount("error")).toBe(0);
    });
  });

  describe("with timeout", () => {
    it("returns timeout error when timeout expires", async () => {
      const emitter = new EventEmitter();

      const result = await fromEvent<string>(emitter, {
        success: "data",
        timeout: 50,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isEventTimeoutError(result.error)).toBe(true);
        if (isEventTimeoutError(result.error)) {
          expect(result.error.event).toBe("data");
          expect(result.error.timeoutMs).toBe(50);
        }
      }
    });

    it("removes listeners after timeout", async () => {
      const emitter = new EventEmitter();

      await fromEvent<string>(emitter, {
        success: "data",
        error: "error",
        timeout: 50,
      });

      expect(emitter.listenerCount("data")).toBe(0);
      expect(emitter.listenerCount("error")).toBe(0);
    });

    it("cancels timeout on success", async () => {
      vi.useFakeTimers();
      const emitter = new EventEmitter();

      const resultPromise = fromEvent<string>(emitter, {
        success: "data",
        timeout: 1000,
      });

      // Emit before timeout
      emitter.emit("data", "early value");

      const result = await resultPromise;

      // Advance time past timeout - should not affect result
      vi.advanceTimersByTime(2000);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("early value");
      }

      vi.useRealTimers();
    });
  });

  describe("error mapping", () => {
    it("maps error with custom onError", async () => {
      type CustomError = { type: "STREAM_ERROR"; message: string };
      const emitter = new EventEmitter();

      const resultPromise = fromEvent<string, Error | CustomError>(emitter, {
        success: "data",
        error: "error",
      }, {
        onError: (e) => ({
          type: "STREAM_ERROR",
          message: e instanceof Error ? e.message : String(e),
        }),
      });

      emitter.emit("error", new Error("Stream failed"));

      const result = await resultPromise;

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ type: "STREAM_ERROR", message: "Stream failed" });
      }
    });
  });

  describe("DOM-style events (addEventListener/removeEventListener)", () => {
    it("works with addEventListener interface", async () => {
      // Mock DOM-style event target
      const listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();

      const target = {
        addEventListener: (event: string, listener: (...args: unknown[]) => void) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(listener);
        },
        removeEventListener: (event: string, listener: (...args: unknown[]) => void) => {
          listeners.get(event)?.delete(listener);
        },
        emit: (event: string, value: unknown) => {
          listeners.get(event)?.forEach((l) => l(value));
        },
      };

      const resultPromise = fromEvent<{ type: string }>(target, {
        success: "click",
      });

      setTimeout(() => target.emit("click", { type: "click" }), 10);

      const result = await resultPromise;

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ type: "click" });
      }

      // Check listeners were removed
      expect(listeners.get("click")?.size ?? 0).toBe(0);
    });
  });
});

// =============================================================================
// isEventEmitterLike() tests
// =============================================================================

describe("isEventEmitterLike()", () => {
  it("returns true for Node.js EventEmitter", () => {
    const emitter = new EventEmitter();
    expect(isEventEmitterLike(emitter)).toBe(true);
  });

  it("returns true for DOM-style event target", () => {
    const target = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    expect(isEventEmitterLike(target)).toBe(true);
  });

  it("returns false for non-emitter objects", () => {
    expect(isEventEmitterLike({})).toBe(false);
    expect(isEventEmitterLike({ on: "not a function" })).toBe(false);
    expect(isEventEmitterLike(null)).toBe(false);
    expect(isEventEmitterLike(undefined)).toBe(false);
  });
});

// =============================================================================
// isEventTimeoutError() tests
// =============================================================================

describe("isEventTimeoutError()", () => {
  it("returns true for EventTimeoutError", () => {
    const error = { type: "EVENT_TIMEOUT", event: "data", timeoutMs: 5000 };
    expect(isEventTimeoutError(error)).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isEventTimeoutError({ type: "OTHER" })).toBe(false);
    expect(isEventTimeoutError(new Error("test"))).toBe(false);
    expect(isEventTimeoutError(null)).toBe(false);
  });
});

// =============================================================================
// isInvalidEmitterError() tests
// =============================================================================

describe("isInvalidEmitterError()", () => {
  it("returns true for InvalidEmitterError", () => {
    const error = { type: "INVALID_EMITTER", message: "test message" };
    expect(isInvalidEmitterError(error)).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isInvalidEmitterError({ type: "OTHER" })).toBe(false);
    expect(isInvalidEmitterError(new Error("test"))).toBe(false);
    expect(isInvalidEmitterError(null)).toBe(false);
    expect(isInvalidEmitterError({ type: "EVENT_TIMEOUT" })).toBe(false);
  });
});

// =============================================================================
// fromEvent() invalid emitter tests
// =============================================================================

describe("fromEvent() with invalid emitter", () => {
  it("returns InvalidEmitterError for objects without event methods", async () => {
    // Object without on/off or addEventListener/removeEventListener
    const notAnEmitter = { foo: "bar" };

    const result = await fromEvent<string>(notAnEmitter as EventEmitterLike, {
      success: "data",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isInvalidEmitterError(result.error)).toBe(true);
      if (isInvalidEmitterError(result.error)) {
        expect(result.error.type).toBe("INVALID_EMITTER");
        expect(result.error.message).toContain("on/off");
      }
    }
  });

  it("returns InvalidEmitterError for null-like values", async () => {
    const result = await fromEvent<string>({} as EventEmitterLike, {
      success: "data",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isInvalidEmitterError(result.error)).toBe(true);
    }
  });
});
