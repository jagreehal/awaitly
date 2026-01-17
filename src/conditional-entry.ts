/**
 * awaitly/conditional
 *
 * Conditional execution helpers: when/unless for cleaner branching logic.
 *
 * @example
 * ```typescript
 * import { when, unless } from 'awaitly/conditional';
 *
 * const result = await workflow(async (step) => {
 *   const user = await step(fetchUser(id));
 *   await when(user.isAdmin, () => step(logAdminAccess(user)));
 *   return user;
 * });
 * ```
 */

export {
  // Types
  type ConditionalOptions,
  type ConditionalContext,

  // Functions
  when,
  unless,
  whenOr,
  unlessOr,
  createConditionalHelpers,
} from "./conditional";
