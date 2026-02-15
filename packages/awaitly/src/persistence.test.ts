import { describe, it, expect, vi } from "vitest";
import {
  createMemoryCache,
  // Snapshot API
  looksLikeWorkflowSnapshot,
  validateSnapshot,
  assertValidSnapshot,
  mergeSnapshots,
  serializeError,
  serializeThrown,
  deserializeCauseNew,
  SnapshotFormatError,
  SnapshotMismatchError,
  SnapshotDecodeError,
  type WorkflowSnapshot,
  type StepResult,
  type SerializedCause,
} from "./persistence";
import { ok } from "./core";

type SerializedError = Extract<SerializedCause, { type: "error" }>;
type SerializedThrown = Extract<SerializedCause, { type: "thrown" }>;

describe("Persistence", () => {
  describe("createMemoryCache", () => {
    it("should create a basic cache", () => {
      const cache = createMemoryCache();

      expect(cache.get("key1")).toBeUndefined();
      expect(cache.has("key1")).toBe(false);

      cache.set("key1", ok("value1"));
      expect(cache.has("key1")).toBe(true);

      const result = cache.get("key1");
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.value).toBe("value1");
      }
    });

    it("should support delete", () => {
      const cache = createMemoryCache();

      cache.set("key1", ok("value1"));
      expect(cache.has("key1")).toBe(true);

      const deleted = cache.delete("key1");
      expect(deleted).toBe(true);
      expect(cache.has("key1")).toBe(false);
    });

    it("should support clear", () => {
      const cache = createMemoryCache();

      cache.set("key1", ok("value1"));
      cache.set("key2", ok("value2"));

      cache.clear();

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(false);
    });

    it("should support TTL expiration", () => {
      vi.useFakeTimers();

      const cache = createMemoryCache({ ttl: 1000 });

      cache.set("key1", ok("value1"));
      expect(cache.has("key1")).toBe(true);

      vi.advanceTimersByTime(500);
      expect(cache.has("key1")).toBe(true);

      vi.advanceTimersByTime(600);
      expect(cache.has("key1")).toBe(false);
      expect(cache.get("key1")).toBeUndefined();

      vi.useRealTimers();
    });

    it("should support per-entry TTL that overrides global TTL", () => {
      vi.useFakeTimers();

      const cache = createMemoryCache({ ttl: 1000 });

      // Set entry with custom TTL (500ms, shorter than global 1000ms)
      cache.set("short", ok("short-value"), { ttl: 500 });
      // Set entry using global TTL
      cache.set("normal", ok("normal-value"));

      expect(cache.has("short")).toBe(true);
      expect(cache.has("normal")).toBe(true);

      // After 600ms, short should be expired, normal should still exist
      vi.advanceTimersByTime(600);
      expect(cache.has("short")).toBe(false);
      expect(cache.has("normal")).toBe(true);

      // After another 500ms (total 1100ms), normal should also be expired
      vi.advanceTimersByTime(500);
      expect(cache.has("normal")).toBe(false);

      vi.useRealTimers();
    });

    it("should handle per-entry TTL without global TTL", () => {
      vi.useFakeTimers();

      // No global TTL
      const cache = createMemoryCache();

      // Set entry with custom TTL
      cache.set("with-ttl", ok("value1"), { ttl: 500 });
      // Set entry without TTL (should never expire)
      cache.set("no-ttl", ok("value2"));

      expect(cache.has("with-ttl")).toBe(true);
      expect(cache.has("no-ttl")).toBe(true);

      // After 600ms, entry with TTL should be expired
      vi.advanceTimersByTime(600);
      expect(cache.has("with-ttl")).toBe(false);
      expect(cache.has("no-ttl")).toBe(true);

      // Entry without TTL should persist indefinitely
      vi.advanceTimersByTime(100000);
      expect(cache.has("no-ttl")).toBe(true);

      vi.useRealTimers();
    });

    it("should use global TTL when per-entry TTL is undefined", () => {
      vi.useFakeTimers();

      const cache = createMemoryCache({ ttl: 1000 });

      // Set entry with explicit undefined TTL (should use global)
      cache.set("key1", ok("value1"), { ttl: undefined });
      cache.set("key2", ok("value2"), {});
      cache.set("key3", ok("value3"));

      expect(cache.has("key1")).toBe(true);
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(true);

      // All should expire at global TTL
      vi.advanceTimersByTime(1100);
      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(false);
      expect(cache.has("key3")).toBe(false);

      vi.useRealTimers();
    });

    it("should support per-entry TTL longer than global TTL", () => {
      vi.useFakeTimers();

      const cache = createMemoryCache({ ttl: 500 });

      // Set entry with longer TTL than global
      cache.set("long", ok("long-value"), { ttl: 2000 });
      cache.set("normal", ok("normal-value"));

      expect(cache.has("long")).toBe(true);
      expect(cache.has("normal")).toBe(true);

      // After 600ms, normal should be expired, long should still exist
      vi.advanceTimersByTime(600);
      expect(cache.has("long")).toBe(true);
      expect(cache.has("normal")).toBe(false);

      // After another 1500ms (total 2100ms), long should also be expired
      vi.advanceTimersByTime(1500);
      expect(cache.has("long")).toBe(false);

      vi.useRealTimers();
    });

    it("should support maxSize with LRU eviction", () => {
      vi.useFakeTimers();

      const cache = createMemoryCache({ maxSize: 2 });

      cache.set("key1", ok("value1"));
      vi.advanceTimersByTime(10);
      cache.set("key2", ok("value2"));
      vi.advanceTimersByTime(10);

      // This should evict key1 (oldest)
      cache.set("key3", ok("value3"));

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(true);
      expect(cache.has("key3")).toBe(true);

      vi.useRealTimers();
    });
  });

  // =============================================================================
  // Snapshot API Tests
  // =============================================================================

  describe("WorkflowSnapshot validation", () => {
    describe("looksLikeWorkflowSnapshot", () => {
      it("should return true for valid snapshots", () => {
        const snapshot: WorkflowSnapshot = {
          formatVersion: 1,
          steps: {},
          execution: {
            status: "running",
            lastUpdated: new Date().toISOString(),
          },
        };
        expect(looksLikeWorkflowSnapshot(snapshot)).toBe(true);
      });

      it("should return false for null", () => {
        expect(looksLikeWorkflowSnapshot(null)).toBe(false);
      });

      it("should return false for undefined", () => {
        expect(looksLikeWorkflowSnapshot(undefined)).toBe(false);
      });

      it("should return false for non-objects", () => {
        expect(looksLikeWorkflowSnapshot("string")).toBe(false);
        expect(looksLikeWorkflowSnapshot(123)).toBe(false);
        expect(looksLikeWorkflowSnapshot(true)).toBe(false);
      });

      it("should return false for missing formatVersion", () => {
        expect(looksLikeWorkflowSnapshot({ steps: {} })).toBe(false);
      });

      it("should return false for wrong formatVersion", () => {
        expect(looksLikeWorkflowSnapshot({ formatVersion: 2, steps: {} })).toBe(false);
      });

      it("should return false for missing steps", () => {
        expect(looksLikeWorkflowSnapshot({ formatVersion: 1 })).toBe(false);
      });
    });

    describe("validateSnapshot", () => {
      it("should return valid for correct snapshot", () => {
        const snapshot: WorkflowSnapshot = {
          formatVersion: 1,
          steps: {
            "step-1": { ok: true, value: "result" },
          },
          execution: {
            status: "completed",
            lastUpdated: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        };
        const result = validateSnapshot(snapshot);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.snapshot).toEqual(snapshot);
        }
      });

      it("should return errors for invalid structure", () => {
        const result = validateSnapshot({ invalid: true });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors.length).toBeGreaterThan(0);
        }
      });

      it("should return errors for null", () => {
        const result = validateSnapshot(null);
        expect(result.valid).toBe(false);
      });

      it("should return errors for wrong formatVersion", () => {
        const result = validateSnapshot({
          formatVersion: 99,
          steps: {},
          execution: { status: "running", lastUpdated: new Date().toISOString() },
        });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors.some(e => e.includes("formatVersion"))).toBe(true);
        }
      });

      it("should return errors for invalid step result", () => {
        const result = validateSnapshot({
          formatVersion: 1,
          steps: {
            "step-1": { invalid: true },
          },
          execution: { status: "running", lastUpdated: new Date().toISOString() },
        });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.errors.some(e => e.includes("step-1"))).toBe(true);
        }
      });
    });

    describe("assertValidSnapshot", () => {
      it("should return snapshot for valid input", () => {
        const snapshot: WorkflowSnapshot = {
          formatVersion: 1,
          steps: {},
          execution: {
            status: "running",
            lastUpdated: new Date().toISOString(),
          },
        };
        const result = assertValidSnapshot(snapshot);
        expect(result).toEqual(snapshot);
      });

      it("should throw SnapshotFormatError for invalid input", () => {
        expect(() => assertValidSnapshot({ invalid: true })).toThrow(SnapshotFormatError);
      });

      it("should throw SnapshotFormatError for null", () => {
        expect(() => assertValidSnapshot(null)).toThrow(SnapshotFormatError);
      });
    });
  });

  describe("Error serialization", () => {
    describe("serializeError", () => {
      it("should serialize basic Error", () => {
        const error = new Error("Something went wrong");
        const serialized = serializeError(error) as SerializedError;

        expect(serialized.type).toBe("error");
        expect(serialized.name).toBe("Error");
        expect(serialized.message).toBe("Something went wrong");
        expect(serialized.stack).toBeDefined();
      });

      it("should serialize custom error name", () => {
        const error = new TypeError("Invalid type");
        const serialized = serializeError(error) as SerializedError;

        expect(serialized.type).toBe("error");
        expect(serialized.name).toBe("TypeError");
        expect(serialized.message).toBe("Invalid type");
      });

      it("should serialize Error.cause recursively", () => {
        const cause = new Error("Root cause");
        const error = new Error("Outer error");
        (error as Error & { cause: Error }).cause = cause;

        const serialized = serializeError(error) as SerializedError;

        expect(serialized.type).toBe("error");
        expect(serialized.cause).toBeDefined();
        expect(serialized.cause?.type).toBe("error");
        const serializedCause = serialized.cause as SerializedError | undefined;
        expect(serializedCause?.message).toBe("Root cause");
      });

      it("should handle nested cause chain", () => {
        const root = new Error("Root");
        const middle = new Error("Middle");
        const outer = new Error("Outer");
        (middle as Error & { cause: Error }).cause = root;
        (outer as Error & { cause: Error }).cause = middle;

        const serialized = serializeError(outer) as SerializedError;

        expect(serialized.message).toBe("Outer");
        const middleCause = serialized.cause as SerializedError | undefined;
        expect(middleCause?.message).toBe("Middle");
        const rootCause = middleCause?.cause as SerializedError | undefined;
        expect(rootCause?.message).toBe("Root");
      });
    });

    describe("serializeThrown", () => {
      it("should serialize string throws", () => {
        const serialized = serializeThrown("simple error") as SerializedThrown;

        expect(serialized.type).toBe("thrown");
        expect(serialized.originalType).toBe("string");
        expect(serialized.value).toBe("simple error");
        expect(serialized.stringRepresentation).toBe("simple error");
      });

      it("should serialize number throws", () => {
        const serialized = serializeThrown(42) as SerializedThrown;

        expect(serialized.type).toBe("thrown");
        expect(serialized.originalType).toBe("number");
        expect(serialized.value).toBe(42);
        expect(serialized.stringRepresentation).toBe("42");
      });

      it("should serialize boolean throws", () => {
        const serialized = serializeThrown(false) as SerializedThrown;

        expect(serialized.type).toBe("thrown");
        expect(serialized.originalType).toBe("boolean");
        expect(serialized.value).toBe(false);
      });

      it("should serialize null throws", () => {
        const serialized = serializeThrown(null) as SerializedThrown;

        expect(serialized.type).toBe("thrown");
        expect(serialized.originalType).toBe("null");
        expect(serialized.value).toBe(null);
      });

      it("should serialize object throws", () => {
        const obj = { code: "NOT_FOUND", id: "123" };
        const serialized = serializeThrown(obj) as SerializedThrown;

        expect(serialized.type).toBe("thrown");
        expect(serialized.originalType).toBe("Object");
        expect(serialized.value).toEqual(obj);
      });

      it("should handle non-JSON-serializable values", () => {
        const circular: Record<string, unknown> = { name: "test" };
        circular.self = circular;

        const serialized = serializeThrown(circular) as SerializedThrown;

        expect(serialized.type).toBe("thrown");
        expect(serialized.stringRepresentation).toBeDefined();
        // value should be omitted for non-serializable
        expect(serialized.value).toBeUndefined();
      });

      it("should handle symbols", () => {
        const sym = Symbol("test");
        const serialized = serializeThrown(sym) as SerializedThrown;

        expect(serialized.type).toBe("thrown");
        expect(serialized.originalType).toBe("symbol");
        expect(serialized.stringRepresentation).toContain("Symbol");
      });

      it("should handle functions", () => {
        const fn = () => "test";
        const serialized = serializeThrown(fn) as SerializedThrown;

        expect(serialized.type).toBe("thrown");
        expect(serialized.originalType).toBe("function");
      });
    });

    describe("deserializeCauseNew", () => {
      it("should deserialize error type to Error instance", () => {
        const serialized: SerializedCause = {
          type: "error",
          name: "TypeError",
          message: "Invalid type",
          stack: "Error: Invalid type\n    at test.ts:1:1",
        };

        const error = deserializeCauseNew(serialized) as Error;

        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe("TypeError");
        expect(error.message).toBe("Invalid type");
        expect(error.stack).toBe("Error: Invalid type\n    at test.ts:1:1");
      });

      it("should deserialize nested cause", () => {
        const serialized: SerializedCause = {
          type: "error",
          name: "Error",
          message: "Outer",
          cause: {
            type: "error",
            name: "Error",
            message: "Inner",
          },
        };

        const error = deserializeCauseNew(serialized) as Error & { cause?: Error };

        expect(error.message).toBe("Outer");
        expect(error.cause).toBeInstanceOf(Error);
        expect(error.cause?.message).toBe("Inner");
      });

      it("should deserialize thrown type with value", () => {
        const serialized: SerializedCause = {
          type: "thrown",
          originalType: "object",
          value: { code: "NOT_FOUND" },
          stringRepresentation: '{"code":"NOT_FOUND"}',
        };

        const result = deserializeCauseNew(serialized);
        expect(result).toEqual({ code: "NOT_FOUND" });
      });

      it("should deserialize thrown type without value using stringRepresentation", () => {
        const serialized: SerializedCause = {
          type: "thrown",
          originalType: "object",
          stringRepresentation: "[Circular object]",
        };

        const result = deserializeCauseNew(serialized);
        expect(result).toBe("[Circular object]");
      });
    });
  });

  describe("mergeSnapshots", () => {
    it("should merge steps from delta into base", () => {
      const base: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "step-1": { ok: true, value: "a" },
          "step-2": { ok: true, value: "b" },
        },
        execution: { status: "running", lastUpdated: "2024-01-01T00:00:00Z" },
      };

      const delta: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "step-3": { ok: true, value: "c" },
        },
        execution: { status: "running", lastUpdated: "2024-01-01T00:01:00Z" },
      };

      const merged = mergeSnapshots(base, delta);

      expect(Object.keys(merged.steps)).toEqual(["step-1", "step-2", "step-3"]);
      expect(merged.steps["step-1"]).toEqual({ ok: true, value: "a" });
      expect(merged.steps["step-3"]).toEqual({ ok: true, value: "c" });
    });

    it("should overwrite base steps with delta steps", () => {
      const base: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "step-1": { ok: true, value: "old" },
        },
        execution: { status: "running", lastUpdated: "2024-01-01T00:00:00Z" },
      };

      const delta: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "step-1": { ok: true, value: "new" },
        },
        execution: { status: "running", lastUpdated: "2024-01-01T00:01:00Z" },
      };

      const merged = mergeSnapshots(base, delta);

      expect(merged.steps["step-1"]).toEqual({ ok: true, value: "new" });
    });

    it("should use execution from delta", () => {
      const base: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {},
        execution: {
          status: "running",
          lastUpdated: "2024-01-01T00:00:00Z",
          currentStepId: "step-1",
        },
      };

      const delta: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {},
        execution: {
          status: "completed",
          lastUpdated: "2024-01-01T00:01:00Z",
          completedAt: "2024-01-01T00:01:00Z",
        },
      };

      const merged = mergeSnapshots(base, delta);

      expect(merged.execution.status).toBe("completed");
      expect(merged.execution.completedAt).toBe("2024-01-01T00:01:00Z");
    });

    it("should shallow merge metadata", () => {
      const base: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {},
        execution: { status: "running", lastUpdated: "2024-01-01T00:00:00Z" },
        metadata: {
          workflowId: "wf-1",
          input: { userId: "123" },
        },
      };

      const delta: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {},
        execution: { status: "running", lastUpdated: "2024-01-01T00:01:00Z" },
        metadata: {
          definitionHash: "abc123",
        },
      };

      const merged = mergeSnapshots(base, delta);

      expect(merged.metadata?.workflowId).toBe("wf-1");
      expect(merged.metadata?.definitionHash).toBe("abc123");
      expect(merged.metadata?.input).toEqual({ userId: "123" });
    });

    it("should merge warnings arrays", () => {
      const base: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {},
        execution: { status: "running", lastUpdated: "2024-01-01T00:00:00Z" },
        warnings: [
          { type: "lossy_value", stepId: "step-1", path: ".date", reason: "non-json" },
        ],
      };

      const delta: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {},
        execution: { status: "running", lastUpdated: "2024-01-01T00:01:00Z" },
        warnings: [
          { type: "lossy_value", stepId: "step-2", path: ".fn", reason: "non-json" },
        ],
      };

      const merged = mergeSnapshots(base, delta);

      expect(merged.warnings?.length).toBe(2);
    });
  });

  describe("StepResult type", () => {
    it("should accept ok result", () => {
      const result: StepResult = { ok: true, value: { id: "1" } };
      expect(result.ok).toBe(true);
    });

    it("should accept err result with cause", () => {
      const result: StepResult = {
        ok: false,
        error: "Failed",
        cause: {
          type: "error",
          name: "Error",
          message: "Failed",
        },
      };
      expect(result.ok).toBe(false);
    });

    it("should accept err result with meta", () => {
      const result: StepResult = {
        ok: false,
        error: "test",
        cause: {
          type: "thrown",
          originalType: "string",
          stringRepresentation: "test",
        },
        meta: { origin: "throw" },
      };
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.meta?.origin).toBe("throw");
      }
    });
  });

  describe("Error classes", () => {
    it("SnapshotFormatError should be instanceof Error", () => {
      const error = new SnapshotFormatError("Invalid format");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SnapshotFormatError);
      expect(error.name).toBe("SnapshotFormatError");
      expect(error.message).toBe("Invalid format");
    });

    it("SnapshotMismatchError should be instanceof Error", () => {
      const error = new SnapshotMismatchError("Unknown steps", "unknown_steps");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SnapshotMismatchError);
      expect(error.name).toBe("SnapshotMismatchError");
    });

    it("SnapshotDecodeError should be instanceof Error", () => {
      const error = new SnapshotDecodeError("Decode failed", "step-1");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SnapshotDecodeError);
      expect(error.name).toBe("SnapshotDecodeError");
    });
  });

  describe("JSON round-trip", () => {
    it("WorkflowSnapshot should survive JSON.stringify/parse", () => {
      const snapshot: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "step-1": { ok: true, value: { id: "1", data: [1, 2, 3] } },
          "step-2": {
            ok: false,
            error: "FAILED",
            cause: {
              type: "error",
              name: "Error",
              message: "Failed",
              stack: "Error: Failed\n    at test.ts:1:1",
            },
          },
        },
        execution: {
          status: "failed",
          lastUpdated: "2024-01-01T12:00:00.000Z",
        },
        metadata: {
          workflowId: "wf-123",
          input: { userId: "u-456" },
        },
      };

      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json) as WorkflowSnapshot;

      expect(parsed).toEqual(snapshot);
      expect(looksLikeWorkflowSnapshot(parsed)).toBe(true);
      expect(validateSnapshot(parsed).valid).toBe(true);
    });

    it("should handle null values in steps", () => {
      const snapshot: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "step-1": { ok: true, value: null },
        },
        execution: { status: "running", lastUpdated: new Date().toISOString() },
      };

      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json) as WorkflowSnapshot;

      expect(parsed.steps["step-1"]).toEqual({ ok: true, value: null });
    });

    it("should handle deeply nested values", () => {
      const snapshot: WorkflowSnapshot = {
        formatVersion: 1,
        steps: {
          "step-1": {
            ok: true,
            value: {
              level1: {
                level2: {
                  level3: {
                    data: [{ nested: true }],
                  },
                },
              },
            },
          },
        },
        execution: { status: "running", lastUpdated: new Date().toISOString() },
      };

      const json = JSON.stringify(snapshot);
      const parsed = JSON.parse(json) as WorkflowSnapshot;

      expect(parsed.steps["step-1"]).toEqual(snapshot.steps["step-1"]);
    });
  });
});
