/**
 * awaitly/resource
 *
 * Resource scope management for cleanup guarantees.
 * Provides RAII-style resource management for async operations.
 *
 * Tree-shakable - only import if needed.
 *
 * @example
 * ```typescript
 * import { withScope, ok, type AsyncResult } from 'awaitly';
 *
 * interface DbClient {
 *   query: (sql: string) => Promise<unknown[]>;
 *   close: () => Promise<void>;
 * }
 *
 * const result = await withScope(async (scope) => {
 *   // Register database connection for cleanup
 *   const db = scope.add({
 *     value: await createDbConnection(),
 *     close: async () => db.value.close(),
 *   });
 *
 *   // Register another resource
 *   const cache = scope.add({
 *     value: await createCache(),
 *     close: async () => cache.value.disconnect(),
 *   });
 *
 *   // Use resources...
 *   const users = await db.value.query('SELECT * FROM users');
 *
 *   return ok(users);
 *   // Resources are automatically closed in LIFO order when scope exits
 * });
 * ```
 */

import { err, type AsyncResult } from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * A resource with a value and a cleanup function.
 */
export interface Resource<T> {
  /** The resource value */
  value: T;
  /** Function to release/cleanup the resource */
  close: () => Promise<void>;
}

/**
 * A scope that tracks resources for cleanup.
 */
export interface ResourceScope {
  /**
   * Add a resource to the scope.
   * Resources are closed in LIFO order when the scope exits.
   * @param resource - The resource to track
   * @returns The resource value for convenience
   */
  add: <T>(resource: Resource<T>) => T;

  /**
   * Manually close all resources in the scope.
   * Called automatically by `withScope`, but can be called manually if needed.
   * Resources are closed in LIFO order (last added = first closed).
   */
  close: () => Promise<void>;

  /**
   * Check if a resource is in this scope.
   */
  has: <T>(resource: Resource<T>) => boolean;

  /**
   * Get the number of resources in the scope.
   */
  size: () => number;
}

/**
 * Error that occurred during resource cleanup.
 */
export interface ResourceCleanupError {
  type: "RESOURCE_CLEANUP_ERROR";
  /** Errors that occurred during cleanup (may have multiple if multiple resources failed) */
  errors: unknown[];
  /** The original result from the scope function (if any) */
  originalResult?: unknown;
}

/**
 * Type guard for ResourceCleanupError.
 */
export function isResourceCleanupError(
  error: unknown
): error is ResourceCleanupError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as ResourceCleanupError).type === "RESOURCE_CLEANUP_ERROR"
  );
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a resource scope for tracking resources.
 *
 * Resources are closed in LIFO order (last added = first closed).
 * This matches the typical dependency pattern where later resources
 * may depend on earlier ones.
 *
 * @returns A ResourceScope instance
 *
 * @example
 * ```typescript
 * const scope = createResourceScope();
 *
 * try {
 *   const db = scope.add({
 *     value: await createConnection(),
 *     close: async () => connection.close(),
 *   });
 *
 *   const cache = scope.add({
 *     value: await createCache(db),
 *     close: async () => cache.disconnect(),
 *   });
 *
 *   // Use resources...
 * } finally {
 *   await scope.close();
 *   // cache closed first, then db
 * }
 * ```
 */
export function createResourceScope(): ResourceScope {
  const resources: Array<Resource<unknown>> = [];

  return {
    add: <T>(resource: Resource<T>): T => {
      resources.push(resource as Resource<unknown>);
      return resource.value;
    },

    close: async (): Promise<void> => {
      const errors: unknown[] = [];

      // Close in reverse order (LIFO)
      for (let i = resources.length - 1; i >= 0; i--) {
        try {
          await resources[i].close();
        } catch (error) {
          // Collect errors but continue closing other resources
          errors.push(error);
        }
      }

      // Clear resources after closing
      resources.length = 0;

      // If any errors occurred, throw them
      if (errors.length > 0) {
        throw {
          type: "RESOURCE_CLEANUP_ERROR",
          errors,
        } satisfies ResourceCleanupError;
      }
    },

    has: <T>(resource: Resource<T>): boolean => {
      return resources.includes(resource as Resource<unknown>);
    },

    size: (): number => {
      return resources.length;
    },
  };
}

/**
 * Run a function with automatic resource cleanup.
 *
 * Resources added to the scope are automatically closed when the function
 * completes, regardless of whether it succeeds or fails.
 *
 * @param fn - Function that uses the resource scope
 * @returns The result of the function, or an error if cleanup failed
 *
 * @example
 * ```typescript
 * const result = await withScope(async (scope) => {
 *   const db = scope.add({
 *     value: await createConnection(),
 *     close: async () => db.value.close(),
 *   });
 *
 *   const users = await db.value.query('SELECT * FROM users');
 *   return ok(users);
 * });
 *
 * if (result.ok) {
 *   console.log('Users:', result.value);
 * }
 * ```
 */
export async function withScope<T, E>(
  fn: (scope: ResourceScope) => AsyncResult<T, E>
): AsyncResult<T, E | ResourceCleanupError> {
  const scope = createResourceScope();
  let result: Awaited<AsyncResult<T, E>>;

  try {
    result = await fn(scope);
  } catch (thrown) {
    // Function threw an exception - still need to cleanup
    try {
      await scope.close();
    } catch (cleanupError) {
      // Cleanup also failed - wrap both errors
      if (isResourceCleanupError(cleanupError)) {
        return err({
          ...cleanupError,
          originalResult: { thrown },
        });
      }
    }
    // Re-throw the original exception
    throw thrown;
  }

  // Function completed (success or error result) - cleanup resources
  try {
    await scope.close();
  } catch (cleanupError) {
    if (isResourceCleanupError(cleanupError)) {
      return err({
        ...cleanupError,
        originalResult: result,
      });
    }
    // Unexpected cleanup error
    throw cleanupError;
  }

  return result;
}

/**
 * Create a resource from a factory function with automatic cleanup.
 *
 * Convenience helper for creating resources that follow the acquire/release pattern.
 *
 * @param acquire - Function to acquire the resource
 * @param release - Function to release the resource
 * @returns A Resource instance
 *
 * @example
 * ```typescript
 * const dbResource = await createResource(
 *   () => createConnection({ host: 'localhost' }),
 *   (conn) => conn.close()
 * );
 *
 * const db = scope.add(dbResource);
 * ```
 */
export async function createResource<T>(
  acquire: () => T | Promise<T>,
  release: (value: T) => void | Promise<void>
): Promise<Resource<T>> {
  const value = await acquire();
  return {
    value,
    close: async () => {
      await release(value);
    },
  };
}
