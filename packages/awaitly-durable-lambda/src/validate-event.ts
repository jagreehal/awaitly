/**
 * Runtime validation of a durable function's event with any Standard Schema
 * library (Zod, Valibot, ArkType, ...). It wraps the handler, so the native
 * `withDurableExecution` signature is unchanged.
 */
import type { DurableContext, DurableExecutionHandler, DurableLogger } from "@aws/durable-execution-sdk-js";
import { err, type Err } from "awaitly";

/**
 * The members of the Standard Schema v1 interface used here, copied as the
 * spec intends (see https://github.com/standard-schema/standard-schema), so
 * this package's types add no dependency for consumers.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
    readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  };
}

type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
      readonly issues: ReadonlyArray<{
        readonly message: string;
        readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
      }>;
    };

type InferInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];
type InferOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];

/** Returned, as data, when the event does not match the schema. JSON-safe. */
export type InvalidEventError = {
  readonly type: "INVALID_EVENT";
  readonly message: string;
  /** One entry per problem; `path` is dotted, e.g. `items.0.sku`. */
  readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: string }>;
};

/**
 * Callers propagate trace context in a `_traceContext` field (Step Functions,
 * and tracing helpers for `context.invoke`). It belongs to the tracer, so it is
 * left out of what the schema validates.
 */
function withoutTraceContext(event: unknown): unknown {
  if (typeof event !== "object" || event === null || !("_traceContext" in event)) return event;
  const fields: Record<string, unknown> = { ...event };
  delete fields._traceContext;
  return fields;
}

const formatPath = (path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>): string =>
  path.map((segment) => String(typeof segment === "object" ? segment.key : segment)).join(".");

/**
 * Validate the event before the handler runs:
 *
 * ```typescript
 * export const checkout = withDurableExecution(
 *   validateEvent(CheckoutEvent, async (event, context) => {
 *     // event: the schema's output type
 *   })
 * );
 * ```
 *
 * An invalid event returns `err({ type: "INVALID_EVENT", issues })` without
 * running any operation, so the execution succeeds with that Result for the
 * caller to handle. Callers (including a typed `context.invoke`) see the
 * schema's input type. A `_traceContext` field from trace propagation is left
 * out of validation. Validation re-runs on every replay, so the schema must
 * be deterministic: no I/O, no clock.
 */
export function validateEvent<S extends StandardSchemaV1, TResult, TLogger extends DurableLogger = DurableLogger>(
  schema: S,
  handler: (event: InferOutput<S>, context: DurableContext<TLogger>) => Promise<TResult>
): DurableExecutionHandler<InferInput<S>, TResult | Err<InvalidEventError>, TLogger> {
  return async (event, context) => {
    const result = await schema["~standard"].validate(withoutTraceContext(event));
    if (result.issues) {
      const issues = result.issues.map(({ message, path }) =>
        path && path.length > 0 ? { message, path: formatPath(path) } : { message }
      );
      return err<InvalidEventError>({
        type: "INVALID_EVENT",
        message: `Invalid event: ${issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")}`,
        issues,
      });
    }
    return handler(result.value, context);
  };
}
