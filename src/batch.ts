/**
 * awaitly/batch
 *
 * Batch processing utilities with progress tracking and checkpoints.
 * Useful for I/O-heavy operations like generating embeddings, API calls, or database writes.
 *
 * Tree-shakable - only import if needed.
 *
 * @example
 * ```typescript
 * import { processInBatches, ok, err, type AsyncResult } from 'awaitly';
 *
 * // Generate embeddings in batches with progress tracking
 * const embedText = async (text: string): AsyncResult<number[], 'EMBED_ERROR'> => {
 *   const response = await fetch('/api/embed', { body: text });
 *   return response.ok ? ok(await response.json()) : err('EMBED_ERROR');
 * };
 *
 * const checkpoint = async (): AsyncResult<void, 'DB_ERROR'> => {
 *   await db.checkpoint();
 *   return ok(undefined);
 * };
 *
 * const result = await processInBatches(
 *   texts,
 *   embedText,
 *   { batchSize: 20, concurrency: 3, batchDelayMs: 50 },
 *   {
 *     afterBatch: checkpoint,
 *     onProgress: (p) => console.log(`${p.percent}% complete`),
 *   }
 * );
 * ```
 */

import { ok, err, type AsyncResult } from "./core";
import { createConcurrencyLimiter } from "./rate-limiter";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for batch processing.
 */
export interface BatchConfig {
  /**
   * Number of items to process per batch.
   * Lower values = more frequent checkpoints, less memory pressure.
   * Higher values = fewer checkpoints, more throughput.
   * @default 20
   */
  batchSize: number;

  /**
   * Maximum concurrent operations within a batch.
   * Controls parallelism for I/O-bound operations.
   * @default 5
   */
  concurrency: number;

  /**
   * Delay in milliseconds between batches.
   * Provides backpressure to allow event loop breathing and GC.
   * Set to 0 for no delay.
   * @default 0
   */
  batchDelayMs?: number;
}

/**
 * Progress information for batch processing.
 */
export interface BatchProgress {
  /** Current batch number (1-indexed) */
  batch: number;
  /** Total number of batches */
  totalBatches: number;
  /** Items processed so far */
  processed: number;
  /** Total items to process */
  total: number;
  /** Percentage complete (0-100) */
  percent: number;
}

/**
 * Options for batch processing.
 */
export interface BatchOptions<E> {
  /**
   * Hook called after each batch completes successfully.
   * Useful for checkpointing (e.g., flushing database WAL).
   * If this returns an error, processing stops.
   */
  afterBatch?: () => AsyncResult<void, E>;

  /**
   * Callback for progress reporting.
   * Called after each batch completes.
   */
  onProgress?: (progress: BatchProgress) => void;
}

/**
 * Error that occurred during batch processing.
 */
export interface BatchProcessingError<E> {
  type: "BATCH_PROCESSING_ERROR";
  /** The underlying error from the process function or afterBatch hook */
  error: E;
  /** Index of the item that failed (if process function failed) */
  itemIndex?: number;
  /** Batch number where the error occurred (1-indexed) */
  batchNumber: number;
}

/**
 * Error for invalid batch configuration.
 */
export interface InvalidBatchConfigError {
  type: "INVALID_BATCH_CONFIG";
  /** Description of what's wrong with the config */
  reason: string;
  /** The invalid field name */
  field: "batchSize" | "concurrency";
  /** The invalid value */
  value: number;
}

/**
 * Type guard for BatchProcessingError.
 */
export function isBatchProcessingError<E>(
  error: unknown
): error is BatchProcessingError<E> {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as BatchProcessingError<E>).type === "BATCH_PROCESSING_ERROR"
  );
}

/**
 * Type guard for InvalidBatchConfigError.
 */
export function isInvalidBatchConfigError(
  error: unknown
): error is InvalidBatchConfigError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as InvalidBatchConfigError).type === "INVALID_BATCH_CONFIG"
  );
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Simple delay utility.
 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Process items in batches with bounded concurrency, progress tracking, and checkpoints.
 *
 * This function is designed for I/O-heavy operations where you need to:
 * - Control memory pressure by processing in smaller batches
 * - Checkpoint progress (e.g., flush database WAL) between batches
 * - Add backpressure delays to allow GC and event loop breathing
 * - Report progress to the user
 *
 * Processing stops on the first error encountered.
 *
 * @param items - Array of items to process
 * @param process - Function to process each item, returns AsyncResult
 * @param config - Batch configuration (size, concurrency, delay)
 * @param options - Optional hooks for afterBatch and progress reporting
 * @returns AsyncResult containing all processed results, or an error
 *
 * @example
 * ```typescript
 * // Basic usage
 * const results = await processInBatches(
 *   items,
 *   async (item) => ok(await transform(item)),
 *   { batchSize: 10, concurrency: 3 }
 * );
 *
 * // With checkpoints and progress
 * const results = await processInBatches(
 *   items,
 *   processItem,
 *   { batchSize: 20, concurrency: 5, batchDelayMs: 50 },
 *   {
 *     afterBatch: () => db.checkpoint(),
 *     onProgress: (p) => updateProgressBar(p.percent),
 *   }
 * );
 * ```
 */
export async function processInBatches<T, R, E>(
  items: readonly T[],
  process: (item: T, index: number) => AsyncResult<R, E>,
  config: BatchConfig,
  options?: BatchOptions<E>
): AsyncResult<R[], E | BatchProcessingError<E> | InvalidBatchConfigError> {
  const { batchSize, concurrency, batchDelayMs = 0 } = config;
  const { afterBatch, onProgress } = options ?? {};

  // Validate config - fail fast to prevent infinite loops, deadlocks, or incorrect behavior
  // batchSize must be a positive integer to ensure correct slice boundaries and integer indices
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    return err({
      type: "INVALID_BATCH_CONFIG",
      reason: "batchSize must be a positive integer",
      field: "batchSize",
      value: batchSize,
    });
  }

  // concurrency must be a positive integer so the limiter enforces exactly what the caller requested
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    return err({
      type: "INVALID_BATCH_CONFIG",
      reason: "concurrency must be a positive integer",
      field: "concurrency",
      value: concurrency,
    });
  }

  // Handle empty input
  if (items.length === 0) {
    return ok([]);
  }

  const results: R[] = [];
  const totalBatches = Math.ceil(items.length / batchSize);

  // Create concurrency limiter for parallel processing within batches
  const limiter = createConcurrencyLimiter("batch-processor", {
    maxConcurrent: concurrency,
  });

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const batchStart = batchIdx * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, items.length);
    const batch = items.slice(batchStart, batchEnd);
    const batchNumber = batchIdx + 1;

    // Process batch items with concurrency control
    const batchOperations = batch.map((item, localIdx) => async () => {
      const globalIdx = batchStart + localIdx;
      const result = await process(item, globalIdx);

      if (!result.ok) {
        // Wrap error with batch context
        const batchError: BatchProcessingError<E> = {
          type: "BATCH_PROCESSING_ERROR",
          error: result.error,
          itemIndex: globalIdx,
          batchNumber,
        };
        throw batchError;
      }

      return result.value;
    });

    try {
      const batchResults = await limiter.executeAll(batchOperations);
      results.push(...batchResults);
    } catch (thrown) {
      // If it's our BatchProcessingError, return it as error
      if (isBatchProcessingError<E>(thrown)) {
        return err(thrown);
      }
      // Unexpected error
      throw thrown;
    }

    // Report progress
    onProgress?.({
      batch: batchNumber,
      totalBatches,
      processed: results.length,
      total: items.length,
      percent: Math.round((results.length / items.length) * 100),
    });

    // Run afterBatch hook (checkpoint)
    if (afterBatch) {
      const hookResult = await afterBatch();
      if (!hookResult.ok) {
        return err({
          type: "BATCH_PROCESSING_ERROR",
          error: hookResult.error,
          batchNumber,
        } as BatchProcessingError<E>);
      }
    }

    // Backpressure delay between batches (not after the last batch)
    if (batchDelayMs > 0 && batchIdx < totalBatches - 1) {
      await delay(batchDelayMs);
    }
  }

  return ok(results);
}

// =============================================================================
// Presets
// =============================================================================

/**
 * Preset configurations for common batch processing scenarios.
 */
export const batchPresets = {
  /**
   * Conservative settings for memory-constrained environments.
   * Good for WASM, serverless, or when processing large payloads.
   */
  conservative: {
    batchSize: 20,
    concurrency: 3,
    batchDelayMs: 50,
  } satisfies BatchConfig,

  /**
   * Balanced settings for typical workloads.
   */
  balanced: {
    batchSize: 50,
    concurrency: 5,
    batchDelayMs: 10,
  } satisfies BatchConfig,

  /**
   * Aggressive settings for maximum throughput.
   * Use when memory is not a concern.
   */
  aggressive: {
    batchSize: 100,
    concurrency: 10,
    batchDelayMs: 0,
  } satisfies BatchConfig,
} as const;
