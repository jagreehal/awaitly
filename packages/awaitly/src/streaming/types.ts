/**
 * awaitly/streaming - Types
 *
 * Core types for Result-aware streaming in workflows.
 * All stream operations return Result types, enabling typed error handling
 * throughout the streaming pipeline.
 */

import type { AsyncResult } from "../core";

// =============================================================================
// Stream Error Types
// =============================================================================

/** Discriminant for stream write errors */
export const STREAM_WRITE_ERROR = "STREAM_WRITE_ERROR" as const;

/** Discriminant for stream read errors */
export const STREAM_READ_ERROR = "STREAM_READ_ERROR" as const;

/** Discriminant for stream close errors */
export const STREAM_CLOSE_ERROR = "STREAM_CLOSE_ERROR" as const;

/** Discriminant for stream store errors */
export const STREAM_STORE_ERROR = "STREAM_STORE_ERROR" as const;

/** Discriminant for stream ended marker */
export const STREAM_ENDED = "STREAM_ENDED" as const;

/** Discriminant for stream backpressure errors */
export const STREAM_BACKPRESSURE_ERROR = "STREAM_BACKPRESSURE_ERROR" as const;

/**
 * Error returned when a write operation fails.
 */
export type StreamWriteError = {
  type: typeof STREAM_WRITE_ERROR;
  reason: "closed" | "aborted" | "store_error";
  message: string;
  cause?: unknown;
};

/**
 * Error returned when a read operation fails.
 */
export type StreamReadError = {
  type: typeof STREAM_READ_ERROR;
  reason: "closed" | "store_error";
  message: string;
  cause?: unknown;
};

/**
 * Error returned when closing a stream fails.
 */
export type StreamCloseError = {
  type: typeof STREAM_CLOSE_ERROR;
  reason: "already_closed" | "store_error";
  message: string;
  cause?: unknown;
};

/**
 * Error returned from StreamStore operations.
 */
export type StreamStoreError = {
  type: typeof STREAM_STORE_ERROR;
  reason: "read_error" | "write_error" | "metadata_error" | "close_error";
  message: string;
  cause?: unknown;
};

/**
 * Marker indicating stream has ended (not an error, but a terminal state).
 * Used as the "error" type when stream is exhausted.
 */
export type StreamEndedMarker = {
  type: typeof STREAM_ENDED;
  finalPosition: number;
};

/**
 * Backpressure error when writer is paused.
 */
export type StreamBackpressureError = {
  type: typeof STREAM_BACKPRESSURE_ERROR;
  bufferedCount: number;
  highWaterMark: number;
};

/**
 * Union of all stream errors.
 */
export type StreamError =
  | StreamWriteError
  | StreamReadError
  | StreamCloseError
  | StreamStoreError
  | StreamBackpressureError;

// =============================================================================
// Stream Item Types
// =============================================================================

/**
 * A single item in the stream with metadata.
 */
export interface StreamItem<T> {
  /** The value stored in this stream item */
  value: T;
  /** Position in the stream (0-indexed) */
  position: number;
  /** Timestamp when item was written */
  ts: number;
}

/**
 * Metadata about a stream.
 */
export interface StreamMetadata {
  /** Unique identifier for the stream (workflowId + namespace) */
  id: string;
  /** Namespace within the workflow */
  namespace: string;
  /** Workflow ID that owns this stream */
  workflowId: string;
  /** Number of items in the stream */
  length: number;
  /** Whether the stream has been closed */
  closed: boolean;
  /** Timestamp when stream was created */
  createdAt: number;
  /** Timestamp when stream was last written to */
  lastWriteAt?: number;
  /** Timestamp when stream was closed */
  closedAt?: number;
}

// =============================================================================
// Stream Options
// =============================================================================

/**
 * Options for creating a writable stream.
 */
export interface StreamOptions {
  /** Named streams (default: 'default') */
  namespace?: string;
  /** Backpressure threshold (default: 16) */
  highWaterMark?: number;
}

/**
 * Options for creating a readable stream.
 */
export interface StreamReadOptions {
  /** Named streams (default: 'default') */
  namespace?: string;
  /** Resume from position (0-indexed) */
  startIndex?: number;
}

/**
 * Options for streamForEach operation.
 */
export interface StreamForEachOptions {
  /** Name for the operation (used in events) */
  name?: string;
  /** Checkpoint after every N items (default: 1 = checkpoint each item) */
  checkpointInterval?: number;
  /** Maximum concurrent processors (default: 1 = sequential) */
  concurrency?: number;
}

/**
 * Result from streamForEach operation.
 */
export interface StreamForEachResult<R> {
  /** Results from each processed item */
  results: R[];
  /** Total items processed */
  processedCount: number;
  /** Position of last processed item */
  lastPosition: number;
}

// =============================================================================
// StreamWriter Interface
// =============================================================================

/**
 * Writable stream interface - never throws, returns Results.
 *
 * Use within a step to write values to a stream that can be consumed
 * by readers (e.g., HTTP response streaming, AI token streaming).
 *
 * @template T - Type of values written to the stream
 *
 * @example
 * ```typescript
 * const writer = step.getWritable<string>({ namespace: 'ai-response' });
 *
 * await step(() => generateAI({
 *   prompt: 'Hello',
 *   onToken: async (token) => { await writer.write(token); }
 * }), { key: 'generate' });
 *
 * await writer.close();
 * ```
 */
export interface StreamWriter<T> {
  /**
   * Write a value to the stream.
   * Returns an error if the stream is closed, aborted, or store fails.
   */
  write(value: T): AsyncResult<void, StreamWriteError>;

  /**
   * Close the stream normally.
   * Signals to readers that no more data will be written.
   */
  close(): AsyncResult<void, StreamCloseError>;

  /**
   * Abort the stream with a reason.
   * Use for error conditions that should terminate the stream.
   */
  abort(reason: unknown): void;

  /** Whether the stream is still writable */
  readonly writable: boolean;

  /** Current write position (number of items written) */
  readonly position: number;

  /** Stream namespace */
  readonly namespace: string;
}

/**
 * Readable stream interface - returns STREAM_ENDED marker when complete.
 *
 * Use to consume values from a stream, with support for resuming from
 * a specific position.
 *
 * @template T - Type of values read from the stream
 *
 * @example
 * ```typescript
 * const reader = getStreamReader<string>(runId, { namespace: 'ai-response' });
 *
 * let result = await reader.read();
 * while (result.ok) {
 *   response.write(result.value);
 *   result = await reader.read();
 * }
 *
 * if (result.error.type === 'STREAM_ENDED') {
 *   console.log('Stream complete at position', result.error.finalPosition);
 * }
 * ```
 */
export interface StreamReader<T> {
  /**
   * Read the next value from the stream.
   * Returns StreamEndedMarker when stream is exhausted.
   */
  read(): AsyncResult<T, StreamReadError | StreamEndedMarker>;

  /**
   * Close the reader (stop consuming).
   * Does not affect the underlying stream.
   */
  close(): void;

  /** Whether there may be more data to read */
  readonly readable: boolean;

  /** Current read position */
  readonly position: number;

  /** Stream namespace */
  readonly namespace: string;
}

// =============================================================================
// StreamStore Interface
// =============================================================================

/** Unsubscribe function returned by subscribe */
export type Unsubscribe = () => void;

/**
 * Storage backend for stream data.
 * Follows the same patterns as persistence.ts adapters.
 *
 * @example In-memory store
 * ```typescript
 * const store = createMemoryStreamStore();
 * ```
 *
 * @example File-based store
 * ```typescript
 * const store = createFileStreamStore({ directory: './streams', fs });
 * ```
 */
export interface StreamStore {
  /**
   * Append an item to the stream.
   */
  append<T>(
    workflowId: string,
    namespace: string,
    item: StreamItem<T>
  ): AsyncResult<void, StreamStoreError>;

  /**
   * Read items from the stream starting at an index.
   * @param startIndex - Position to start reading from (0-indexed)
   * @param limit - Maximum number of items to read (default: all remaining)
   */
  read<T>(
    workflowId: string,
    namespace: string,
    startIndex: number,
    limit?: number
  ): AsyncResult<StreamItem<T>[], StreamStoreError>;

  /**
   * Get metadata about a stream.
   * Returns undefined if stream doesn't exist.
   */
  getMetadata(
    workflowId: string,
    namespace: string
  ): AsyncResult<StreamMetadata | undefined, StreamStoreError>;

  /**
   * Mark stream as closed.
   */
  closeStream(
    workflowId: string,
    namespace: string
  ): AsyncResult<void, StreamStoreError>;

  /**
   * Subscribe to new items in a stream.
   * Callback is invoked for each new item written.
   * Returns unsubscribe function.
   */
  subscribe<T>(
    workflowId: string,
    namespace: string,
    callback: (item: StreamItem<T>) => void
  ): Unsubscribe;
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if an error is a StreamEndedMarker.
 */
export function isStreamEnded(error: unknown): error is StreamEndedMarker {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as StreamEndedMarker).type === STREAM_ENDED
  );
}

/**
 * Check if an error is a StreamWriteError.
 */
export function isStreamWriteError(error: unknown): error is StreamWriteError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as StreamWriteError).type === STREAM_WRITE_ERROR
  );
}

/**
 * Check if an error is a StreamReadError.
 */
export function isStreamReadError(error: unknown): error is StreamReadError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as StreamReadError).type === STREAM_READ_ERROR
  );
}

/**
 * Check if an error is a StreamStoreError.
 */
export function isStreamStoreError(error: unknown): error is StreamStoreError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as StreamStoreError).type === STREAM_STORE_ERROR
  );
}

/**
 * Check if an error is a StreamBackpressureError.
 */
export function isStreamBackpressureError(
  error: unknown
): error is StreamBackpressureError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as StreamBackpressureError).type === STREAM_BACKPRESSURE_ERROR
  );
}

// =============================================================================
// Error Constructors
// =============================================================================

/**
 * Create a StreamWriteError.
 */
export function streamWriteError(
  reason: StreamWriteError["reason"],
  message: string,
  cause?: unknown
): StreamWriteError {
  return {
    type: STREAM_WRITE_ERROR,
    reason,
    message,
    ...(cause !== undefined ? { cause } : {}),
  };
}

/**
 * Create a StreamReadError.
 */
export function streamReadError(
  reason: StreamReadError["reason"],
  message: string,
  cause?: unknown
): StreamReadError {
  return {
    type: STREAM_READ_ERROR,
    reason,
    message,
    ...(cause !== undefined ? { cause } : {}),
  };
}

/**
 * Create a StreamCloseError.
 */
export function streamCloseError(
  reason: StreamCloseError["reason"],
  message: string,
  cause?: unknown
): StreamCloseError {
  return {
    type: STREAM_CLOSE_ERROR,
    reason,
    message,
    ...(cause !== undefined ? { cause } : {}),
  };
}

/**
 * Create a StreamStoreError.
 */
export function streamStoreError(
  reason: StreamStoreError["reason"],
  message: string,
  cause?: unknown
): StreamStoreError {
  return {
    type: STREAM_STORE_ERROR,
    reason,
    message,
    ...(cause !== undefined ? { cause } : {}),
  };
}

/**
 * Create a StreamEndedMarker.
 */
export function streamEnded(finalPosition: number): StreamEndedMarker {
  return {
    type: STREAM_ENDED,
    finalPosition,
  };
}

/**
 * Create a StreamBackpressureError.
 */
export function streamBackpressureError(
  bufferedCount: number,
  highWaterMark: number
): StreamBackpressureError {
  return {
    type: STREAM_BACKPRESSURE_ERROR,
    bufferedCount,
    highWaterMark,
  };
}
