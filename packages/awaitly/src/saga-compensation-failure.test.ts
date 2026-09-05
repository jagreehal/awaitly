/**
 * What happens when a rollback itself fails.
 *
 * Mutation testing found this whole region unmutated: every line that collects
 * a failed compensation, emits its event, and reports SAGA_COMPENSATION_ERROR
 * could be deleted with the suite still green. A failed compensation is the
 * worst outcome a saga has — the charge went through and the refund did not —
 * so it is the last thing that should go unasserted.
 */

import { describe, it, expect, vi } from "vitest";
import { runSaga, isSagaCompensationError } from "./saga";
import { ok, err, type AsyncResult, type SagaEvent } from "./core";

type CompEvent = Extract<SagaEvent, { type: "saga_compensation_step" }>;

const charge = async (): AsyncResult<{ id: string }, "CHARGE_FAILED"> => ok({ id: "ch_1" });
const ship = async (): AsyncResult<never, "SHIP_FAILED"> => err("SHIP_FAILED");

describe("saga compensation failure", () => {
  it("reports a compensation that returns err rather than claiming a clean rollback", async () => {
    const result = await runSaga<string, "CHARGE_FAILED" | "SHIP_FAILED">(async ({ step }) => {
      await step("charge", charge, {
        // The refund fails. The money is still gone.
        compensate: async () => err("REFUND_FAILED"),
      });
      await step("ship", ship);
      return "unreachable";
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSagaCompensationError(result.error)).toBe(true);
    const sagaError = result.error as {
      originalError: unknown;
      compensationErrors: Array<{ stepName?: string; error: unknown }>;
    };
    expect(sagaError.originalError).toBe("SHIP_FAILED");
    expect(sagaError.compensationErrors).toHaveLength(1);
    expect(sagaError.compensationErrors[0]).toMatchObject({
      stepName: "charge",
      error: "REFUND_FAILED",
    });
  });

  it("reports a compensation that throws", async () => {
    const result = await runSaga<string, "CHARGE_FAILED" | "SHIP_FAILED">(async ({ step }) => {
      await step("charge", charge, {
        compensate: async () => {
          throw new Error("refund endpoint down");
        },
      });
      await step("ship", ship);
      return "unreachable";
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSagaCompensationError(result.error)).toBe(true);
    const { compensationErrors } = result.error as {
      compensationErrors: Array<{ stepName?: string; error: unknown }>;
    };
    expect(compensationErrors).toHaveLength(1);
    expect((compensationErrors[0]!.error as Error).message).toBe("refund endpoint down");
  });

  it("emits a failed compensation event and closes with a failure count", async () => {
    const events: SagaEvent[] = [];

    await runSaga<string, "CHARGE_FAILED" | "SHIP_FAILED">(
      async ({ step }) => {
        await step("charge", charge, { compensate: async () => err("REFUND_FAILED") });
        await step("ship", ship);
        return "unreachable";
      },
      { onEvent: (e) => events.push(e) }
    );

    const stepEvents = events.filter((e): e is CompEvent => e.type === "saga_compensation_step");
    expect(stepEvents).toHaveLength(1);
    expect(stepEvents[0]).toMatchObject({ stepName: "charge", success: false });

    const end = events.find((e) => e.type === "saga_compensation_end") as
      | { success: boolean; failedCount: number }
      | undefined;
    expect(end).toMatchObject({ success: false, failedCount: 1 });
  });

  it("keeps compensating later steps after an earlier one fails", async () => {
    const order: string[] = [];

    const result = await runSaga<string, "SHIP_FAILED">(async ({ step }) => {
      await step("reserve", async () => ok({ id: "r_1" }), {
        compensate: async () => {
          order.push("reserve");
          return ok(undefined);
        },
      });
      await step("charge", charge, {
        compensate: async () => {
          order.push("charge");
          return err("REFUND_FAILED");
        },
      });
      await step("ship", ship);
      return "unreachable";
    });

    // Compensations run newest-first, and one failure must not strand the rest.
    expect(order).toEqual(["charge", "reserve"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const { compensationErrors } = result.error as { compensationErrors: unknown[] };
    expect(compensationErrors).toHaveLength(1);
  });

  it("hands the compensation error to onError", async () => {
    const onError = vi.fn();

    await runSaga<string, "SHIP_FAILED">(
      async ({ step }) => {
        await step("charge", charge, { compensate: async () => err("REFUND_FAILED") });
        await step("ship", ship);
        return "unreachable";
      },
      { onError }
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(isSagaCompensationError(onError.mock.calls[0]![0])).toBe(true);
  });

  it("throws instead of returning when throwOnCompensationFailure is set", async () => {
    await expect(
      runSaga<string, "SHIP_FAILED">(
        async ({ step }) => {
          await step("charge", charge, { compensate: async () => err("REFUND_FAILED") });
          await step("ship", ship);
          return "unreachable";
        },
        { throwOnCompensationFailure: true }
      )
    ).rejects.toMatchObject({ type: "SAGA_COMPENSATION_ERROR" });
  });

  it("reports a clean rollback as the original error, not a compensation error", async () => {
    const result = await runSaga<string, "SHIP_FAILED">(async ({ step }) => {
      await step("charge", charge, { compensate: async () => ok(undefined) });
      await step("ship", ship);
      return "unreachable";
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isSagaCompensationError(result.error)).toBe(false);
    expect(result.error).toBe("SHIP_FAILED");
  });

  it("ignores a void compensation's return value", async () => {
    const result = await runSaga<string, "SHIP_FAILED">(async ({ step }) => {
      await step("charge", charge, { compensate: async () => {} });
      await step("ship", ship);
      return "unreachable";
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A compensation that returns nothing succeeded; only Result-shaped
    // failures count.
    expect(isSagaCompensationError(result.error)).toBe(false);
  });

  it("rejects a step given a non-string name", async () => {
    const result = await runSaga<string, never>(async ({ step }) => {
      await step("" as string, async () => ok("x"));
      return "unreachable";
    });

    expect(result.ok).toBe(false);
  });
});
