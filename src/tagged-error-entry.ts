/**
 * awaitly/tagged-error
 *
 * Tagged error classes: type-safe errors with discriminated unions.
 *
 * @example
 * ```typescript
 * import { TaggedError, type TagOf, type PropsOf } from 'awaitly/tagged-error';
 *
 * class UserNotFound extends TaggedError('UserNotFound')<{ userId: string }> {}
 * class InsufficientFunds extends TaggedError('InsufficientFunds', {
 *   message: (p: { required: number; available: number }) =>
 *     `Need ${p.required}, have ${p.available}`,
 * }) {}
 *
 * const error = new UserNotFound({ userId: '123' });
 * error._tag // 'UserNotFound'
 * error.userId // '123'
 * ```
 */

export {
  // Factory function
  TaggedError,

  // Types
  type TaggedErrorBase,
  type TaggedErrorOptions,
  type TaggedErrorCreateOptions,
  type TaggedErrorConstructor,

  // Type utilities
  type TagOf,
  type ErrorByTag,
  type PropsOf,
} from "./tagged-error";
