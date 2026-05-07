import { describe, it, expect, vi } from "vitest";
import {
  createSagaWorkflow,
  runSaga,
  isSagaCompensationError,
} from "./saga";
import { ok, err, type AsyncResult } from "./core";

describe("Saga / Compensation Pattern", () => {
  describe("createSagaWorkflow", () => {
    it("supports provide-style dep overrides", async () => {
      const getMessage = vi.fn().mockResolvedValue(ok("base"));
      const saga = createSagaWorkflow("provided-saga", { getMessage });

      const result = await saga
        .provide({ getMessage: vi.fn().mockResolvedValue(ok("provided")) })
        .run(async ({ step, deps }) =>
          step("getMessage", () => deps.getMessage())
        );

      expect(result).toEqual({ ok: true, value: "provided" });
    });

    it("chains provide() with right-most precedence", async () => {
      const getMessage = vi.fn().mockResolvedValue(ok("base"));
      const saga = createSagaWorkflow("provided-saga-chain", { getMessage })
        .provide({ getMessage: vi.fn().mockResolvedValue(ok("first")) })
        .provide({ getMessage: vi.fn().mockResolvedValue(ok("second")) });

      const result = await saga.run(async ({ step, deps }) =>
        step("getMessage", () => deps.getMessage())
      );

      expect(result).toEqual({ ok: true, value: "second" });
    });

    it("should execute steps successfully without compensation", async () => {
      const step1 = vi.fn().mockResolvedValue(ok({ id: "1" }));
      const step2 = vi.fn().mockResolvedValue(ok({ id: "2" }));

      const saga = createSagaWorkflow("saga", { step1, step2 });

      const result = await saga.run(async ({ step, deps }) => {
        const r1 = await step("step1", () => deps.step1());
        const r2 = await step("step2", () => deps.step2());
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

      const saga = createSagaWorkflow("checkout", { reserveInventory, chargeCard, sendEmail });

      const result = await saga.run(async ({ step, deps }) => {
        const reservation = await step("reserveInventory", () => deps.reserveInventory(), {
          compensate: compensate1,
        });

        const payment = await step("chargeCard", () => deps.chargeCard(), {
          compensate: compensate2,
        });

        await step("sendEmail", () => deps.sendEmail());

        return { reservation, payment };
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("EMAIL_ERROR");
      }

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

      const saga = createSagaWorkflow("checkout", { reserveInventory, chargeCard });

      const result = await saga.run(async ({ step, deps }) => {
        const reservation = await step("reserve", () => deps.reserveInventory(), {
          compensate: compensate1,
        });

        await step("charge", () => deps.chargeCard());

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

    it("emits workflow events", async () => {
      const events: Array<{ type: string }> = [];
      const step1 = vi.fn().mockResolvedValue(ok({ id: "1" }));

      const saga = createSagaWorkflow(
        "saga",
        { step1 },
        { onEvent: (e) => events.push(e) }
      );

      await saga.run(async ({ step, deps }) => {
        await step("step1", () => deps.step1());
        return {};
      });

      expect(events.some((e) => e.type === "workflow_start")).toBe(true);
      expect(events.some((e) => e.type === "workflow_success")).toBe(true);
    });

    it("emits workflow_error on failure with compensation", async () => {
      const events: Array<{ type: string }> = [];
      const step1 = vi.fn().mockResolvedValue(ok({ id: "1" }));
      const step2 = vi.fn().mockResolvedValue(err("FAIL"));
      const compensate = vi.fn();

      const saga = createSagaWorkflow(
        "saga",
        { step1, step2 },
        { onEvent: (e) => events.push(e) }
      );

      await saga.run(async ({ step, deps }) => {
        await step("step1", () => deps.step1(), { compensate });
        await step("step2", () => deps.step2());
        return {};
      });

      expect(events.some((e) => e.type === "workflow_error")).toBe(true);
      expect(compensate).toHaveBeenCalled();
    });
  });

  describe("step.try", () => {
    it("should catch thrown errors and run compensations", async () => {
      const compensate = vi.fn();

      type MyError = "STEP_ERROR" | "STEP2_ERROR";

      const result = await runSaga<string, MyError>(async ({ step }) => {
        const value = await step.try(
          "step1",
          () => Promise.resolve("success"),
          { error: "STEP_ERROR", compensate }
        );

        await step.try(
          "step2",
          () => {
            throw new Error("Boom!");
          },
          { error: "STEP2_ERROR" }
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

      const result = await runSaga<Record<string, never>, MappedError>(async ({ step }) => {
        await step.try(
          "mapped-step",
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

      const result = await runSaga<{ value: string }, MyError>(async ({ step }) => {
        const v1 = await step("step1", () => ok("hello"), { compensate: () => {} });
        const v2 = await step("step2", () => ok("world"), { compensate: () => {} });
        return { value: `${v1} ${v2}` };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ value: "hello world" });
      }
    });

    it("should run compensations on failure", async () => {
      const compensationOrder: string[] = [];

      const result = await runSaga<{ value: string }, "FAIL">(async ({ step }) => {
        await step("step1", () => ok("a"), {
          compensate: () => { compensationOrder.push("comp1"); },
        });

        await step("step2", () => ok("b"), {
          compensate: () => { compensationOrder.push("comp2"); },
        });

        await step("step3", () => err("FAIL" as const));

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
