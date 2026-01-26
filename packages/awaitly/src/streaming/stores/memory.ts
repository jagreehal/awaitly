/**
 * awaitly/streaming - Memory Stream Store
 *
 * In-memory implementation of StreamStore for development and testing.
 * Data is not persisted across process restarts.
 */

import { ok, err } from "../../core";
import type { AsyncResult } from "../../core";
import type {
  StreamStore,
  StreamItem,
  StreamMetadata,
  StreamStoreError,
  Unsubscribe,
} from "../types";
import { streamStoreError } from "../types";

// =============================================================================
// Types
// =============================================================================

/**
 * Internal stream data structure.
 */
interface StreamData<T = unknown> {
  metadata: StreamMetadata;
  items: StreamItem<T>[];
  subscribers: Set<(item: StreamItem<T>) => void>;
}

/**
 * Options for creating a memory stream store.
 */
export interface MemoryStreamStoreOptions {
  /** Maximum items per stream (default: Infinity) */
  maxItemsPerStream?: number;
}

// =============================================================================
// Memory Stream Store
// =============================================================================

/**
 * Create an in-memory StreamStore.
 *
 * @param options - Configuration options
 * @returns StreamStore implementation
 *
 * @example
 * ```typescript
 * const store = createMemoryStreamStore();
 *
 * // Use with workflow
 * const workflow = createWorkflow(deps, { streamStore: store });
 * ```
 */
export function createMemoryStreamStore(
  options: MemoryStreamStoreOptions = {}
): StreamStore {
  const maxItemsPerStream = options.maxItemsPerStream ?? Infinity;
  const streams = new Map<string, StreamData>();

  function getStreamKey(workflowId: string, namespace: string): string {
    return `${workflowId}:${namespace}`;
  }

  function getOrCreateStream(
    workflowId: string,
    namespace: string
  ): StreamData {
    const key = getStreamKey(workflowId, namespace);
    let data = streams.get(key);

    if (!data) {
      data = {
        metadata: {
          id: key,
          namespace,
          workflowId,
          length: 0,
          closed: false,
          createdAt: Date.now(),
        },
        items: [],
        subscribers: new Set(),
      };
      streams.set(key, data);
    }

    return data;
  }

  return {
    async append<T>(
      workflowId: string,
      namespace: string,
      item: StreamItem<T>
    ): AsyncResult<void, StreamStoreError> {
      try {
        const data = getOrCreateStream(workflowId, namespace);

        if (data.metadata.closed) {
          return err(
            streamStoreError("write_error", "Cannot write to closed stream")
          );
        }

        if (data.items.length >= maxItemsPerStream) {
          return err(
            streamStoreError(
              "write_error",
              `Stream exceeded max items limit (${maxItemsPerStream})`
            )
          );
        }

        data.items.push(item as StreamItem<unknown>);
        data.metadata.length = data.items.length;
        data.metadata.lastWriteAt = Date.now();

        // Notify subscribers
        for (const callback of data.subscribers) {
          try {
            callback(item as StreamItem<unknown>);
          } catch {
            // Ignore subscriber errors
          }
        }

        return ok(undefined);
      } catch (cause) {
        return err(
          streamStoreError("write_error", "Failed to append item", cause)
        );
      }
    },

    async read<T>(
      workflowId: string,
      namespace: string,
      startIndex: number,
      limit?: number
    ): AsyncResult<StreamItem<T>[], StreamStoreError> {
      try {
        const key = getStreamKey(workflowId, namespace);
        const data = streams.get(key);

        if (!data) {
          return ok([]);
        }

        const endIndex =
          limit !== undefined
            ? Math.min(startIndex + limit, data.items.length)
            : data.items.length;

        const items = data.items.slice(startIndex, endIndex);
        return ok(items as StreamItem<T>[]);
      } catch (cause) {
        return err(streamStoreError("read_error", "Failed to read items", cause));
      }
    },

    async getMetadata(
      workflowId: string,
      namespace: string
    ): AsyncResult<StreamMetadata | undefined, StreamStoreError> {
      try {
        const key = getStreamKey(workflowId, namespace);
        const data = streams.get(key);
        return ok(data?.metadata);
      } catch (cause) {
        return err(
          streamStoreError("metadata_error", "Failed to get metadata", cause)
        );
      }
    },

    async closeStream(
      workflowId: string,
      namespace: string
    ): AsyncResult<void, StreamStoreError> {
      try {
        const key = getStreamKey(workflowId, namespace);
        const data = streams.get(key);

        if (data) {
          data.metadata.closed = true;
          data.metadata.closedAt = Date.now();
        }

        return ok(undefined);
      } catch (cause) {
        return err(
          streamStoreError("close_error", "Failed to close stream", cause)
        );
      }
    },

    subscribe<T>(
      workflowId: string,
      namespace: string,
      callback: (item: StreamItem<T>) => void
    ): Unsubscribe {
      const data = getOrCreateStream(workflowId, namespace);
      const typedCallback = callback as (item: StreamItem<unknown>) => void;
      data.subscribers.add(typedCallback);

      return () => {
        data.subscribers.delete(typedCallback);
      };
    },
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Create a memory stream store with a Map-like interface for testing.
 * Exposes additional methods for inspection.
 */
export interface TestableMemoryStreamStore extends StreamStore {
  /** Clear all streams */
  clear(): void;
  /** Get all stream keys */
  keys(): string[];
  /** Check if a stream exists */
  has(workflowId: string, namespace: string): boolean;
  /** Delete a stream */
  delete(workflowId: string, namespace: string): boolean;
}

/**
 * Create a testable memory stream store with additional inspection methods.
 */
export function createTestableMemoryStreamStore(
  options: MemoryStreamStoreOptions = {}
): TestableMemoryStreamStore {
  const streams = new Map<string, StreamData>();
  const maxItemsPerStream = options.maxItemsPerStream ?? Infinity;

  function getStreamKey(workflowId: string, namespace: string): string {
    return `${workflowId}:${namespace}`;
  }

  function getOrCreateStream(
    workflowId: string,
    namespace: string
  ): StreamData {
    const key = getStreamKey(workflowId, namespace);
    let data = streams.get(key);

    if (!data) {
      data = {
        metadata: {
          id: key,
          namespace,
          workflowId,
          length: 0,
          closed: false,
          createdAt: Date.now(),
        },
        items: [],
        subscribers: new Set(),
      };
      streams.set(key, data);
    }

    return data;
  }

  const store = createMemoryStreamStore(options);

  return {
    ...store,

    // Override to use our local streams map
    async append<T>(
      workflowId: string,
      namespace: string,
      item: StreamItem<T>
    ): AsyncResult<void, StreamStoreError> {
      try {
        const data = getOrCreateStream(workflowId, namespace);

        if (data.metadata.closed) {
          return err(
            streamStoreError("write_error", "Cannot write to closed stream")
          );
        }

        if (data.items.length >= maxItemsPerStream) {
          return err(
            streamStoreError(
              "write_error",
              `Stream exceeded max items limit (${maxItemsPerStream})`
            )
          );
        }

        data.items.push(item as StreamItem<unknown>);
        data.metadata.length = data.items.length;
        data.metadata.lastWriteAt = Date.now();

        for (const callback of data.subscribers) {
          try {
            callback(item as StreamItem<unknown>);
          } catch {
            // Ignore subscriber errors
          }
        }

        return ok(undefined);
      } catch (cause) {
        return err(
          streamStoreError("write_error", "Failed to append item", cause)
        );
      }
    },

    async read<T>(
      workflowId: string,
      namespace: string,
      startIndex: number,
      limit?: number
    ): AsyncResult<StreamItem<T>[], StreamStoreError> {
      try {
        const key = getStreamKey(workflowId, namespace);
        const data = streams.get(key);

        if (!data) {
          return ok([]);
        }

        const endIndex =
          limit !== undefined
            ? Math.min(startIndex + limit, data.items.length)
            : data.items.length;

        const items = data.items.slice(startIndex, endIndex);
        return ok(items as StreamItem<T>[]);
      } catch (cause) {
        return err(streamStoreError("read_error", "Failed to read items", cause));
      }
    },

    async getMetadata(
      workflowId: string,
      namespace: string
    ): AsyncResult<StreamMetadata | undefined, StreamStoreError> {
      try {
        const key = getStreamKey(workflowId, namespace);
        const data = streams.get(key);
        return ok(data?.metadata);
      } catch (cause) {
        return err(
          streamStoreError("metadata_error", "Failed to get metadata", cause)
        );
      }
    },

    async closeStream(
      workflowId: string,
      namespace: string
    ): AsyncResult<void, StreamStoreError> {
      try {
        const key = getStreamKey(workflowId, namespace);
        const data = streams.get(key);

        if (data) {
          data.metadata.closed = true;
          data.metadata.closedAt = Date.now();
        }

        return ok(undefined);
      } catch (cause) {
        return err(
          streamStoreError("close_error", "Failed to close stream", cause)
        );
      }
    },

    subscribe<T>(
      workflowId: string,
      namespace: string,
      callback: (item: StreamItem<T>) => void
    ): Unsubscribe {
      const data = getOrCreateStream(workflowId, namespace);
      const typedCallback = callback as (item: StreamItem<unknown>) => void;
      data.subscribers.add(typedCallback);

      return () => {
        data.subscribers.delete(typedCallback);
      };
    },

    clear(): void {
      streams.clear();
    },

    keys(): string[] {
      return Array.from(streams.keys());
    },

    has(workflowId: string, namespace: string): boolean {
      return streams.has(getStreamKey(workflowId, namespace));
    },

    delete(workflowId: string, namespace: string): boolean {
      return streams.delete(getStreamKey(workflowId, namespace));
    },
  };
}
