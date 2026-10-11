import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from "vitest";
import type { StandardSchemaV1 as SpecSchema } from "@standard-schema/spec";
import { z } from "zod";
import { ok } from "awaitly";
import { withDurableExecution, type HandlerEvent } from "./index";
import { LocalDurableTestRunner } from "./testing";
import type { StandardSchemaV1 } from "./validate-event";
import { validateEvent } from "./validate-event";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }));
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("validateEvent with real Standard Schema libraries", () => {
  it("accepts any spec-conforming schema", () => {
    expectTypeOf<SpecSchema<{ a: string }, { a: number }>>().toExtend<StandardSchemaV1<{ a: string }, { a: number }>>();
  });

  const Order = z.object({ orderId: z.string().min(1), amount: z.coerce.number().positive() });
  const order = withDurableExecution(
    validateEvent(Order, async (event, context) => context.step("double", async () => ok(event.amount * 2)))
  );

  it("parses with zod and types callers by its input", async () => {
    expectTypeOf<HandlerEvent<typeof order>>().toEqualTypeOf<z.input<typeof Order>>();

    const execution = await new LocalDurableTestRunner({ handlerFunction: order }).run({
      payload: { orderId: "o1", amount: "21" },
    });
    expect(execution.getResult()).toEqual({ ok: true, value: 42 });
  });

  it("reports zod issues with dotted paths", async () => {
    const execution = await new LocalDurableTestRunner({ handlerFunction: order }).run({
      payload: { orderId: "", amount: -1 },
    });

    expect(execution.getResult()).toMatchObject({
      ok: false,
      error: { type: "INVALID_EVENT", issues: [{ path: "orderId" }, { path: "amount" }] },
    });
  });
});
