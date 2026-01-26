/**
 * awaitly/bind-deps
 *
 * Partial application utility for the fn(args, deps) pattern.
 * Transforms a function from fn(args, deps) => out into a curried form:
 * (deps) => (args) => out
 *
 * Use at composition boundaries to bind deps once, then call with args.
 * Keep core implementations in the explicit fn(args, deps) form for testing.
 *
 * @example
 * ```typescript
 * import { bindDeps } from 'awaitly/bind-deps';
 *
 * // Core function stays explicit and testable
 * const notify = (args: { name: string }, deps: { send: SendFn }) =>
 *   deps.send(args.name);
 *
 * // At composition boundary, bind deps once
 * const notifySlack = bindDeps(notify)(slackDeps);
 *
 * // Call site is clean
 * await notifySlack({ name: 'Alice' });
 * ```
 */

export const bindDeps =
  <Args, Deps, Out>(fn: (args: Args, deps: Deps) => Out) =>
  (deps: Deps) =>
  (args: Args) =>
    fn(args, deps);
