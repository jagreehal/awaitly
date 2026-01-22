import { describe, it, expect, vi } from "vitest";
import {
  processInBatches,
  isBatchProcessingError,
  isInvalidBatchConfigError,
  batchPresets,
  type BatchProgress,
  type BatchProcessingError,
  type InvalidBatchConfigError,
} from "./batch";
import { ok, err, type AsyncResult } from "./core";

describe("Batch Processing", () => {
  describe("processInBatches", () => {
    it("should process all items and return results in order", async () => {
      const items = [1, 2, 3, 4, 5];
      const process = async (n: number): AsyncResult<number, never> => ok(n * 2);

      const result = await processInBatches(items, process, {
        batchSize: 2,
        concurrency: 2,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([2, 4, 6, 8, 10]);
      }
    });

    it("should handle empty input gracefully", async () => {
      const items: number[] = [];
      const process = vi.fn();

      const result = await processInBatches(items, process, {
        batchSize: 10,
        concurrency: 5,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
      expect(process).not.toHaveBeenCalled();
    });

    it("should respect batch size configuration", async () => {
      const items = [1, 2, 3, 4, 5, 6, 7];
      const batchesProcessed: number[][] = [];
      let currentBatch: number[] = [];

      const process = async (n: number, idx: number): AsyncResult<number, never> => {
        currentBatch.push(n);
        // When we've processed batchSize items, record the batch
        if (currentBatch.length === 3 || idx === items.length - 1) {
          batchesProcessed.push([...currentBatch]);
          currentBatch = [];
        }
        return ok(n);
      };

      const progressCalls: BatchProgress[] = [];
      await processInBatches(
        items,
        process,
        { batchSize: 3, concurrency: 1 },
        { onProgress: (p) => progressCalls.push({ ...p }) }
      );

      // Should have 3 batches: [1,2,3], [4,5,6], [7]
      expect(progressCalls.length).toBe(3);
      expect(progressCalls[0].batch).toBe(1);
      expect(progressCalls[0].totalBatches).toBe(3);
      expect(progressCalls[1].batch).toBe(2);
      expect(progressCalls[2].batch).toBe(3);
    });

    it("should report progress correctly", async () => {
      const items = [1, 2, 3, 4, 5];
      const progressCalls: BatchProgress[] = [];

      await processInBatches(
        items,
        async (n) => ok(n),
        { batchSize: 2, concurrency: 2 },
        { onProgress: (p) => progressCalls.push({ ...p }) }
      );

      expect(progressCalls.length).toBe(3); // batches: [1,2], [3,4], [5]

      expect(progressCalls[0]).toEqual({
        batch: 1,
        totalBatches: 3,
        processed: 2,
        total: 5,
        percent: 40,
      });

      expect(progressCalls[1]).toEqual({
        batch: 2,
        totalBatches: 3,
        processed: 4,
        total: 5,
        percent: 80,
      });

      expect(progressCalls[2]).toEqual({
        batch: 3,
        totalBatches: 3,
        processed: 5,
        total: 5,
        percent: 100,
      });
    });

    it("should call afterBatch hook after each batch", async () => {
      const items = [1, 2, 3, 4, 5];
      const checkpoints: number[] = [];

      const afterBatch = vi.fn().mockImplementation(async () => {
        checkpoints.push(Date.now());
        return ok(undefined);
      });

      await processInBatches(
        items,
        async (n) => ok(n),
        { batchSize: 2, concurrency: 2 },
        { afterBatch }
      );

      // 3 batches = 3 afterBatch calls
      expect(afterBatch).toHaveBeenCalledTimes(3);
    });

    it("should stop processing on first error", async () => {
      const items = [1, 2, 3, 4, 5];
      const processedItems: number[] = [];

      const process = async (n: number): AsyncResult<number, "FAIL"> => {
        processedItems.push(n);
        if (n === 3) return err("FAIL");
        return ok(n);
      };

      const result = await processInBatches(items, process, {
        batchSize: 5, // All in one batch to ensure predictable order
        concurrency: 1, // Sequential to ensure order
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isBatchProcessingError(result.error)).toBe(true);
        const batchError = result.error as BatchProcessingError<"FAIL">;
        expect(batchError.error).toBe("FAIL");
        expect(batchError.itemIndex).toBe(2); // 0-indexed
        expect(batchError.batchNumber).toBe(1);
      }
    });

    it("should stop processing if afterBatch hook fails", async () => {
      const items = [1, 2, 3, 4, 5, 6];
      let afterBatchCalls = 0;

      const afterBatch = async (): AsyncResult<void, "CHECKPOINT_ERROR"> => {
        afterBatchCalls++;
        if (afterBatchCalls === 2) {
          return err("CHECKPOINT_ERROR");
        }
        return ok(undefined);
      };

      const result = await processInBatches(
        items,
        async (n) => ok(n),
        { batchSize: 2, concurrency: 2 },
        { afterBatch }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isBatchProcessingError(result.error)).toBe(true);
        const batchError = result.error as BatchProcessingError<"CHECKPOINT_ERROR">;
        expect(batchError.error).toBe("CHECKPOINT_ERROR");
        expect(batchError.batchNumber).toBe(2);
        expect(batchError.itemIndex).toBeUndefined(); // Not an item error
      }
    });

    it("should respect concurrency limit", async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const process = async (n: number): AsyncResult<number, never> => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));

        currentConcurrent--;
        return ok(n);
      };

      await processInBatches(items, process, {
        batchSize: 10,
        concurrency: 3,
      });

      // Max concurrent should not exceed the configured limit
      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });

    it("should apply backpressure delay between batches", async () => {
      const items = [1, 2, 3, 4];
      const timestamps: number[] = [];

      const process = async (n: number): AsyncResult<number, never> => {
        timestamps.push(Date.now());
        return ok(n);
      };

      const start = Date.now();
      await processInBatches(items, process, {
        batchSize: 2,
        concurrency: 2,
        batchDelayMs: 50,
      });
      const elapsed = Date.now() - start;

      // Should have at least 1 delay (between batch 1 and 2)
      // With 50ms delay, total should be >= 50ms
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some timing variance
    });

    it("should provide item index to process function", async () => {
      const items = ["a", "b", "c"];
      const receivedIndices: number[] = [];

      await processInBatches(
        items,
        async (item, index) => {
          receivedIndices.push(index);
          return ok(item);
        },
        { batchSize: 10, concurrency: 1 }
      );

      expect(receivedIndices).toEqual([0, 1, 2]);
    });

    describe("config validation", () => {
      it("should return error for batchSize = 0", async () => {
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: 0,
          concurrency: 5,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
          const configError = result.error as InvalidBatchConfigError;
          expect(configError.field).toBe("batchSize");
          expect(configError.value).toBe(0);
        }
        expect(process).not.toHaveBeenCalled();
      });

      it("should return error for negative batchSize", async () => {
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: -5,
          concurrency: 5,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
          const configError = result.error as InvalidBatchConfigError;
          expect(configError.field).toBe("batchSize");
          expect(configError.value).toBe(-5);
        }
        expect(process).not.toHaveBeenCalled();
      });

      it("should return error for concurrency = 0", async () => {
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: 10,
          concurrency: 0,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
          const configError = result.error as InvalidBatchConfigError;
          expect(configError.field).toBe("concurrency");
          expect(configError.value).toBe(0);
        }
        expect(process).not.toHaveBeenCalled();
      });

      it("should return error for negative concurrency", async () => {
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: 10,
          concurrency: -3,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
          const configError = result.error as InvalidBatchConfigError;
          expect(configError.field).toBe("concurrency");
          expect(configError.value).toBe(-3);
        }
        expect(process).not.toHaveBeenCalled();
      });

      it("should return error for Infinity batchSize", async () => {
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: Infinity,
          concurrency: 5,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
        }
        expect(process).not.toHaveBeenCalled();
      });

      it("should return error for NaN batchSize", async () => {
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: NaN,
          concurrency: 5,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
        }
        expect(process).not.toHaveBeenCalled();
      });

      it("should return error for fractional batchSize", async () => {
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: 1.5,
          concurrency: 5,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
          const configError = result.error as InvalidBatchConfigError;
          expect(configError.field).toBe("batchSize");
          expect(configError.value).toBe(1.5);
          expect(configError.reason).toContain("integer");
        }
        expect(process).not.toHaveBeenCalled();
      });

      it("should return error for fractional concurrency", async () => {
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: 10,
          concurrency: 2.5,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
          const configError = result.error as InvalidBatchConfigError;
          expect(configError.field).toBe("concurrency");
          expect(configError.value).toBe(2.5);
          expect(configError.reason).toContain("integer");
        }
        expect(process).not.toHaveBeenCalled();
      });

      it("should validate batchSize before concurrency", async () => {
        // Both are invalid, but batchSize should be checked first
        const items = [1, 2, 3];
        const process = vi.fn();

        const result = await processInBatches(items, process, {
          batchSize: 0,
          concurrency: 0,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(isInvalidBatchConfigError(result.error)).toBe(true);
          const configError = result.error as InvalidBatchConfigError;
          expect(configError.field).toBe("batchSize");
        }
        expect(process).not.toHaveBeenCalled();
      });
    });
  });

  describe("isBatchProcessingError", () => {
    it("should return true for BatchProcessingError", () => {
      const error: BatchProcessingError<string> = {
        type: "BATCH_PROCESSING_ERROR",
        error: "SOME_ERROR",
        batchNumber: 1,
      };
      expect(isBatchProcessingError(error)).toBe(true);
    });

    it("should return false for other errors", () => {
      expect(isBatchProcessingError(null)).toBe(false);
      expect(isBatchProcessingError(undefined)).toBe(false);
      expect(isBatchProcessingError("error")).toBe(false);
      expect(isBatchProcessingError({ type: "OTHER_ERROR" })).toBe(false);
    });
  });

  describe("isInvalidBatchConfigError", () => {
    it("should return true for InvalidBatchConfigError", () => {
      const error: InvalidBatchConfigError = {
        type: "INVALID_BATCH_CONFIG",
        reason: "batchSize must be a positive number",
        field: "batchSize",
        value: 0,
      };
      expect(isInvalidBatchConfigError(error)).toBe(true);
    });

    it("should return false for other errors", () => {
      expect(isInvalidBatchConfigError(null)).toBe(false);
      expect(isInvalidBatchConfigError(undefined)).toBe(false);
      expect(isInvalidBatchConfigError("error")).toBe(false);
      expect(isInvalidBatchConfigError({ type: "OTHER_ERROR" })).toBe(false);
      expect(isInvalidBatchConfigError({ type: "BATCH_PROCESSING_ERROR" })).toBe(false);
    });
  });

  describe("batchPresets", () => {
    it("should have conservative preset for memory-constrained environments", () => {
      expect(batchPresets.conservative).toEqual({
        batchSize: 20,
        concurrency: 3,
        batchDelayMs: 50,
      });
    });

    it("should have balanced preset for typical workloads", () => {
      expect(batchPresets.balanced).toEqual({
        batchSize: 50,
        concurrency: 5,
        batchDelayMs: 10,
      });
    });

    it("should have aggressive preset for maximum throughput", () => {
      expect(batchPresets.aggressive).toEqual({
        batchSize: 100,
        concurrency: 10,
        batchDelayMs: 0,
      });
    });
  });

  describe("real-world usage patterns", () => {
    it("should work like pdf-brain embedding batch pattern", async () => {
      // Simulate the pdf-brain embedding pattern:
      // - Process texts in batches
      // - Checkpoint (flush WAL) after each batch
      // - Track progress for UI

      const texts = Array.from({ length: 100 }, (_, i) => `text-${i}`);
      const embeddings: number[][] = [];
      const checkpoints: number[] = [];
      const progressUpdates: BatchProgress[] = [];

      // Simulate embedding generation
      const embed = async (text: string): AsyncResult<number[], "EMBED_ERROR"> => {
        // Simulate embedding vector
        return ok([text.length, text.charCodeAt(0)]);
      };

      // Simulate database checkpoint
      const checkpoint = async (): AsyncResult<void, "DB_ERROR"> => {
        checkpoints.push(Date.now());
        return ok(undefined);
      };

      const result = await processInBatches(
        texts,
        async (text) => {
          const embedding = await embed(text);
          if (embedding.ok) embeddings.push(embedding.value);
          return embedding;
        },
        batchPresets.conservative, // { batchSize: 20, concurrency: 3, batchDelayMs: 50 }
        {
          afterBatch: checkpoint,
          onProgress: (p) => progressUpdates.push({ ...p }),
        }
      );

      expect(result.ok).toBe(true);
      expect(embeddings.length).toBe(100);
      expect(checkpoints.length).toBe(5); // 100 items / 20 batch size = 5 batches
      expect(progressUpdates.length).toBe(5);
      expect(progressUpdates[4].percent).toBe(100);
    });
  });
});
