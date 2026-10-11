# awaitly-durable-lambda

A typed handler facade over the [AWS Lambda durable execution SDK](https://docs.aws.amazon.com/durable-execution/) (`@aws/durable-execution-sdk-js`), for steps that return [awaitly](https://github.com/jagreehal/awaitly) `Result`s.

Change the import path and keep everything else. You get the native SDK's exports, signatures, and runtime behaviour, plus types that follow your handlers:

- **Typed handlers.** `withDurableExecution` returns a handler that remembers its event and result types (`HandlerEvent`, `HandlerResult`).
- **Typed invoke.** `context.invoke` checks the input and types the result of the durable function it calls.
- **Typed test runners.** `awaitly-durable-lambda/testing` infers payload and result types from the handler under test.
- **Event validation** with any Standard Schema library (Zod, Valibot, ArkType), returning a typed `INVALID_EVENT` instead of running on bad input.
- **Replay diagnostics** that explain a replay violation and what to change, when one fails an execution.
- **Observability** through AWS's OpenTelemetry plugin and autotel-aws, passed in the native `plugins` option.
- **Lint rules** that flag replay hazards before you deploy, and **diagrams** of your durable functions, via `eslint-plugin-awaitly` and `awaitly-analyze`.

## Install

```bash
pnpm add awaitly-durable-lambda @aws/durable-execution-sdk-js awaitly
pnpm add -D @aws/durable-execution-sdk-js-testing   # for awaitly-durable-lambda/testing
```

## Quick start

```typescript
import { withDurableExecution } from "awaitly-durable-lambda"; // was "@aws/durable-execution-sdk-js"
import { err, ok, type AsyncResult } from "awaitly";

const getUser = async (id: string): AsyncResult<User, "NOT_FOUND"> => { /* ... */ };
const charge = async (user: User): AsyncResult<Receipt, "DECLINED"> => { /* ... */ };

export const checkout = withDurableExecution(async (event: { userId: string }, context) => {
  const user = await context.step("getUser", () => getUser(event.userId));
  if (!user.ok) return user;

  await context.wait("coolingOff", { minutes: 5 });

  return context.step("charge", () => charge(user.value));
});

// HandlerResult<typeof checkout> is inferred from the returns:
//   Err<"NOT_FOUND"> | Ok<Receipt> | Err<"DECLINED">
```

The native `context.step` types its value from the function, so a step returning `AsyncResult<Receipt, "DECLINED">` resolves to that `Result`. TypeScript unions the handler's returns, so its result type lists each failure a caller handles.

## How failures behave

| In the step | What Lambda does | What your code sees |
|---|---|---|
| `return ok(value)` | Checkpoints the Result | `{ ok: true, value }`, on the first run and on every replay |
| `return err("DECLINED")` | Checkpoints the Result, with **no retry** | `{ ok: false, error: "DECLINED" }`, recorded once |
| `throw new Error(...)` | Retries with the step's `retryStrategy`; fails the execution when retries run out | the native `StepError` |

Return `err(...)` for outcomes you expect, such as a declined card or a missing user, and throw for faults you want Lambda to retry.

Two native rules still apply:

- **Steps run at least once.** Checkpointing happens after the function returns. If the invocation is interrupted before the checkpoint is saved, the step runs again, so steps must be idempotent (pass an idempotency key to the API you call). For at-most-once, use `semantics: StepSemantics.AtMostOncePerRetry` with no retries.
- **Results are stored as JSON.** On the first run as well as on replay, your code sees the JSON round trip: a `Date` comes back as a string, an `Error` in a cause loses its message and stack, and `BigInt` or circular values fail. Keep Results JSON-safe, or pass a custom `serdes` to the step.

```typescript
const result = await context.step("stamp", async () => ok({ at: new Date() }));
typeof result.value.at; // "string": store at.toISOString() and say so in the type
```

## Replay

Lambda replays the handler from the start after each wait, callback, and retry, and serves completed steps from their checkpoints. Code outside steps has to produce the same operations on each replay:

```typescript
// ✗ a new value on every replay
const id = crypto.randomUUID();

// ✓ computed once, checkpointed, replayed
const id = await context.step("newId", async () => crypto.randomUUID());
```

`eslint-plugin-awaitly` checks this for you (see [Lint](#lint)).

## Validate the event

Wrap the handler with `validateEvent` and any [Standard Schema](https://standardschema.dev) library. The handler gets the parsed event; callers are typed against the schema's input:

```typescript
import { validateEvent, withDurableExecution } from "awaitly-durable-lambda";
import { z } from "zod";

const Order = z.object({ orderId: z.string().min(1), amount: z.coerce.number().positive() });

export const order = withDurableExecution(
  validateEvent(Order, async (event, context) => {
    // event: { orderId: string; amount: number }
    return context.step("charge", () => charge(event.orderId, event.amount));
  })
);
```

An invalid event returns `{ ok: false, error: { type: "INVALID_EVENT", message, issues } }` without running any operation, with one issue per problem and a dotted `path` (`items.0.sku`). Validation re-runs on every replay, so the schema must be deterministic: no I/O, no clock.

## Typed invoke

Brand a qualified ARN with the handler deployed there. `context.invoke` then checks the input against that handler's event and returns its result type:

```typescript
import { durableFunction, withDurableExecution } from "awaitly-durable-lambda";
import type { paymentHandler } from "./payments";

const payments = durableFunction<typeof paymentHandler>(process.env.PAYMENTS_ARN!);

export const order = withDurableExecution(async (event: { orderId: string; amount: number }, context) => {
  const receipt = await context.invoke("pay", payments, event);
  //    ^? HandlerResult<typeof paymentHandler>
  return receipt;
});
```

The brand is the ARN string at runtime. Invoke durable functions through a published version or alias. When the target's event is `void` or optional, the input can be omitted: `context.invoke("ping", pings)`. A plain string ARN still calls the native, untyped `invoke`.

## Testing

`awaitly-durable-lambda/testing` re-exports `@aws/durable-execution-sdk-js-testing`, with runners that infer types from the handler:

```typescript
import { LocalDurableTestRunner } from "awaitly-durable-lambda/testing";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }));
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

it("declines without retrying", async () => {
  const runner = new LocalDurableTestRunner({ handlerFunction: checkout });
  const execution = await runner.run({ payload: { userId: "broke" } }); // payload type-checked

  expect(execution.getResult()).toEqual({ ok: false, error: "DECLINED" }); // result typed
});
```

- The native generic still works: `new LocalDurableTestRunner<MyResult>({ handlerFunction })` compiles unchanged.
- `run()` needs no arguments when the handler's event is `void` or optional.
- `registerDurableFunction(payments, paymentHandler)` registers the target of a typed invoke, and rejects a handler that does not match the brand.
- `new CloudDurableTestRunner({ functionName: durableFunction<typeof checkout>(arn) })` runs the same assertions against a deployed function.
- To count how many times a step ran on AWS, count `StepStarted` events in `execution.getHistoryEvents()`. `getStepDetails().attempt` counts failed attempts only.

## Replay diagnostics

When a replay diverges from the first run, the SDK fails the execution with a `NonDeterministicExecutionError` that says what diverged. The `replayDiagnostics()` plugin adds why, and what to change:

```typescript
import { replayDiagnostics, withDurableExecution } from "awaitly-durable-lambda";

export const handler = withDurableExecution(checkoutHandler, { plugins: [replayDiagnostics()] });
```

It logs one JSON line to CloudWatch, for example:

```json
{
  "level": "ERROR",
  "source": "awaitly-durable-lambda",
  "kind": "type-mismatch",
  "expected": "STEP",
  "actual": "WAIT",
  "explanation": "Replay reached a WAIT where the first run had a STEP: control flow took a different path. A condition depends on something that changes between invocations, such as the time, a random value, configuration or an API read outside a step, or a variable a step mutated. Compute it inside context.step(...) so every replay reuses the checkpointed value. ..."
}
```

The native error is untouched. Pass `{ log }` to send diagnostics elsewhere, or call `explainReplayViolation(error)` yourself.

## Observability

Pass AWS's OpenTelemetry plugin (`@aws/durable-execution-sdk-js-otel`) and other instrumentation plugins in the native `plugins` option. With [autotel-aws](https://www.npmjs.com/package/autotel-aws):

```typescript
import { init } from "autotel";
import { ExecutionOtelPlugin } from "@aws/durable-execution-sdk-js-otel";
import { autotelContextExtractor, durableFlush, withInvokeTraceContext } from "autotel-aws/durable";
import { replayDiagnostics, withDurableExecution } from "awaitly-durable-lambda";

init({ service: "orders" });

export const order = withDurableExecution(orderHandler, {
  plugins: [new ExecutionOtelPlugin({ contextExtractor: autotelContextExtractor }), durableFlush(), replayDiagnostics()],
});
```

You get one trace per durable execution, with a span for each invocation, step, and attempt. A typed invoke accepts a traced payload, `context.invoke("pay", payments, withInvokeTraceContext({ orderId }))`, and the invoked execution joins the caller's trace. `validateEvent` leaves the `_traceContext` field out of validation, so strict schemas accept traced payloads.

## Lint

```javascript
// eslint.config.js
import awaitly from "eslint-plugin-awaitly";

export default [...awaitly.configs.durable]; // also included in awaitly.configs.recommended
```

| Rule | Catches |
|---|---|
| `awaitly/durable-no-nondeterminism` | `Date.now()`, `new Date()`, `Math.random()`, `crypto.randomUUID()`, `performance.now()` outside a step |
| `awaitly/durable-context-scope` | Durable operations inside a step, and a parent context used inside `runInChildContext`, `map`, or `parallel` |
| `awaitly/durable-callback-timeout` | `waitForCallback` / `createCallback` without a `timeout` |
| `awaitly/durable-no-step-closure-mutation` | Writes to outside variables from inside a step, which are lost on replay |

Each message names the problem and the fix. The rules apply to handlers passed to `withDurableExecution` imported from `@aws/durable-execution-sdk-js` or `awaitly-durable-lambda`, so they work without this package too.

## Diagrams

`awaitly-analyze` diagrams durable functions: steps, waits (with durations), callbacks (with timeouts), invokes, `parallel` branches, `map` loops, child contexts, and early `return`s of a failed Result.

```bash
npx awaitly-analyze src/checkout.ts                       # Mermaid diagram
npx awaitly-analyze src/checkout.ts --assert-diagrammable  # CI gate
```

## License

MIT
