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

export {
  // Functions
  fromCallback,
  fromEvent,

  // Type guards
  isEventTimeoutError,
  isInvalidEmitterError,
  isEventEmitterLike,

  // Types
  type NodeCallback,
  type EventConfig,
  type EventEmitterLike,
  type EventTimeoutError,
  type InvalidEmitterError,
} from "./adapters";
