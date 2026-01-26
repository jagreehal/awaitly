/**
 * awaitly/streaming - Stream Transformers
 *
 * Utilities for transforming streams: map, filter, chunk, flatMapAsync.
 * All transformers work with both StreamReader and AsyncIterable sources.
 */

import type { AsyncResult, Result } from "../core";
import { ok, err } from "../core";
import type { StreamReader } from "./types";
import { isStreamEnded } from "./types";

// =============================================================================
// Transformer Types
// =============================================================================

/**
 * A transform function that can be applied to stream items.
 */
export type TransformFn<T, U> = (item: T, index: number) => U | Promise<U>;

/**
 * A filter predicate for stream items.
 */
export type FilterFn<T> = (item: T, index: number) => boolean | Promise<boolean>;

/**
 * An async transform function that returns a Result.
 */
export type AsyncTransformFn<T, U, E> = (
  item: T,
  index: number
) => AsyncResult<U, E>;

// =============================================================================
// toAsyncIterable - Convert StreamReader to AsyncIterable
// =============================================================================

/**
 * Convert a StreamReader to an AsyncIterable.
 *
 * This allows using for-await-of with StreamReaders.
 *
 * @param reader - StreamReader to convert
 * @returns AsyncIterable that yields stream values
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<string>({ namespace: 'tokens' });
 *
 * for await (const token of toAsyncIterable(reader)) {
 *   process.stdout.write(token);
 * }
 * ```
 */
export async function* toAsyncIterable<T>(
  reader: StreamReader<T>
): AsyncIterable<T> {
  while (reader.readable) {
    const result = await reader.read();
    if (!result.ok) {
      if (isStreamEnded(result.error)) {
        break;
      }
      // Re-throw other read errors
      throw result.error;
    }
    yield result.value;
  }
}

// =============================================================================
// map - Transform each item
// =============================================================================

/**
 * Transform each item in a stream.
 *
 * @param source - StreamReader or AsyncIterable to transform
 * @param fn - Transform function applied to each item
 * @returns AsyncIterable of transformed values
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<number>({ namespace: 'numbers' });
 *
 * for await (const doubled of map(reader, (n) => n * 2)) {
 *   console.log(doubled);
 * }
 * ```
 */
export async function* map<T, U>(
  source: StreamReader<T> | AsyncIterable<T>,
  fn: TransformFn<T, U>
): AsyncIterable<U> {
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let index = 0;
  for await (const item of iterable) {
    yield await fn(item, index++);
  }
}

// =============================================================================
// filter - Keep items matching predicate
// =============================================================================

/**
 * Filter items in a stream.
 *
 * @param source - StreamReader or AsyncIterable to filter
 * @param predicate - Filter function that returns true to keep item
 * @returns AsyncIterable of filtered values
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<number>({ namespace: 'numbers' });
 *
 * for await (const even of filter(reader, (n) => n % 2 === 0)) {
 *   console.log(even);
 * }
 * ```
 */
export async function* filter<T>(
  source: StreamReader<T> | AsyncIterable<T>,
  predicate: FilterFn<T>
): AsyncIterable<T> {
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let index = 0;
  for await (const item of iterable) {
    if (await predicate(item, index++)) {
      yield item;
    }
  }
}

// =============================================================================
// chunk - Group items into fixed-size batches
// =============================================================================

/**
 * Group stream items into fixed-size chunks.
 *
 * @param source - StreamReader or AsyncIterable to chunk
 * @param size - Maximum number of items per chunk
 * @returns AsyncIterable of item arrays
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<string>({ namespace: 'messages' });
 *
 * for await (const batch of chunk(reader, 10)) {
 *   await processBatch(batch);
 * }
 * ```
 */
export async function* chunk<T>(
  source: StreamReader<T> | AsyncIterable<T>,
  size: number
): AsyncIterable<T[]> {
  if (size < 1) {
    throw new Error("Chunk size must be at least 1");
  }

  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let currentChunk: T[] = [];

  for await (const item of iterable) {
    currentChunk.push(item);
    if (currentChunk.length >= size) {
      yield currentChunk;
      currentChunk = [];
    }
  }

  // Yield remaining items
  if (currentChunk.length > 0) {
    yield currentChunk;
  }
}

// =============================================================================
// flatMap - Transform and flatten
// =============================================================================

/**
 * Transform each item to multiple items and flatten.
 *
 * @param source - StreamReader or AsyncIterable to transform
 * @param fn - Transform function that returns an iterable
 * @returns AsyncIterable of flattened values
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<string>({ namespace: 'lines' });
 *
 * for await (const word of flatMap(reader, (line) => line.split(' '))) {
 *   console.log(word);
 * }
 * ```
 */
export async function* flatMap<T, U>(
  source: StreamReader<T> | AsyncIterable<T>,
  fn: (item: T, index: number) => Iterable<U> | AsyncIterable<U>
): AsyncIterable<U> {
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let index = 0;
  for await (const item of iterable) {
    const mapped = fn(item, index++);
    // Check if it's async or sync iterable
    if (Symbol.asyncIterator in mapped) {
      for await (const subItem of mapped) {
        yield subItem;
      }
    } else {
      for (const subItem of mapped as Iterable<U>) {
        yield subItem;
      }
    }
  }
}

// =============================================================================
// flatMapAsync - Transform with Result-returning function
// =============================================================================

/**
 * Transform each item with a Result-returning async function.
 *
 * This is the Result-aware version of flatMap. If the transform function
 * returns an error Result, the stream is terminated with that error.
 *
 * @param source - StreamReader or AsyncIterable to transform
 * @param fn - Transform function returning AsyncResult
 * @returns AsyncIterable of transformed values wrapped in Results
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<Message>({ namespace: 'messages' });
 *
 * for await (const result of flatMapAsync(reader, async (msg) => {
 *   const processed = await processMessage(msg);
 *   return ok(processed);
 * })) {
 *   if (!result.ok) {
 *     console.error('Processing failed:', result.error);
 *     break;
 *   }
 *   console.log('Processed:', result.value);
 * }
 * ```
 */
export async function* flatMapAsync<T, U, E>(
  source: StreamReader<T> | AsyncIterable<T>,
  fn: AsyncTransformFn<T, Iterable<U> | AsyncIterable<U>, E>
): AsyncIterable<Result<U, E>> {
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let index = 0;
  for await (const item of iterable) {
    const result = await fn(item, index++);
    if (!result.ok) {
      yield err(result.error);
      return;
    }
    const mapped = result.value;
    if (Symbol.asyncIterator in mapped) {
      for await (const subItem of mapped) {
        yield ok(subItem);
      }
    } else {
      for (const subItem of mapped as Iterable<U>) {
        yield ok(subItem);
      }
    }
  }
}

// =============================================================================
// mapAsync - Transform with Result-returning function
// =============================================================================

/**
 * Transform each item with a Result-returning async function.
 *
 * @param source - StreamReader or AsyncIterable to transform
 * @param fn - Transform function returning AsyncResult
 * @returns AsyncIterable of Results
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<number>({ namespace: 'numbers' });
 *
 * for await (const result of mapAsync(reader, async (n) => {
 *   if (n < 0) return err('NEGATIVE_NUMBER');
 *   return ok(Math.sqrt(n));
 * })) {
 *   if (result.ok) {
 *     console.log('Sqrt:', result.value);
 *   }
 * }
 * ```
 */
export async function* mapAsync<T, U, E>(
  source: StreamReader<T> | AsyncIterable<T>,
  fn: AsyncTransformFn<T, U, E>
): AsyncIterable<Result<U, E>> {
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let index = 0;
  for await (const item of iterable) {
    yield await fn(item, index++);
  }
}

// =============================================================================
// take - Take first N items
// =============================================================================

/**
 * Take the first N items from a stream.
 *
 * @param source - StreamReader or AsyncIterable to take from
 * @param count - Maximum number of items to take
 * @returns AsyncIterable of up to N items
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<string>({ namespace: 'messages' });
 *
 * for await (const message of take(reader, 10)) {
 *   console.log(message);
 * }
 * ```
 */
export async function* take<T>(
  source: StreamReader<T> | AsyncIterable<T>,
  count: number
): AsyncIterable<T> {
  if (count <= 0) return;

  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let taken = 0;
  for await (const item of iterable) {
    yield item;
    taken++;
    if (taken >= count) break;
  }
}

// =============================================================================
// skip - Skip first N items
// =============================================================================

/**
 * Skip the first N items from a stream.
 *
 * @param source - StreamReader or AsyncIterable to skip from
 * @param count - Number of items to skip
 * @returns AsyncIterable starting after N items
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<string>({ namespace: 'messages' });
 *
 * for await (const message of skip(reader, 100)) {
 *   console.log(message); // Messages 101+
 * }
 * ```
 */
export async function* skip<T>(
  source: StreamReader<T> | AsyncIterable<T>,
  count: number
): AsyncIterable<T> {
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let skipped = 0;
  for await (const item of iterable) {
    if (skipped < count) {
      skipped++;
      continue;
    }
    yield item;
  }
}

// =============================================================================
// takeWhile - Take while predicate is true
// =============================================================================

/**
 * Take items while predicate returns true.
 *
 * @param source - StreamReader or AsyncIterable
 * @param predicate - Predicate function
 * @returns AsyncIterable of items while predicate is true
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<number>({ namespace: 'numbers' });
 *
 * for await (const n of takeWhile(reader, (n) => n < 100)) {
 *   console.log(n);
 * }
 * ```
 */
export async function* takeWhile<T>(
  source: StreamReader<T> | AsyncIterable<T>,
  predicate: FilterFn<T>
): AsyncIterable<T> {
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let index = 0;
  for await (const item of iterable) {
    if (!(await predicate(item, index++))) break;
    yield item;
  }
}

// =============================================================================
// skipWhile - Skip while predicate is true
// =============================================================================

/**
 * Skip items while predicate returns true.
 *
 * @param source - StreamReader or AsyncIterable
 * @param predicate - Predicate function
 * @returns AsyncIterable of items after predicate becomes false
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<number>({ namespace: 'numbers' });
 *
 * for await (const n of skipWhile(reader, (n) => n < 100)) {
 *   console.log(n); // First n >= 100 and all after
 * }
 * ```
 */
export async function* skipWhile<T>(
  source: StreamReader<T> | AsyncIterable<T>,
  predicate: FilterFn<T>
): AsyncIterable<T> {
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let skipping = true;
  let index = 0;
  for await (const item of iterable) {
    if (skipping && (await predicate(item, index++))) {
      continue;
    }
    skipping = false;
    yield item;
  }
}

// =============================================================================
// collect - Collect all items into array
// =============================================================================

/**
 * Collect all stream items into an array.
 *
 * Warning: This loads all items into memory. Only use when you know
 * the stream is bounded.
 *
 * @param source - StreamReader or AsyncIterable
 * @returns Promise resolving to array of all items
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<string>({ namespace: 'small-data' });
 * const items = await collect(reader);
 * console.log('Got', items.length, 'items');
 * ```
 */
export async function collect<T>(
  source: StreamReader<T> | AsyncIterable<T>
): Promise<T[]> {
  const items: T[] = [];
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

// =============================================================================
// reduce - Reduce stream to single value
// =============================================================================

/**
 * Reduce stream items to a single value.
 *
 * @param source - StreamReader or AsyncIterable
 * @param reducer - Reducer function
 * @param initial - Initial accumulator value
 * @returns Promise resolving to final accumulated value
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<number>({ namespace: 'numbers' });
 * const sum = await reduce(reader, (acc, n) => acc + n, 0);
 * console.log('Sum:', sum);
 * ```
 */
export async function reduce<T, U>(
  source: StreamReader<T> | AsyncIterable<T>,
  reducer: (accumulator: U, item: T, index: number) => U | Promise<U>,
  initial: U
): Promise<U> {
  let accumulator = initial;
  const iterable = isStreamReader(source) ? toAsyncIterable(source) : source;
  let index = 0;
  for await (const item of iterable) {
    accumulator = await reducer(accumulator, item, index++);
  }
  return accumulator;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a value is a StreamReader.
 */
function isStreamReader<T>(value: unknown): value is StreamReader<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "read" in value &&
    typeof (value as StreamReader<T>).read === "function" &&
    "readable" in value
  );
}

/**
 * Pipe a source through multiple transformers.
 *
 * @param source - Initial source
 * @param transformers - Array of transformer functions
 * @returns Final transformed AsyncIterable
 *
 * @example
 * ```typescript
 * const reader = step.getReadable<number>({ namespace: 'numbers' });
 *
 * const result = pipe(
 *   reader,
 *   (s) => filter(s, (n) => n > 0),
 *   (s) => map(s, (n) => n * 2),
 *   (s) => take(s, 10)
 * );
 *
 * for await (const n of result) {
 *   console.log(n);
 * }
 * ```
 */
export function pipe<T>(source: StreamReader<T> | AsyncIterable<T>): AsyncIterable<T>;
export function pipe<T, A>(
  source: StreamReader<T> | AsyncIterable<T>,
  t1: (s: AsyncIterable<T>) => AsyncIterable<A>
): AsyncIterable<A>;
export function pipe<T, A, B>(
  source: StreamReader<T> | AsyncIterable<T>,
  t1: (s: AsyncIterable<T>) => AsyncIterable<A>,
  t2: (s: AsyncIterable<A>) => AsyncIterable<B>
): AsyncIterable<B>;
export function pipe<T, A, B, C>(
  source: StreamReader<T> | AsyncIterable<T>,
  t1: (s: AsyncIterable<T>) => AsyncIterable<A>,
  t2: (s: AsyncIterable<A>) => AsyncIterable<B>,
  t3: (s: AsyncIterable<B>) => AsyncIterable<C>
): AsyncIterable<C>;
export function pipe<T, A, B, C, D>(
  source: StreamReader<T> | AsyncIterable<T>,
  t1: (s: AsyncIterable<T>) => AsyncIterable<A>,
  t2: (s: AsyncIterable<A>) => AsyncIterable<B>,
  t3: (s: AsyncIterable<B>) => AsyncIterable<C>,
  t4: (s: AsyncIterable<C>) => AsyncIterable<D>
): AsyncIterable<D>;
export function pipe(
  source: StreamReader<unknown> | AsyncIterable<unknown>,
  ...transformers: Array<(s: AsyncIterable<unknown>) => AsyncIterable<unknown>>
): AsyncIterable<unknown> {
  let result: AsyncIterable<unknown> = isStreamReader(source)
    ? toAsyncIterable(source)
    : source;
  for (const transformer of transformers) {
    result = transformer(result);
  }
  return result;
}
