/**
 * awaitly-durable-lambda/testing
 *
 * A drop-in for `@aws/durable-execution-sdk-js-testing`: every export is the
 * native one, and the runners keep the native generic, `<TResult = any>`, so
 * existing `LocalDurableTestRunner<MyResult>` code compiles unchanged. Given a
 * typed handler instead, the runners infer its result and event types: `run()`
 * then checks the payload and `getResult()` returns the handler's result.
 *
 * ```typescript
 * const runner = new LocalDurableTestRunner({ handlerFunction: checkout });
 * const execution = await runner.run({ payload: { orderId: "o1" } }); // payload checked
 * execution.getResult(); // HandlerResult<typeof checkout> | undefined
 * ```
 */
import {
  CloudDurableTestRunner as NativeCloudDurableTestRunner,
  LocalDurableTestRunner as NativeLocalDurableTestRunner,
  type CloudDurableTestRunnerParameters,
  type InvokeRequest,
  type TestResult,
} from "@aws/durable-execution-sdk-js-testing";
import type { DurableLambdaHandler } from "@aws/durable-execution-sdk-js";
import type { DurableFunction, TypedDurableLambdaHandler } from "./index";

export * from "@aws/durable-execution-sdk-js-testing";

/**
 * `run()`'s arguments: optional when the event accepts `undefined` (an untyped,
 * `void`, or optional event), otherwise a payload of the event type.
 */
export type RunArgs<TEvent> = undefined extends TEvent
  ? [params?: { payload?: TEvent } & Omit<InvokeRequest, "payload">]
  : [params: { payload: TEvent } & Omit<InvokeRequest, "payload">];

/** The native local runner; infers result and event types from a typed handler. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the native SDK's defaults
export class LocalDurableTestRunner<TResult = any, TEvent = any> extends NativeLocalDurableTestRunner<TResult> {
  constructor(params: { handlerFunction: TypedDurableLambdaHandler<TEvent, TResult> }) {
    super(params);
  }

  // The native runner keeps its environment (fake clock, checkpoint server) in
  // static fields it reads from its own class, so set up and tear down there.
  static override setupTestEnvironment(
    ...args: Parameters<typeof NativeLocalDurableTestRunner.setupTestEnvironment>
  ): Promise<void> {
    return NativeLocalDurableTestRunner.setupTestEnvironment(...args);
  }

  static override teardownTestEnvironment(): Promise<void> {
    return NativeLocalDurableTestRunner.teardownTestEnvironment();
  }

  override run(...[params]: RunArgs<TEvent>): Promise<TestResult<TResult>> {
    return super.run(params);
  }

  /**
   * Register the handler `context.invoke` reaches for a function. With a
   * `durableFunction<typeof handler>(arn)` brand, the handler must match it.
   */
  override registerDurableFunction<T extends DurableLambdaHandler>(fn: DurableFunction<T>, handler: T): this;
  override registerDurableFunction(functionName: string, handler: DurableLambdaHandler): this;
  override registerDurableFunction(
    fn: string | DurableFunction<DurableLambdaHandler>,
    handler: DurableLambdaHandler
  ): this {
    // A DurableFunction is the ARN string at runtime.
    return super.registerDurableFunction(String(fn), handler);
  }
}

/** The native cloud runner; infers result and event types from a branded function. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the native SDK's defaults
export class CloudDurableTestRunner<TResult = any, TEvent = any> extends NativeCloudDurableTestRunner<TResult> {
  constructor(
    params: Omit<CloudDurableTestRunnerParameters, "functionName"> & {
      functionName: string | DurableFunction<TypedDurableLambdaHandler<TEvent, TResult>>;
    }
  ) {
    super({ ...params, functionName: String(params.functionName) });
  }

  override run(...[params]: RunArgs<TEvent>): Promise<TestResult<TResult>> {
    return super.run(params);
  }
}
