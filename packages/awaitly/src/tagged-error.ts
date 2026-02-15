/**
 * awaitly/tagged-error
 *
 * Factory for creating tagged error types with exhaustive pattern matching.
 * Enables TypeScript to enforce that all error variants are handled.
 *
 * @example
 * ```typescript
 * // Define error types (Props via generic)
 * class NotFoundError extends TaggedError("NotFoundError")<{
 *   id: string;
 *   resource: string;
 * }> {}
 *
 * // Define with type-safe message (Props inferred from callback annotation)
 * class ValidationError extends TaggedError("ValidationError", {
 *   message: (p: { field: string; reason: string }) => `Invalid ${p.field}: ${p.reason}`,
 * }) {}
 *
 * // Create instances
 * const error = new NotFoundError({ id: "123", resource: "User" });
 *
 * // Runtime type check: instanceof TaggedError works!
 * console.log(error instanceof TaggedError); // true
 *
 * // Exhaustive matching
 * type AppError = NotFoundError | ValidationError;
 * const message = TaggedError.match(error as AppError, {
 *   NotFoundError: (e) => `Missing: ${e.resource} ${e.id}`,
 *   ValidationError: (e) => `Invalid ${e.field}: ${e.reason}`,
 * });
 * ```
 */

/**
 * Options for Error constructor (compatible with ES2022 ErrorOptions).
 */
export interface TaggedErrorOptions {
  cause?: unknown;
}

/**
 * Options for TaggedError factory with type-safe message callback.
 */
export interface TaggedErrorCreateOptions<Props extends Record<string, unknown>> {
  /** Custom message generator from props. Annotate parameter for type safety. */
  message: (props: Props) => string;
}

/**
 * Base interface for all tagged errors.
 */
export interface TaggedErrorBase extends Error {
  readonly _tag: string;
}

/**
 * Internal base class for instanceof checks.
 * All TaggedError-created classes extend this.
 * @internal
 */
class InternalTaggedErrorBase extends Error implements TaggedErrorBase {
  readonly _tag!: string;
}

/**
 * Instance type for factory-created TaggedErrors.
 */
type TaggedErrorInstance<Tag extends string, Props> = TaggedErrorBase & {
  readonly _tag: Tag;
} & Readonly<Props>;

/**
 * Constructor args type - conditionally optional based on whether Props has required fields.
 * - If Props is empty or all properties are optional: props argument is optional
 * - If Props has any required properties: props argument is required
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type ConstructorArgs<Props extends Record<string, unknown>> = {} extends Props
  ? [props?: Props | void, options?: TaggedErrorOptions]
  : [props: Props, options?: TaggedErrorOptions];

/**
 * Constructor type returned by TaggedError factory.
 */
export interface TaggedErrorConstructor<
  Tag extends string,
  Props extends Record<string, unknown>,
> {
  new (...args: ConstructorArgs<Props>): TaggedErrorInstance<Tag, Props>;
  readonly prototype: TaggedErrorInstance<Tag, Props>;
}

/**
 * Generic class factory type that allows `<Props>` parameterization.
 * This enables the Effect.js-style syntax: `class X extends TaggedError("X")<Props> {}`
 * @internal
 */
export interface TaggedErrorClassFactory<Tag extends string> {
  new <Props extends Record<string, unknown> = Record<string, never>>(
    ...args: ConstructorArgs<Props>
  ): TaggedErrorInstance<Tag, Props>;
}

/**
 * Helper type to extract return type from a function type.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FnReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

/**
 * Helper type to get union of return types from all handlers.
 * @internal
 */
type HandlersReturnType<H> = { [K in keyof H]: FnReturnType<H[K]> }[keyof H];

/**
 * Helper type to extract keys whose values are definitely functions (not undefined).
 * Only excludes a tag from the fallback type if its handler is guaranteed to be
 * a function. Keys where the value type includes undefined are NOT excluded,
 * ensuring type safety with dynamic/conditional handlers.
 * @internal
 */
type DefinitelyHandledKeys<H> = {
  [K in keyof H]-?: undefined extends H[K] ? never : K;
}[keyof H];

/**
 * Factory function to create tagged error classes.
 *
 * Two usage patterns:
 *
 * 1. **Props via generic** (default message is tag name):
 *    ```typescript
 *    class NotFoundError extends TaggedError("NotFoundError")<{ id: string }> {}
 *    ```
 *
 * 2. **Props inferred from message callback** (type-safe message):
 *    ```typescript
 *    class NotFoundError extends TaggedError("NotFoundError", {
 *      message: (p: { id: string }) => `Not found: ${p.id}`,
 *    }) {}
 *    ```
 *
 * Both support `instanceof TaggedError` checks at runtime.
 *
 * @param tag - The unique tag string for this error type
 * @param options - Optional configuration with message generator (annotate param for type safety)
 * @returns A class constructor that can be extended
 */

// Overload 1: No options - use <Props> generic syntax, default message is tag
function TaggedError<Tag extends string>(
  tag: Tag
): TaggedErrorClassFactory<Tag>;

// Overload 2: With message option - Props inferred from callback parameter annotation
function TaggedError<Tag extends string, Props extends Record<string, unknown>>(
  tag: Tag,
  options: TaggedErrorCreateOptions<Props>
): TaggedErrorConstructor<Tag, Props>;

// Implementation
function TaggedError<Tag extends string, Props extends Record<string, unknown>>(
  tag: Tag,
  options?: TaggedErrorCreateOptions<Props>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return class extends InternalTaggedErrorBase {
    override readonly _tag: Tag = tag;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(props?: any, errorOptions?: TaggedErrorOptions) {
      // Generate message: call callback if provided (even for prop-less errors), else use tag
      const message = options?.message ? options.message(props ?? {}) : tag;

      super(message);
      this.name = tag;

      // Maintains proper prototype chain for instanceof checks
      Object.setPrototypeOf(this, new.target.prototype);

      // Assign props to instance, stripping reserved keys:
      // - _tag: discriminant for pattern matching (cannot be forged)
      // - name, message, stack: Error internals (preserve for logging/debugging)
      // Note: 'cause' is allowed as a user prop (common for domain errors)
      if (props && typeof props === "object") {
        const {
          _tag: _,
          name: _n,
          message: _m,
          stack: _s,
          ...safeProps
        } = props;

        const hasUserCause = Object.prototype.hasOwnProperty.call(
          safeProps,
          "cause"
        );
        const userCause = hasUserCause
          ? (safeProps as { cause?: unknown }).cause
          : undefined;
        if (hasUserCause) {
          delete (safeProps as { cause?: unknown }).cause;
        }

        const hasOptionsCause = errorOptions?.cause !== undefined;
        if (hasUserCause && hasOptionsCause) {
          throw new TypeError(
            "TaggedError: cannot provide 'cause' in props when also setting ErrorOptions.cause"
          );
        }

        Object.assign(this, safeProps);

        if (hasUserCause) {
          (this as { cause?: unknown }).cause = userCause;
        }
        if (hasOptionsCause) {
          (this as { cause?: unknown }).cause = errorOptions?.cause;
        }
      } else if (errorOptions?.cause !== undefined) {
        (this as { cause?: unknown }).cause = errorOptions.cause;
      }
    }
  };
}

// Add Symbol.hasInstance so `instanceof TaggedError` works
Object.defineProperty(TaggedError, Symbol.hasInstance, {
  value: (instance: unknown): boolean => instance instanceof InternalTaggedErrorBase,
});

/**
 * Namespace for static methods on TaggedError.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
namespace TaggedError {
  /**
   * Type guard to check if a value is an Error instance.
   */
  export function isError(value: unknown): value is Error {
    return value instanceof Error;
  }

  /**
   * Type guard to check if a value is a TaggedError instance.
   * Uses the same check as `instanceof TaggedError` - only genuine
   * TaggedError instances (created via the factory) pass this guard.
   */
  export function isTaggedError(value: unknown): value is TaggedErrorBase {
    return value instanceof InternalTaggedErrorBase;
  }

  /**
   * Exhaustively matches on a tagged error, requiring handlers for all variants.
   *
   * TypeScript will error if any variant in the error union is not handled.
   *
   * @remarks When to use: You want compile-time enforcement that every tagged variant is handled.
   *
   * @param error - The tagged error to match
   * @param handlers - Object mapping _tag values to handler functions
   * @returns The return value of the matched handler
   *
   * @example
   * ```typescript
   * type AppError = NotFoundError | ValidationError;
   *
   * const message = TaggedError.match(error, {
   *   NotFoundError: (e) => `Not found: ${e.id}`,
   *   ValidationError: (e) => `Invalid: ${e.field}`,
   * });
   * ```
   */
  export function match<
    E extends TaggedErrorBase,
    H extends { [K in E["_tag"]]: (e: Extract<E, { _tag: K }>) => unknown },
  >(error: E, handlers: H): HandlersReturnType<H> {
    const tag = error._tag as E["_tag"];
    const handler = handlers[tag];
    return handler(
      error as Extract<E, { _tag: typeof tag }>
    ) as HandlersReturnType<H>;
  }

  /**
   * Partially matches on a tagged error with a fallback for unhandled variants.
   *
   * The fallback receives variants that are NOT definitely handled. A tag is
   * considered "definitely handled" only if its handler is a function (not
   * `undefined`). This ensures type safety even with dynamic/conditional handlers:
   *
   * ```typescript
   * const maybeHandle = featureFlag ? (e) => e.id : undefined;
   * TaggedError.matchPartial(
   *   error,
   *   { NotFoundError: maybeHandle },  // maybeHandle might be undefined
   *   (e) => e._tag  // e correctly includes NotFoundError
   * );
   * ```
   *
   * @param error - The tagged error to match
   * @param handlers - Partial object mapping _tag values to handler functions
   * @param otherwise - Fallback handler for unmatched variants
   * @returns The return value of the matched handler or fallback
   *
   * @example
   * ```typescript
   * const message = TaggedError.matchPartial(
   *   error,
   *   { NotFoundError: (e) => `Not found: ${e.id}` },
   *   (e) => `Other error: ${e.message}`
   * );
   * ```
   */
  export function matchPartial<
    E extends TaggedErrorBase,
    H extends Partial<{
      [K in E["_tag"]]: (e: Extract<E, { _tag: K }>) => unknown;
    }>,
    T,
  >(
    error: E,
    handlers: H,
    otherwise: (e: Exclude<E, { _tag: DefinitelyHandledKeys<H> }>) => T
  ): HandlersReturnType<H> | T {
    const tag = error._tag as E["_tag"];
    const handler = handlers[tag];
    if (handler) {
      return handler(
        error as Extract<E, { _tag: typeof tag }>
      ) as HandlersReturnType<H>;
    }
    return otherwise(error as Exclude<E, { _tag: DefinitelyHandledKeys<H> }>);
  }
}

export { TaggedError };

/**
 * Helper type to extract the _tag literal type from a TaggedError.
 *
 * @example
 * ```typescript
 * class MyError extends TaggedError("MyError")<{ id: string }> {}
 * type Tag = TagOf<MyError>; // "MyError"
 * ```
 */
export type TagOf<E extends TaggedErrorBase> = E["_tag"];

/**
 * Helper type to extract a specific variant from a TaggedError union by tag.
 *
 * @example
 * ```typescript
 * type AppError = NotFoundError | ValidationError;
 * type NotFound = ErrorByTag<AppError, "NotFoundError">; // NotFoundError
 * ```
 */
export type ErrorByTag<
  E extends TaggedErrorBase,
  Tag extends E["_tag"],
> = Extract<E, { _tag: Tag }>;

/**
 * Reserved keys that are stripped from user props at runtime.
 * These keys cannot be used as user-defined properties:
 * - _tag: discriminant for pattern matching
 * - name, message, stack: Error internals (preserved for logging/debugging)
 *
 * Note: 'cause' is NOT reserved - it can be used as a user prop.
 */
type ReservedErrorKeys = "_tag" | "name" | "message" | "stack";

/**
 * Helper type to extract props from a TaggedError.
 * Excludes reserved keys that are stripped at runtime.
 *
 * @example
 * ```typescript
 * class MyError extends TaggedError("MyError")<{ id: string }> {}
 * type Props = PropsOf<MyError>; // { id: string }
 *
 * // 'cause' is allowed as a user prop
 * class DomainError extends TaggedError("DomainError")<{ cause: { field: string } }> {}
 * type DomainProps = PropsOf<DomainError>; // { cause: { field: string } }
 * ```
 */
export type PropsOf<E extends TaggedErrorBase> = Omit<E, ReservedErrorKeys>;
