import { describe, it, expect, vi } from "vitest";
import {
  createSagaWorkflow,
  runSaga,
  isSagaCompensationError,
  type SagaEvent,
} from "./saga";
import { ok, err, type AsyncResult } from "./core";

describe("Saga / Compensation Pattern", () => {
  describe("createSagaWorkflow", () => {
    it("should execute steps successfully without compensation", async () => {
      const step1 = vi.fn().mockResolvedValue(ok({ id: "1" }));
      const step2 = vi.fn().mockResolvedValue(ok({ id: "2" }));

      const saga = createSagaWorkflow({ step1, step2 });

      const result = await saga(async (ctx) => {
        const r1 = await ctx.step(() => step1());
        const r2 = await ctx.step(() => step2());
        return { r1, r2 };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ r1: { id: "1" }, r2: { id: "2" } });
      }
    });

    it("should run compensations in reverse order on failure", async () => {
      const compensationOrder: string[] = [];

      const reserveInventory = async (): AsyncResult<{ id: string }, "RESERVE_ERROR"> =>
        ok({ id: "reservation-1" });

      const chargeCard = async (): AsyncResult<{ txId: string }, "CHARGE_ERROR"> =>
        ok({ txId: "tx-1" });

      const sendEmail = async (): AsyncResult<void, "EMAIL_ERROR"> =>
        err("EMAIL_ERROR");

      const compensate1 = vi.fn().mockImplementation(() => {
        compensationOrder.push("release-inventory");
      });

      const compensate2 = vi.fn().mockImplementation(() => {
        compensationOrder.push("refund-payment");
      });

      const saga = createSagaWorkflow({ reserveInventory, chargeCard, sendEmail });

      const result = await saga(async (ctx) => {
        const reservation = await ctx.step(() => reserveInventory(), {
          name: "reserve",
          compensate: compensate1,
        });

        const payment = await ctx.step(() => chargeCard(), {
          name: "charge",
          compensate: compensate2,
        });

        await ctx.step(() => sendEmail(), { name: "email" });

        return { reservation, payment };
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("EMAIL_ERROR");
      }

      // Compensations should run in reverse order
      expect(compensate2).toHaveBeenCalledWith({ txId: "tx-1" });
      expect(compensate1).toHaveBeenCalledWith({ id: "reservation-1" });
      expect(compensationOrder).toEqual(["refund-payment", "release-inventory"]);
    });

    it("should handle compensation failures", async () => {
      const reserveInventory = async (): AsyncResult<{ id: string }, "RESERVE_ERROR"> =>
        ok({ id: "reservation-1" });

      const chargeCard = async (): AsyncResult<{ txId: string }, "CHARGE_ERROR"> =>
        err("CHARGE_ERROR");

      const compensate1 = vi.fn().mockRejectedValue(new Error("Compensation failed!"));

      const saga = createSagaWorkflow({ reserveInventory, chargeCard });

      const result = await saga(async (ctx) => {
        const reservation = await ctx.step(() => reserveInventory(), {
          name: "reserve",
          compensate: compensate1,
        });

        await ctx.step(() => chargeCard(), { name: "charge" });

        return { reservation };
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isSagaCompensationError(result.error)).toBe(true);
        if (isSagaCompensationError(result.error)) {
          expect(result.error.originalError).toBe("CHARGE_ERROR");
          expect(result.error.compensationErrors).toHaveLength(1);
          expect(result.error.compensationErrors[0].stepName).toBe("reserve");
        }
      }
    });

    it("should track compensations via getCompensations", async () => {
      const step1 = vi.fn().mockResolvedValue(ok({ id: "1" }));
      const step2 = vi.fn().mockResolvedValue(ok({ id: "2" }));

      const saga = createSagaWorkflow({ step1, step2 });

      let recordedCompensations: Array<{ name?: string; hasValue: boolean }> = [];

      await saga(async (ctx) => {
        await ctx.step(() => step1(), {
          name: "step1",
          compensate: () => {},
        });

        await ctx.step(() => step2(), {
          name: "step2",
          compensate: () => {},
        });

        recordedCompensations = ctx.getCompensations();
        return {};
      });

      expect(recordedCompensations).toEqual([
        { name: "step1", hasValue: true },
        { name: "step2", hasValue: true },
      ]);
    });

    it("should emit saga events", async () => {
      const events: SagaEvent[] = [];
      const step1 = vi.fn().mockResolvedValue(ok({ id: "1" }));

      const saga = createSagaWorkflow(
        { step1 },
        { onEvent: (e) => events.push(e as SagaEvent) }
      );

      await saga(async (ctx) => {
        await ctx.step(() => step1());
        return {};
      });

      expect(events.some((e) => e.type === "saga_start")).toBe(true);
      expect(events.some((e) => e.type === "saga_success")).toBe(true);
    });

    it("should emit compensation events on failure", async () => {
      const events: SagaEvent[] = [];
      const step1 = vi.fn().mockResolvedValue(ok({ id: "1" }));
      const step2 = vi.fn().mockResolvedValue(err("FAIL"));
      const compensate = vi.fn();

      const saga = createSagaWorkflow(
        { step1, step2 },
        { onEvent: (e) => events.push(e as SagaEvent) }
      );

      await saga(async (ctx) => {
        await ctx.step(() => step1(), {
          name: "step1",
          compensate,
        });
        await ctx.step(() => step2());
        return {};
      });

      expect(events.some((e) => e.type === "saga_error")).toBe(true);
      expect(events.some((e) => e.type === "saga_compensation_start")).toBe(true);
      expect(events.some((e) => e.type === "saga_compensation_step")).toBe(true);
      expect(events.some((e) => e.type === "saga_compensation_end")).toBe(true);
    });
  });

  describe("tryStep", () => {
    it("should catch thrown errors and run compensations", async () => {
      const compensate = vi.fn();

      type MyError = "STEP_ERROR" | "STEP2_ERROR";

      const result = await runSaga<string, MyError>(async (ctx) => {
        const value = await ctx.tryStep(
          () => Promise.resolve("success"),
          {
            error: "STEP_ERROR",
            name: "step1",
            compensate,
          }
        );

        await ctx.tryStep(
          () => {
            throw new Error("Boom!");
          },
          { error: "STEP2_ERROR", name: "step2" }
        );

        return value;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("STEP2_ERROR");
      }
      expect(compensate).toHaveBeenCalledWith("success");
    });

    it("should use onError mapper for thrown errors", async () => {
      type MappedError = { type: "MAPPED_ERROR"; message: string };

      const result = await runSaga<Record<string, never>, MappedError>(async (ctx) => {
        await ctx.tryStep(
          () => {
            throw new Error("Custom error message");
          },
          {
            onError: (e) => ({
              type: "MAPPED_ERROR" as const,
              message: (e as Error).message,
            }),
          }
        );
        return {};
      });

      expect(result.ok).toBe(false);
      if (!result.ok && typeof result.error === "object" && result.error !== null) {
        expect((result.error as { type: string }).type).toBe("MAPPED_ERROR");
      }
    });
  });

  describe("runSaga (low-level API)", () => {
    it("should work without deps object", async () => {
      type MyError = "STEP1_ERROR" | "STEP2_ERROR";

      const result = await runSaga<{ value: string }, MyError>(async (ctx) => {
        const v1 = await ctx.step(() => ok("hello"), {
          name: "step1",
          compensate: () => {},
        });

        const v2 = await ctx.step(() => ok("world"), {
          name: "step2",
          compensate: () => {},
        });

        return { value: `${v1} ${v2}` };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ value: "hello world" });
      }
    });

    it("should run compensations on failure", async () => {
      const compensationOrder: string[] = [];

      const result = await runSaga<{ value: string }, "FAIL">(async (ctx) => {
        await ctx.step(() => ok("a"), {
          name: "step1",
          compensate: () => {
            compensationOrder.push("comp1");
          },
        });

        await ctx.step(() => ok("b"), {
          name: "step2",
          compensate: () => {
            compensationOrder.push("comp2");
          },
        });

        await ctx.step(() => err("FAIL" as const));

        return { value: "never" };
      });

      expect(result.ok).toBe(false);
      expect(compensationOrder).toEqual(["comp2", "comp1"]);
    });
  });

  describe("isSagaCompensationError", () => {
    it("should return true for SagaCompensationError", () => {
      const error = {
        type: "SAGA_COMPENSATION_ERROR" as const,
        originalError: "FAIL",
        compensationErrors: [],
      };
      expect(isSagaCompensationError(error)).toBe(true);
    });

    it("should return false for other errors", () => {
      expect(isSagaCompensationError(new Error("test"))).toBe(false);
      expect(isSagaCompensationError(null)).toBe(false);
      expect(isSagaCompensationError({ type: "OTHER" })).toBe(false);
    });
  });
});
