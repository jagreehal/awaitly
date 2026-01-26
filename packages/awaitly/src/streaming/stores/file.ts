/**
 * awaitly/streaming - File Stream Store
 *
 * File-based implementation of StreamStore for persistent storage.
 * Follows the patterns from persistence.ts.
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
 * Minimal file system interface for stream operations.
 * Same as FileSystemInterface in persistence.ts.
 */
export interface FileSystemInterface {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

/**
 * Options for creating a file stream store.
 */
export interface FileStreamStoreOptions {
  /** Directory to store stream files */
  directory: string;
  /** File system implementation */
  fs: FileSystemInterface;
}

/**
 * Serialized stream metadata stored on disk.
 */
interface SerializedMetadata {
  id: string;
  namespace: string;
  workflowId: string;
  length: number;
  closed: boolean;
  createdAt: number;
  lastWriteAt?: number;
  closedAt?: number;
}

/**
 * Serialized stream item stored on disk.
 */
interface SerializedItem<T = unknown> {
  value: T;
  position: number;
  ts: number;
}

// =============================================================================
// File Stream Store
// =============================================================================

/**
 * Create a file-based StreamStore.
 *
 * Each stream is stored in a directory structure:
 * - `{directory}/{workflowId}/{namespace}/metadata.json` - stream metadata
 * - `{directory}/{workflowId}/{namespace}/items.jsonl` - items in JSON lines format
 *
 * @param options - Configuration options
 * @returns StreamStore implementation
 *
 * @example
 * ```typescript
 * import * as fs from 'fs/promises';
 *
 * const store = createFileStreamStore({
 *   directory: './streams',
 *   fs: {
 *     readFile: (path) => fs.readFile(path, 'utf-8'),
 *     writeFile: (path, data) => fs.writeFile(path, data, 'utf-8'),
 *     unlink: (path) => fs.unlink(path),
 *     exists: async (path) => {
 *       try { await fs.access(path); return true; }
 *       catch { return false; }
 *     },
 *     readdir: (path) => fs.readdir(path),
 *     mkdir: (path, options) => fs.mkdir(path, options),
 *   },
 * });
 * ```
 */
export function createFileStreamStore(
  options: FileStreamStoreOptions
): StreamStore {
  const { directory, fs } = options;

  // In-memory subscribers (not persisted)
  const subscribers = new Map<string, Set<(item: StreamItem<unknown>) => void>>();

  function getStreamDir(workflowId: string, namespace: string): string {
    return `${directory}/${workflowId}/${namespace}`;
  }

  function getMetadataPath(workflowId: string, namespace: string): string {
    return `${getStreamDir(workflowId, namespace)}/metadata.json`;
  }

  function getItemsPath(workflowId: string, namespace: string): string {
    return `${getStreamDir(workflowId, namespace)}/items.jsonl`;
  }

  function getSubscriberKey(workflowId: string, namespace: string): string {
    return `${workflowId}:${namespace}`;
  }

  async function ensureDir(workflowId: string, namespace: string): Promise<void> {
    const dir = getStreamDir(workflowId, namespace);
    await fs.mkdir(dir, { recursive: true });
  }

  async function readMetadata(
    workflowId: string,
    namespace: string
  ): Promise<SerializedMetadata | undefined> {
    const metaPath = getMetadataPath(workflowId, namespace);
    if (!(await fs.exists(metaPath))) {
      return undefined;
    }
    const content = await fs.readFile(metaPath);
    return JSON.parse(content) as SerializedMetadata;
  }

  async function writeMetadata(
    workflowId: string,
    namespace: string,
    metadata: SerializedMetadata
  ): Promise<void> {
    await ensureDir(workflowId, namespace);
    const metaPath = getMetadataPath(workflowId, namespace);
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
  }

  async function appendItem<T>(
    workflowId: string,
    namespace: string,
    item: SerializedItem<T>
  ): Promise<void> {
    await ensureDir(workflowId, namespace);
    const itemsPath = getItemsPath(workflowId, namespace);

    // Append as JSON line
    const line = JSON.stringify(item) + "\n";

    // Read existing content and append (or create new)
    let content = "";
    if (await fs.exists(itemsPath)) {
      content = await fs.readFile(itemsPath);
    }
    await fs.writeFile(itemsPath, content + line);
  }

  async function readItems<T>(
    workflowId: string,
    namespace: string,
    startIndex: number,
    limit?: number
  ): Promise<SerializedItem<T>[]> {
    const itemsPath = getItemsPath(workflowId, namespace);
    if (!(await fs.exists(itemsPath))) {
      return [];
    }

    const content = await fs.readFile(itemsPath);
    const lines = content.trim().split("\n").filter(Boolean);

    const items: SerializedItem<T>[] = [];
    for (const line of lines) {
      const item = JSON.parse(line) as SerializedItem<T>;
      if (item.position >= startIndex) {
        items.push(item);
        if (limit !== undefined && items.length >= limit) {
          break;
        }
      }
    }

    return items;
  }

  return {
    async append<T>(
      workflowId: string,
      namespace: string,
      item: StreamItem<T>
    ): AsyncResult<void, StreamStoreError> {
      try {
        // Read or create metadata
        let metadata = await readMetadata(workflowId, namespace);
        if (!metadata) {
          metadata = {
            id: `${workflowId}:${namespace}`,
            namespace,
            workflowId,
            length: 0,
            closed: false,
            createdAt: Date.now(),
          };
        }

        if (metadata.closed) {
          return err(
            streamStoreError("write_error", "Cannot write to closed stream")
          );
        }

        // Append item
        const serializedItem: SerializedItem<T> = {
          value: item.value,
          position: item.position,
          ts: item.ts,
        };
        await appendItem(workflowId, namespace, serializedItem);

        // Update metadata
        metadata.length++;
        metadata.lastWriteAt = Date.now();
        await writeMetadata(workflowId, namespace, metadata);

        // Notify subscribers
        const key = getSubscriberKey(workflowId, namespace);
        const subs = subscribers.get(key);
        if (subs) {
          for (const callback of subs) {
            try {
              callback(item as StreamItem<unknown>);
            } catch {
              // Ignore subscriber errors
            }
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
        const serializedItems = await readItems<T>(
          workflowId,
          namespace,
          startIndex,
          limit
        );

        const items: StreamItem<T>[] = serializedItems.map((si) => ({
          value: si.value,
          position: si.position,
          ts: si.ts,
        }));

        return ok(items);
      } catch (cause) {
        return err(streamStoreError("read_error", "Failed to read items", cause));
      }
    },

    async getMetadata(
      workflowId: string,
      namespace: string
    ): AsyncResult<StreamMetadata | undefined, StreamStoreError> {
      try {
        const meta = await readMetadata(workflowId, namespace);
        if (!meta) {
          return ok(undefined);
        }
        return ok({
          id: meta.id,
          namespace: meta.namespace,
          workflowId: meta.workflowId,
          length: meta.length,
          closed: meta.closed,
          createdAt: meta.createdAt,
          lastWriteAt: meta.lastWriteAt,
          closedAt: meta.closedAt,
        });
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
        const metadata = await readMetadata(workflowId, namespace);
        if (metadata) {
          metadata.closed = true;
          metadata.closedAt = Date.now();
          await writeMetadata(workflowId, namespace, metadata);
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
      const key = getSubscriberKey(workflowId, namespace);
      let subs = subscribers.get(key);
      if (!subs) {
        subs = new Set();
        subscribers.set(key, subs);
      }
      const typedCallback = callback as (item: StreamItem<unknown>) => void;
      subs.add(typedCallback);

      return () => {
        subs?.delete(typedCallback);
        if (subs?.size === 0) {
          subscribers.delete(key);
        }
      };
    },
  };
}
