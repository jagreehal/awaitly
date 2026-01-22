/**
 * awaitly/adapters
 *
 * Convenience adapters to wrap common non-Promise async patterns into Results.
 *
 * @example
 * ```typescript
 * import { fromCallback, fromEvent } from 'awaitly/adapters';
 *
 * // Node.js callback style
 * const data = await fromCallback<string>(
 *   (cb) => fs.readFile('file.txt', 'utf8', cb)
 * );
 *
 * // One-shot event emitter
 * const response = await fromEvent<Response>(
 *   request,
 *   { success: 'response', error: 'error' }
 * );
 * ```
 */

import { ok, err, type AsyncResult } from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * Standard Node.js error-first callback signature.
 */
export type NodeCallback<T> = (error: Error | null | undefined, result: T) => void;

/**
 * Event listener configuration for fromEvent.
 */
export type EventConfig = {
  /** Event name that signals success (value is passed to resolve) */
  success: string;
  /** Event name that signals error (value is passed to reject). Optional. */
  error?: string;
  /** Timeout in milliseconds. If exceeded, returns timeout error. Optional. */
  timeout?: number;
};

/**
 * EventEmitter-like interface (supports Node.js and DOM events).
 */
export type EventEmitterLike =
  | { on(event: string, listener: (...args: unknown[]) => void): unknown; off(event: string, listener: (...args: unknown[]) => void): unknown }
  | { addEventListener(event: string, listener: (...args: unknown[]) => void): unknown; removeEventListener(event: string, listener: (...args: unknown[]) => void): unknown };

/**
 * Timeout error returned when fromEvent times out.
 */
export type EventTimeoutError = {
  type: "EVENT_TIMEOUT";
  event: string;
  timeoutMs: number;
};

/**
 * Type guard for EventTimeoutError.
 */
export function isEventTimeoutError(error: unknown): error is EventTimeoutError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as EventTimeoutError).type === "EVENT_TIMEOUT"
  );
}

/**
 * Error returned when the emitter doesn't have valid event subscription methods.
 */
export type InvalidEmitterError = {
  type: "INVALID_EMITTER";
  message: string;
};

/**
 * Type guard for InvalidEmitterError.
 */
export function isInvalidEmitterError(error: unknown): error is InvalidEmitterError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as InvalidEmitterError).type === "INVALID_EMITTER"
  );
}

// =============================================================================
// fromCallback
// =============================================================================

/**
 * Convert a Node.js callback-style function to AsyncResult.
 *
 * Handles the standard Node.js error-first callback pattern:
 * `(error: Error | null, result: T) => void`
 *
 * @param executor - Function that receives the callback and calls it
 * @param options - Optional error mapping
 * @returns AsyncResult with the callback's result
 *
 * @example
 * ```typescript
 * import { fromCallback } from 'awaitly/adapters';
 * import { readFile } from 'fs';
 *
 * // Basic usage
 * const result = await fromCallback<string>(
 *   (cb) => readFile('file.txt', 'utf8', cb)
 * );
 *
 * if (result.ok) {
 *   console.log(result.value);
 * } else {
 *   console.error(result.error); // Error
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With typed error mapping
 * type FileError = { type: 'FILE_ERROR'; path: string; cause: Error };
 *
 * const result = await fromCallback<string, FileError>(
 *   (cb) => readFile('config.json', 'utf8', cb),
 *   { onError: (e) => ({ type: 'FILE_ERROR', path: 'config.json', cause: e }) }
 * );
 * ```
 */
export function fromCallback<T, E = Error>(
  executor: (callback: NodeCallback<T>) => void,
  options?: {
    /** Map callback error to typed error */
    onError?: (error: Error) => E;
  }
): AsyncResult<T, E> {
  return new Promise((resolve) => {
    try {
      executor((error, result) => {
        if (error) {
          const mappedError = options?.onError
            ? options.onError(error)
            : (error as unknown as E);
          resolve(err(mappedError, { cause: error }));
        } else {
          resolve(ok(result));
        }
      });
    } catch (thrown) {
      // Handle synchronous throws in executor
      const error = thrown instanceof Error ? thrown : new Error(String(thrown));
      const mappedError = options?.onError
        ? options.onError(error)
        : (error as unknown as E);
      resolve(err(mappedError, { cause: thrown }));
    }
  });
}

// =============================================================================
// fromEvent
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;

/**
 * Type guard for EventEmitter-like objects with on/off methods.
 */
function hasOnOff(obj: unknown): obj is { on: AnyFunction; off: AnyFunction } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "on" in obj &&
    "off" in obj &&
    typeof (obj as { on: unknown }).on === "function" &&
    typeof (obj as { off: unknown }).off === "function"
  );
}

/**
 * Type guard for EventEmitter-like objects with addEventListener/removeEventListener.
 */
function hasAddRemove(obj: unknown): obj is { addEventListener: AnyFunction; removeEventListener: AnyFunction } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "addEventListener" in obj &&
    "removeEventListener" in obj &&
    typeof (obj as { addEventListener: unknown }).addEventListener === "function" &&
    typeof (obj as { removeEventListener: unknown }).removeEventListener === "function"
  );
}

/**
 * Convert a one-shot event emitter pattern to AsyncResult.
 * Automatically removes listeners after resolution.
 *
 * Supports both Node.js EventEmitter (on/off) and DOM EventTarget
 * (addEventListener/removeEventListener) interfaces.
 *
 * @param emitter - Object with event subscription methods
 * @param config - Event names and optional timeout
 * @param options - Optional error mapping
 * @returns AsyncResult with the event payload
 *
 * @example
 * ```typescript
 * import { fromEvent } from 'awaitly/adapters';
 * import { createReadStream } from 'fs';
 *
 * // Node.js stream - wait for first data chunk
 * const stream = createReadStream('data.txt');
 * const result = await fromEvent<Buffer>(stream, {
 *   success: 'data',
 *   error: 'error',
 * });
 *
 * if (result.ok) {
 *   console.log('First chunk:', result.value);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // With timeout
 * const result = await fromEvent<Response>(request, {
 *   success: 'response',
 *   error: 'error',
 *   timeout: 5000,
 * });
 *
 * if (!result.ok && isEventTimeoutError(result.error)) {
 *   console.log('Request timed out');
 * }
 * ```
 *
 * @example
 * ```typescript
 * // DOM events
 * const result = await fromEvent<Event>(button, {
 *   success: 'click',
 *   timeout: 10000,
 * });
 * ```
 */
export function fromEvent<T, E = Error | EventTimeoutError | InvalidEmitterError>(
  emitter: EventEmitterLike,
  config: EventConfig,
  options?: {
    /** Map event error to typed error */
    onError?: (error: unknown) => E;
  }
): AsyncResult<T, E> {
  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let resolved = false;

    // Normalize emitter API
    const addListener = hasOnOff(emitter)
      ? (e: string, l: (...args: unknown[]) => void) => emitter.on(e, l)
      : hasAddRemove(emitter)
        ? (e: string, l: (...args: unknown[]) => void) => emitter.addEventListener(e, l)
        : null;

    const removeListener = hasOnOff(emitter)
      ? (e: string, l: (...args: unknown[]) => void) => emitter.off(e, l)
      : hasAddRemove(emitter)
        ? (e: string, l: (...args: unknown[]) => void) => emitter.removeEventListener(e, l)
        : null;

    if (!addListener || !removeListener) {
      const invalidError: InvalidEmitterError = {
        type: "INVALID_EMITTER",
        message: "Object does not have on/off or addEventListener/removeEventListener",
      };
      resolve(err(invalidError as E));
      return;
    }

    const successHandler = (...args: unknown[]) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      // First argument is the event value
      resolve(ok(args[0] as T));
    };

    const errorHandler = (...args: unknown[]) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      const error = args[0];
      const mappedError = options?.onError
        ? options.onError(error)
        : (error as E);
      resolve(err(mappedError, { cause: error }));
    };

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      removeListener(config.success, successHandler);
      if (config.error) removeListener(config.error, errorHandler);
    };

    addListener(config.success, successHandler);
    if (config.error) addListener(config.error, errorHandler);

    if (config.timeout) {
      timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        const timeoutError: EventTimeoutError = {
          type: "EVENT_TIMEOUT",
          event: config.success,
          timeoutMs: config.timeout!,
        };
        resolve(err(timeoutError as unknown as E));
      }, config.timeout);
    }
  });
}

/**
 * Type guard to check if an object is EventEmitter-like.
 */
export function isEventEmitterLike(obj: unknown): obj is EventEmitterLike {
  return hasOnOff(obj) || hasAddRemove(obj);
}
