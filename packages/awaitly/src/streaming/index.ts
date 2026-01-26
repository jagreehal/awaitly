/**
 * awaitly/streaming
 *
 * Result-aware streaming for workflows.
 * All stream operations return Result types, enabling typed error handling
 * throughout the streaming pipeline.
 *
 * @example Basic usage
 * ```typescript
 * import { createWorkflow } from 'awaitly/workflow';
 * import { createMemoryStreamStore } from 'awaitly/streaming';
 *
 * const streamStore = createMemoryStreamStore();
 * const workflow = createWorkflow(deps, { streamStore });
 *
 * const result = await workflow(async (step) => {
 *   const writer = step.getWritable<string>({ namespace: 'tokens' });
 *
 *   await step(() => generateAI({
 *     prompt: 'Hello',
 *     onToken: async (token) => { await writer.write(token); }
 *   }), { key: 'generate' });
 *
 *   await writer.close();
 * });
 * ```
 *
 * @example Consuming a stream
 * ```typescript
 * import { toAsyncIterable } from 'awaitly/streaming';
 *
 * const reader = step.getReadable<string>({ namespace: 'tokens' });
 *
 * for await (const token of toAsyncIterable(reader)) {
 *   process.stdout.write(token);
 * }
 * ```
 *
 * @example Stream transformations
 * ```typescript
 * import { map, filter, chunk, collect } from 'awaitly/streaming';
 *
 * const reader = step.getReadable<number>({ namespace: 'numbers' });
 *
 * // Transform pipeline
 * const evens = filter(reader, n => n % 2 === 0);
 * const doubled = map(evens, n => n * 2);
 * const batches = chunk(doubled, 10);
 *
 * for await (const batch of batches) {
 *   await processBatch(batch);
 * }
 * ```
 */

// =============================================================================
// Types
// =============================================================================

export type {
  // Core stream interfaces
  StreamWriter,
  StreamReader,
  StreamStore,

  // Stream item and metadata
  StreamItem,
  StreamMetadata,

  // Options
  StreamOptions,
  StreamReadOptions,
  StreamForEachOptions,
  StreamForEachResult,

  // Error types
  StreamWriteError,
  StreamReadError,
  StreamCloseError,
  StreamStoreError,
  StreamEndedMarker,
  StreamBackpressureError,
  StreamError,

  // Utility types
  Unsubscribe,
} from "./types";

// =============================================================================
// Constants
// =============================================================================

export {
  STREAM_WRITE_ERROR,
  STREAM_READ_ERROR,
  STREAM_CLOSE_ERROR,
  STREAM_STORE_ERROR,
  STREAM_ENDED,
  STREAM_BACKPRESSURE_ERROR,
} from "./types";

// =============================================================================
// Type Guards
// =============================================================================

export {
  isStreamEnded,
  isStreamWriteError,
  isStreamReadError,
  isStreamStoreError,
  isStreamBackpressureError,
} from "./types";

// =============================================================================
// Error Constructors
// =============================================================================

export {
  streamWriteError,
  streamReadError,
  streamCloseError,
  streamStoreError,
  streamEnded,
  streamBackpressureError,
} from "./types";

// =============================================================================
// Backpressure
// =============================================================================

export type {
  BackpressureState,
  BackpressureCallback,
  BackpressureOptions,
  BackpressureController,
} from "./backpressure";

export {
  createBackpressureController,
  shouldApplyBackpressure,
} from "./backpressure";

// =============================================================================
// Stream Stores
// =============================================================================

export type { MemoryStreamStoreOptions } from "./stores/memory";

export {
  createMemoryStreamStore,
  createTestableMemoryStreamStore,
  type TestableMemoryStreamStore,
} from "./stores/memory";

export type {
  FileSystemInterface,
  FileStreamStoreOptions,
} from "./stores/file";

export { createFileStreamStore } from "./stores/file";

// =============================================================================
// Transformers
// =============================================================================

export type {
  TransformFn,
  FilterFn,
  AsyncTransformFn,
} from "./transformers";

export {
  // Core converters
  toAsyncIterable,

  // Transformers
  map,
  filter,
  flatMap,
  flatMapAsync,
  mapAsync,
  chunk,

  // Limiters
  take,
  skip,
  takeWhile,
  skipWhile,

  // Collectors
  collect,
  reduce,

  // Composition
  pipe,
} from "./transformers";

// =============================================================================
// External Stream Access (for HTTP handlers, etc.)
// =============================================================================

import { ok, err } from "../core";
import type { AsyncResult } from "../core";
import type {
  StreamStore,
  StreamReader,
  StreamReadError,
  StreamEndedMarker,
  StreamItem,
} from "./types";
import { streamReadError, streamEnded } from "./types";

/**
 * Options for creating an external stream reader.
 */
export interface ExternalReaderOptions {
  /** Stream store instance */
  store: StreamStore;
  /** Workflow ID that owns the stream */
  workflowId: string;
  /** Stream namespace (default: 'default') */
  namespace?: string;
  /** Start reading from this position (default: 0) */
  startIndex?: number;
  /** Poll interval in ms when waiting for new items (default: 100) */
  pollInterval?: number;
  /** Stop polling after this many ms with no new items (default: 30000) */
  pollTimeout?: number;
}

/**
 * Create a stream reader for external consumption (outside workflows).
 *
 * Use this in HTTP handlers, WebSocket handlers, or other contexts
 * where you need to consume a stream created by a workflow.
 *
 * @param options - Reader configuration
 * @returns StreamReader that can be used with toAsyncIterable()
 *
 * @example HTTP streaming response
 * ```typescript
 * app.get('/stream/:workflowId', async (req, res) => {
 *   const reader = getStreamReader({
 *     store: streamStore,
 *     workflowId: req.params.workflowId,
 *     namespace: 'ai-response',
 *   });
 *
 *   res.setHeader('Content-Type', 'text/event-stream');
 *
 *   for await (const chunk of toAsyncIterable(reader)) {
 *     res.write(`data: ${chunk}\n\n`);
 *   }
 *
 *   res.end();
 * });
 * ```
 *
 * @example Resume from last position
 * ```typescript
 * const reader = getStreamReader({
 *   store: streamStore,
 *   workflowId: runId,
 *   namespace: 'tokens',
 *   startIndex: lastReceivedPosition + 1,
 * });
 * ```
 */
export function getStreamReader<T>(
  options: ExternalReaderOptions
): StreamReader<T> {
  const {
    store,
    workflowId,
    namespace = "default",
    startIndex = 0,
    pollInterval = 100,
    pollTimeout = 30000,
  } = options;

  let position = startIndex;
  let readable = true;
  let closed = false;
  let bufferedItems: StreamItem<T>[] = [];
  let bufferIndex = 0;

  const reader: StreamReader<T> = {
    async read(): AsyncResult<T, StreamReadError | StreamEndedMarker> {
      if (closed) {
        return err(streamReadError("closed", "Reader is closed"));
      }

      // Check buffered items first
      if (bufferIndex < bufferedItems.length) {
        const item = bufferedItems[bufferIndex++];
        position = item.position + 1;
        return ok(item.value);
      }

      // Fetch from store with polling for live streams
      const pollStart = Date.now();

      while (Date.now() - pollStart < pollTimeout) {
        const result = await store.read<T>(workflowId, namespace, position, 100);
        if (!result.ok) {
          return err(streamReadError("store_error", result.error.message, result.error));
        }

        const items = result.value;
        if (items.length > 0) {
          bufferedItems = items;
          bufferIndex = 1;
          const item = items[0];
          position = item.position + 1;
          return ok(item.value);
        }

        // Check if stream is closed
        const metaResult = await store.getMetadata(workflowId, namespace);
        if (metaResult.ok && metaResult.value?.closed) {
          readable = false;
          return err(streamEnded(position));
        }

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      // Poll timeout - treat as stream ended
      readable = false;
      return err(streamEnded(position));
    },

    close(): void {
      closed = true;
      readable = false;
      bufferedItems = [];
    },

    get readable() {
      return readable;
    },

    get position() {
      return position;
    },

    get namespace() {
      return namespace;
    },
  };

  return reader;
}
