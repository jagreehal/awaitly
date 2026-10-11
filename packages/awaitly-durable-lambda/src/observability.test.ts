/**
 * Observability through AWS's OpenTelemetry plugin
 * (`@aws/durable-execution-sdk-js-otel`), passed in the native `plugins` option.
 */
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { z } from "zod";
import { ok } from "awaitly";
import {
  durableFunction,
  replayDiagnostics,
  type ReplayDiagnostic,
  validateEvent,
  withDurableExecution,
  type DurablePromise,
  type HandlerResult,
} from "./index";
import { LocalDurableTestRunner, WaitingOperationStatus } from "./testing";

const exporter = new InMemorySpanExporter();
const otel = () =>
  new ExecutionOtelPlugin({
    tracerProviderFactory: (createIdGenerator) =>
      new NodeTracerProvider({ idGenerator: createIdGenerator(), spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  });

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }));
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());
afterEach(() => exporter.reset());

/** Run to completion, answering the "approve" callback so a second invocation replays. */
async function runWithCallback<TResult>(runner: LocalDurableTestRunner<TResult, { id: string }>) {
  const pending = runner.run({ payload: { id: "1" } });
  await (await runner.getOperation("approve").waitForData(WaitingOperationStatus.SUBMITTED)).sendCallbackSuccess('"ok"');
  return pending;
}

describe("AWS's OpenTelemetry plugin", () => {
  it("traces an execution in one trace across invocations, with a span per step", async () => {
    const handler = withDurableExecution(
      async (event: { id: string }, context) => {
        const loaded = await context.step("load", async () => ok(event.id));
        await context.waitForCallback("approve", async () => {}, { timeout: { hours: 1 } });
        return context.step("save", async () => loaded);
      },
      { plugins: [otel()] }
    );

    const execution = await runWithCallback(new LocalDurableTestRunner({ handlerFunction: handler }));
    const spans = exporter.getFinishedSpans();

    expect(execution.getInvocations().length).toBeGreaterThanOrEqual(2);
    expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
    expect(spans.map((s) => s.name)).toEqual(expect.arrayContaining(["load", "save", "Invocation"]));
  });

  it("keeps tracing a failed execution while replayDiagnostics explains it", async () => {
    const logged: ReplayDiagnostic[] = [];
    let invocation = 0;
    const handler = withDurableExecution(
      async (_event: { id: string }, context) => {
        invocation += 1;
        await context.step(invocation === 1 ? "first" : "second", async () => ok(1));
        await context.waitForCallback("approve", async () => {}, { timeout: { hours: 1 } });
        return "done";
      },
      { plugins: [otel(), replayDiagnostics({ log: (d) => logged.push(d) })] }
    );

    await runWithCallback(new LocalDurableTestRunner({ handlerFunction: handler }));
    const failed = exporter
      .getFinishedSpans()
      .filter((span) => span.name === "Invocation" && span.attributes["durable.invocation.status"] === "FAILED");

    expect(failed).toHaveLength(1);
    expect(failed[0]?.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(logged).toEqual([expect.objectContaining({ kind: "name-mismatch", expected: "first", actual: "second" })]);
  });
});

describe("trace context in payloads", () => {
  /** The shape tracing helpers add to a context.invoke payload. */
  type TraceContextField = { _traceContext?: { traceparent: string; tracestate?: string } };
  const withTraceContext = <T extends object>(payload: T): T & TraceContextField => ({
    ...payload,
    _traceContext: { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" },
  });

  const Order = z.strictObject({ orderId: z.string() });
  const order = withDurableExecution(
    validateEvent(Order, async (event, context) => context.step("echo", async () => ok(event.orderId)))
  );

  it("validates the event without the _traceContext field", async () => {
    const execution = await new LocalDurableTestRunner({ handlerFunction: order }).run({
      payload: withTraceContext({ orderId: "o1" }),
    });

    expect(execution.getResult()).toEqual({ ok: true, value: "o1" });
  });

  it("accepts a traced payload in a typed invoke", () => {
    const orders = durableFunction<typeof order>("orders:live");
    withDurableExecution(async (_event: void, context) => {
      expectTypeOf(context.invoke("order", orders, withTraceContext({ orderId: "o1" }))).toEqualTypeOf<
        DurablePromise<HandlerResult<typeof order>>
      >();
      return null;
    });
  });
});
