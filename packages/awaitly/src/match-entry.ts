/**
 * awaitly/match
 *
 * Exhaustive pattern matching for tagged unions: type-safe switch statements.
 *
 * @example
 * ```typescript
 * import { Match } from 'awaitly/match';
 *
 * type Event = { _tag: 'Click'; x: number } | { _tag: 'Scroll'; y: number };
 *
 * const handle = (event: Event) => Match.value(event)({
 *   Click: (e) => `Clicked at ${e.x}`,
 *   Scroll: (e) => `Scrolled to ${e.y}`,
 * });
 * ```
 */

export {
  // Types
  type Tagged,
  type Matcher,

  // Namespace
  Match,

  // Individual exports
  matchValue,
  tag as matchTag,
  tags as matchTags,
  exhaustive,
  orElse as matchOrElse,
  orElseValue,
  is as isTag,
  isOneOf,
} from "./match";
