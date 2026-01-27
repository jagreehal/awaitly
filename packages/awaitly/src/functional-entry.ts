/**
 * awaitly/functional
 *
 * Effect-inspired functional utilities for Result types.
 * Provides pipe-based composition with automatic error short-circuiting.
 *
 * @example
 * ```typescript
 * import { pipe, R, map, flatMap, match } from 'awaitly/functional';
 *
 * // Pipe with curried combinators
 * const result = pipe(
 *   fetchUser(id),
 *   R.flatMap(user => fetchPosts(user.id)),
 *   R.map(posts => posts.filter(p => p.published)),
 *   R.match({
 *     ok: posts => `Found ${posts.length} posts`,
 *     err: error => `Failed: ${error}`
 *   })
 * );
 * ```
 */

export {
  // Composition
  pipe,
  flow,
  compose,
  identity,

  // Result combinators (sync)
  map,
  flatMap,
  bimap,
  mapError,
  tap,
  tapError,
  match,
  recover,
  recoverWith,
  getOrElse,
  getOrElseLazy,

  // Result combinators (async)
  mapAsync,
  flatMapAsync,
  tapAsync,
  tapErrorAsync,

  // Collection utilities
  all,
  allAsync,
  allSettled,
  allSettledAsync,
  any,
  anyAsync,
  race,
  traverse,
  traverseAsync,
  traverseParallel,

  // Pipeable namespace
  R,
} from "./functional";
