/**
 * awaitly/match
 *
 * Exhaustive pattern matching for discriminated unions.
 * Extends the TaggedError.match pattern to work with any tagged union.
 *
 * @example
 * ```typescript
 * type Event =
 *   | { _tag: 'UserCreated'; user: User }
 *   | { _tag: 'UserUpdated'; userId: string }
 *   | { _tag: 'UserDeleted'; userId: string }
 *
 * const message = Match.value(event)
 *   .pipe(Match.tag("UserCreated", e => `Created: ${e.user.name}`))
 *   .pipe(Match.tag("UserUpdated", e => `Updated: ${e.userId}`))
 *   .pipe(Match.tag("UserDeleted", e => `Deleted: ${e.userId}`))
 *   .pipe(Match.exhaustive)
 * ```
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Any object with a _tag discriminator.
 */
export type Tagged<Tag extends string = string> = { readonly _tag: Tag };

/**
 * Extract the tag from a tagged union member.
 */
export type TagOf<T extends Tagged> = T["_tag"];

/**
 * Extract union members that match a specific tag.
 */
export type MatchTag<T extends Tagged, Tag extends string> = Extract<T, { _tag: Tag }>;

/**
 * A matcher that is accumulating handlers for a tagged union.
 *
 * @typeParam Input - The full union type being matched
 * @typeParam Remaining - Union members that haven't been handled yet
 * @typeParam Output - The output type (union of all handler return types)
 */
export interface Matcher<Input extends Tagged, Remaining extends Tagged, Output> {
  readonly _tag: "Matcher";
  readonly value: Input;
  readonly handlers: Map<string, (value: Tagged) => unknown>;
  readonly _remaining: Remaining;
  readonly _output: Output;
}

/**
 * A completed matcher that has handled all cases.
 */
export interface CompletedMatcher<Output> {
  readonly _tag: "CompletedMatcher";
  readonly result: Output;
}

// =============================================================================
// Core Functions
// =============================================================================


/**
 * Add a handler for a specific tag.
 *
 * @example
 * ```typescript
 * Match.value(event)
 *   .pipe(Match.tag("UserCreated", e => e.user.name))
 * ```
 */
export function tag<
  Input extends Tagged,
  Remaining extends Tagged,
  Output,
  Tag extends TagOf<Remaining>,
  NewOutput,
>(
  tagValue: Tag,
  handler: (value: MatchTag<Remaining, Tag>) => NewOutput
): (
  matcher: Matcher<Input, Remaining, Output>
) => Matcher<Input, Exclude<Remaining, { _tag: Tag }>, Output | NewOutput> {
  return (matcher) => {
    const newHandlers = new Map(matcher.handlers);
    newHandlers.set(tagValue, handler as (value: Tagged) => unknown);

    return {
      _tag: "Matcher",
      value: matcher.value,
      handlers: newHandlers,
      _remaining: undefined as unknown as Exclude<Remaining, { _tag: Tag }>,
      _output: undefined as unknown as Output | NewOutput,
    };
  };
}

/**
 * Add handlers for multiple tags at once.
 *
 * @example
 * ```typescript
 * Match.value(event)
 *   .pipe(Match.tags({
 *     UserCreated: e => e.user.name,
 *     UserUpdated: e => e.userId,
 *   }))
 * ```
 */
export function tags<
  Input extends Tagged,
  Remaining extends Tagged,
  Output,
  Handlers extends {
    [K in TagOf<Remaining>]?: (value: MatchTag<Remaining, K>) => unknown;
  },
>(
  handlers: Handlers
): (
  matcher: Matcher<Input, Remaining, Output>
) => Matcher<
  Input,
  Exclude<Remaining, { _tag: keyof Handlers }>,
  Output | ReturnType<NonNullable<Handlers[keyof Handlers]>>
> {
  return (matcher) => {
    const newHandlers = new Map(matcher.handlers);
    for (const [tagValue, handler] of Object.entries(handlers)) {
      if (handler) {
        newHandlers.set(tagValue, handler as (value: Tagged) => unknown);
      }
    }

    return {
      _tag: "Matcher",
      value: matcher.value,
      handlers: newHandlers,
      _remaining: undefined as unknown as Exclude<Remaining, { _tag: keyof Handlers }>,
      _output: undefined as unknown as Output | ReturnType<NonNullable<Handlers[keyof Handlers]>>,
    };
  };
}

/**
 * Complete the match, requiring all cases to be handled.
 * This is a compile-time check - if any cases are missing, TypeScript will error.
 *
 * @example
 * ```typescript
 * // TypeScript error if any tag is not handled
 * const result = Match.value(event)
 *   .pipe(Match.tag("UserCreated", e => e.user))
 *   .pipe(Match.tag("UserUpdated", e => e.userId))
 *   .pipe(Match.tag("UserDeleted", e => e.userId))
 *   .pipe(Match.exhaustive)
 * ```
 */
export function exhaustive<Input extends Tagged, Output>(
  matcher: Matcher<Input, never, Output>
): Output {
  const handler = matcher.handlers.get(matcher.value._tag);
  if (!handler) {
    throw new Error(`No handler for tag: ${matcher.value._tag}`);
  }
  return handler(matcher.value) as Output;
}

/**
 * Complete the match with a default handler for any remaining cases.
 *
 * @example
 * ```typescript
 * const result = Match.value(event)
 *   .pipe(Match.tag("UserCreated", e => `Created: ${e.user.name}`))
 *   .pipe(Match.orElse(e => `Other event: ${e._tag}`))
 * ```
 */
export function orElse<Input extends Tagged, Remaining extends Tagged, Output, DefaultOutput>(
  handler: (value: Remaining) => DefaultOutput
): (matcher: Matcher<Input, Remaining, Output>) => Output | DefaultOutput {
  return (matcher) => {
    const specificHandler = matcher.handlers.get(matcher.value._tag);
    if (specificHandler) {
      return specificHandler(matcher.value) as Output;
    }
    return handler(matcher.value as unknown as Remaining);
  };
}

/**
 * Complete the match with a default value for any remaining cases.
 *
 * @example
 * ```typescript
 * const result = Match.value(event)
 *   .pipe(Match.tag("UserCreated", e => e.user.name))
 *   .pipe(Match.orElseValue("Unknown event"))
 * ```
 */
export function orElseValue<Input extends Tagged, Remaining extends Tagged, Output, DefaultOutput>(
  defaultValue: DefaultOutput
): (matcher: Matcher<Input, Remaining, Output>) => Output | DefaultOutput {
  return orElse(() => defaultValue);
}

// =============================================================================
// Predicates & Guards
// =============================================================================

/**
 * Add a handler with an additional predicate.
 * The handler only runs if both the tag matches AND the predicate returns true.
 *
 * @example
 * ```typescript
 * Match.value(event)
 *   .pipe(Match.when(
 *     "UserCreated",
 *     e => e.user.isAdmin,
 *     e => `Admin created: ${e.user.name}`
 *   ))
 * ```
 */
export function when<
  Input extends Tagged,
  Remaining extends Tagged,
  Output,
  Tag extends TagOf<Input>,
  NewOutput,
>(
  tagValue: Tag,
  predicate: (value: MatchTag<Input, Tag>) => boolean,
  handler: (value: MatchTag<Input, Tag>) => NewOutput
): (matcher: Matcher<Input, Remaining, Output>) => Matcher<Input, Remaining, Output | NewOutput> {
  return (matcher) => {
    const newHandlers = new Map(matcher.handlers);
    const existingHandler = matcher.handlers.get(tagValue);

    newHandlers.set(tagValue, (value: Tagged) => {
      const typedValue = value as MatchTag<Input, Tag>;
      if (predicate(typedValue)) {
        return handler(typedValue);
      }
      if (existingHandler) {
        return existingHandler(value);
      }
      throw new Error(`No handler matched for tag: ${tagValue}`);
    });

    return {
      _tag: "Matcher",
      value: matcher.value,
      handlers: newHandlers,
      _remaining: matcher._remaining,
      _output: undefined as unknown as Output | NewOutput,
    };
  };
}

// =============================================================================
// Type Narrowing Utilities
// =============================================================================

/**
 * Check if a tagged value has a specific tag.
 * Type guard that narrows the type.
 *
 * @example
 * ```typescript
 * if (Match.is("UserCreated")(event)) {
 *   // event is narrowed to { _tag: 'UserCreated'; user: User }
 *   console.log(event.user.name);
 * }
 * ```
 */
export function is<T extends Tagged, Tag extends string>(
  tagValue: Tag
): (value: T) => value is Extract<T, { _tag: Tag }> {
  return (value): value is Extract<T, { _tag: Tag }> => value._tag === tagValue;
}

/**
 * Check if a tagged value has one of several tags.
 *
 * @example
 * ```typescript
 * if (Match.isOneOf("UserCreated", "UserUpdated")(event)) {
 *   // event is narrowed to UserCreated | UserUpdated
 * }
 * ```
 */
export function isOneOf<T extends Tagged, Tags extends TagOf<T>[]>(
  ...tags: Tags
): (value: T) => value is Extract<T, { _tag: Tags[number] }> {
  const tagSet = new Set(tags);
  return (value): value is Extract<T, { _tag: Tags[number] }> =>
    tagSet.has(value._tag as Tags[number]);
}

// =============================================================================
// Pipe Helper
// =============================================================================

/**
 * Type guard to check if a value is a Matcher.
 */
function isMatcher(value: unknown): value is Matcher<Tagged, Tagged, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value as { _tag: unknown })._tag === "Matcher"
  );
}

type PipedMatcher<Input extends Tagged, Remaining extends Tagged, Output> =
  Matcher<Input, Remaining, Output> & {
    pipe: <NewRemaining extends Tagged, NewOutput>(
      fn: (self: Matcher<Input, Remaining, Output>) => Matcher<Input, NewRemaining, NewOutput>
    ) => PipedMatcher<Input, NewRemaining, NewOutput>;
  } & {
    pipe: <R>(fn: (self: Matcher<Input, Remaining, Output>) => R) => R;
  };

function addPipe<Input extends Tagged, Remaining extends Tagged, Output>(
  matcher: Matcher<Input, Remaining, Output>
): PipedMatcher<Input, Remaining, Output> {
  return {
    ...matcher,
    pipe(fn: (self: Matcher<Input, Remaining, Output>) => unknown): unknown {
      const result = fn(matcher);
      // If result is a Matcher, add pipe to it too
      if (isMatcher(result)) {
        return addPipe(result as Matcher<Tagged, Tagged, unknown>);
      }
      return result;
    },
  } as PipedMatcher<Input, Remaining, Output>;
}

/**
 * Start matching on a value (with pipe support).
 *
 * @example
 * ```typescript
 * const result = Match.value(event)
 *   .pipe(Match.tag("Created", e => e.id))
 *   .pipe(Match.exhaustive)
 * ```
 */
export function matchValue<T extends Tagged>(input: T): PipedMatcher<T, T, never> {
  const matcher: Matcher<T, T, never> = {
    _tag: "Matcher",
    value: input,
    handlers: new Map(),
    _remaining: input as T,
    _output: undefined as never,
  };

  return addPipe(matcher);
}

// =============================================================================
// Namespace Export
// =============================================================================

/**
 * Match namespace for exhaustive pattern matching.
 *
 * @example
 * ```typescript
 * import { Match } from "awaitly";
 *
 * type Event =
 *   | { _tag: 'Created'; id: string }
 *   | { _tag: 'Updated'; id: string; data: unknown }
 *   | { _tag: 'Deleted'; id: string }
 *
 * function handle(event: Event): string {
 *   return Match.value(event)
 *     .pipe(Match.tag("Created", e => `Created: ${e.id}`))
 *     .pipe(Match.tag("Updated", e => `Updated: ${e.id}`))
 *     .pipe(Match.tag("Deleted", e => `Deleted: ${e.id}`))
 *     .pipe(Match.exhaustive)
 * }
 * ```
 */
export const Match = {
  value: matchValue,
  tag,
  tags,
  when,
  exhaustive,
  orElse,
  orElseValue,
  is,
  isOneOf,
} as const;
