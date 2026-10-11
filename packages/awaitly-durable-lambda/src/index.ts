/**
 * awaitly-durable-lambda
 *
 * A typed handler facade over `@aws/durable-execution-sdk-js`. It re-exports
 * the native SDK unchanged; change the import path and existing handlers keep
 * compiling and behaving as before.
 *
 * It adds handler metadata: the handler returned by
 * `withDurableExecution` carries its event and result types, so callers,
 * tests, and `context.invoke` sites can stay typed (see {@link HandlerEvent},
 * {@link HandlerResult}).
 *
 * Steps that return awaitly `Result`s need nothing extra: the native
 * `context.step` already types its result from the function, and a returned
 * `err(...)` is checkpointed like any other value instead of triggering the
 * step's retry strategy. Two native rules still apply:
 * - Checkpointing happens after the function returns. With the default
 *   at-least-once semantics, an interruption before the checkpoint is saved
 *   runs the step again, so steps must be idempotent.
 * - Results are stored as JSON by default: `Date` values come back as strings,
 *   `Error` causes lose their message and stack, and `BigInt` or circular
 *   values fail. Keep Results JSON-safe, or pass a custom `serdes`.
 */
import {
  withDurableExecution as nativeWithDurableExecution,
  type DurableExecutionConfig,
  type DurableExecutionHandler,
  type DurableLambdaHandler,
  type DurableLogger,
  type DurablePromise,
  type InvokeConfig,
} from "@aws/durable-execution-sdk-js";

export * from "@aws/durable-execution-sdk-js";
export { validateEvent, type InvalidEventError } from "./validate-event";
export {
  explainReplayViolation,
  replayDiagnostics,
  type ReplayDiagnostic,
  type ReplayDiagnosticsOptions,
  type ReplayViolationKind,
} from "./replay-diagnostics";

/** A durable Lambda handler that remembers its event and result types. */
export type TypedDurableLambdaHandler<TEvent, TResult> = DurableLambdaHandler & {
  /** Type-level only: never set at runtime. */
  readonly __types?: { readonly event: TEvent; readonly result: TResult };
};

/** The event a handler from {@link withDurableExecution} accepts. */
export type HandlerEvent<H> = H extends TypedDurableLambdaHandler<infer TEvent, unknown> ? TEvent : never;

/** The value a handler from {@link withDurableExecution} resolves to. */
export type HandlerResult<H> = H extends TypedDurableLambdaHandler<unknown, infer TResult> ? TResult : never;

/**
 * The native `withDurableExecution`, unchanged at runtime, returning a handler
 * that carries its event and result types. Generic defaults match the native
 * SDK (`any`), so handlers with an unannotated event compile as before;
 * annotate the event to get it typed.
 */
export const withDurableExecution: <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the native SDK's defaults
  TEvent = any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the native SDK's defaults
  TResult = any,
  TLogger extends DurableLogger = DurableLogger,
>(
  handler: DurableExecutionHandler<TEvent, TResult, TLogger>,
  config?: DurableExecutionConfig
) => TypedDurableLambdaHandler<TEvent, TResult> = nativeWithDurableExecution;

declare const durableFunctionBrand: unique symbol;

/**
 * A durable function's qualified ARN (version or alias), carrying its
 * handler's types. A string at runtime, but opaque to the type checker, so it
 * is accepted only where its types are checked: the typed `context.invoke`
 * overload and the typed test runners.
 */
export type DurableFunction<H> = { readonly [durableFunctionBrand]: H };

/**
 * Brand a qualified ARN with the handler deployed there, so `context.invoke`
 * checks the input against its event and types the result it returns:
 *
 * ```typescript
 * const payments = durableFunction<typeof paymentHandler>(process.env.PAYMENTS_ARN!);
 * const receipt = await context.invoke("charge", payments, { orderId, amount });
 * //    ^? HandlerResult<typeof paymentHandler>
 * ```
 *
 * Durable targets must be invoked through a version or alias, never `$LATEST`.
 */
export function durableFunction<H extends DurableLambdaHandler>(qualifiedArn: string): DurableFunction<H> {
  // The brand exists only at the type level; at runtime it is the ARN itself.
  return qualifiedArn as unknown as DurableFunction<H>;
}

/**
 * `context.invoke`'s arguments after the target: the input is optional when the
 * target's event accepts `undefined` (an untyped, `void`, or optional event).
 */
export type InvokeArgs<H> = undefined extends HandlerEvent<H>
  ? [input?: HandlerEvent<H>, config?: InvokeConfig<HandlerEvent<H>, HandlerResult<H>>]
  : [input: HandlerEvent<H>, config?: InvokeConfig<HandlerEvent<H>, HandlerResult<H>>];

declare module "@aws/durable-execution-sdk-js" {
  // Merged into the native DurableContext: a typed overload for invoking a
  // durable function branded with durableFunction(). Plain-string calls keep
  // resolving to the native signatures; a branded one can only match this.
  interface DurableContext {
    invoke<H>(name: string, funcId: DurableFunction<H>, ...args: InvokeArgs<H>): DurablePromise<HandlerResult<H>>;
    invoke<H>(funcId: DurableFunction<H>, ...args: InvokeArgs<H>): DurablePromise<HandlerResult<H>>;
  }
}
