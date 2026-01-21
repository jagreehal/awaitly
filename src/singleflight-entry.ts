/**
 * awaitly/singleflight
 *
 * Request coalescing - dedupe concurrent identical requests.
 * Multiple concurrent calls with the same key share one in-flight request.
 *
 * @example
 * ```typescript
 * import { singleflight } from 'awaitly/singleflight';
 * import { ok, type AsyncResult } from 'awaitly';
 *
 * const fetchUser = async (id: string): AsyncResult<User, 'NOT_FOUND'> =>
 *   id !== '0' ? ok({ id, name: `User ${id}` }) : err('NOT_FOUND');
 *
 * const fetchUserOnce = singleflight(fetchUser, {
 *   key: (id) => `user:${id}`,
 * });
 *
 * // All concurrent calls share one request
 * const [user1, user2] = await Promise.all([
 *   fetchUserOnce('1'),
 *   fetchUserOnce('1'),  // Same key - shares request
 * ]);
 * ```
 */

export {
  singleflight,
  createSingleflightGroup,
  type SingleflightOptions,
} from "./singleflight";
