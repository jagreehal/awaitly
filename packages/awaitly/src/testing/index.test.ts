import { describe, it, expect } from "vitest";
import {
  createWorkflowHarness,
  createMockFn,
  createTestClock,
  createSnapshot,
  compareSnapshots,
  okOutcome,
  errOutcome,
  throwOutcome,
  expectOk,
  expectErr,
  unwrapOk,
  unwrapErr,
  unwrapOkAsync,
  unwrapErrAsync,
} from ".";
import { ok, err } from "../core";
import type { AsyncResult } from "../core";

describe("Testing Harness", () => {
  describe("createWorkflowHarness", () => {
    it("should create a harness instance", () => {
      const harness = createWorkflowHarness({
        fetchUser: () => ok({ id: "1", name: "Alice" }),
      });

      expect(harness).toBeDefined();
      expect(harness.script).toBeInstanceOf(Function);
      expect(harness.run).toBeInstanceOf(Function);
    });

    it("should run workflow with scripted outcomes", async () => {
      const fetchUser = (id: string): AsyncResult<{ id: string; name: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id, name: "Alice" }));

      const chargeCard = (_amount: number): AsyncResult<{ txId: string }, "PAYMENT_FAILED"> =>
        Promise.resolve(ok({ txId: "tx-123" }));

      const harness = createWorkflowHarness({ fetchUser, chargeCard });

      harness.script([
        okOutcome({ id: "1", name: "Alice" }),
        okOutcome({ txId: "tx-123" }),
      ]);

      const result = await harness.run(async (step, { fetchUser, chargeCard }) => {
        const user = await step("fetch-user", () => fetchUser("1"));
        const payment = await step("charge-card", () => chargeCard(100));
        return { user, payment };
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user).toEqual({ id: "1", name: "Alice" });
        expect(result.value.payment).toEqual({ txId: "tx-123" });
      }
    });

    it("should handle error outcomes", async () => {
      const fetchUser = (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([errOutcome("NOT_FOUND")]);

      const result = await harness.run(async (step, { fetchUser }) => {
        const user = await step("fetch-user", () => fetchUser("1"));
        return user;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("NOT_FOUND");
      }
    });

    it("should handle throw outcomes", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([throwOutcome(new Error("Network error"))]);

      const result = await harness.run(async (step, { fetchUser }) => {
        const user = await step("fetch-user", () => fetchUser());
        return user;
      });

      expect(result.ok).toBe(false);
    });

    it("should script specific steps by name", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));

      const chargeCard = (): AsyncResult<{ txId: string }, "FAILED"> =>
        Promise.resolve(ok({ txId: "tx-1" }));

      const harness = createWorkflowHarness({ fetchUser, chargeCard });

      // Script sequential outcomes first, then override specific steps
      harness.script([okOutcome({ id: "1" })]);
      harness.scriptStep("charge-card", errOutcome("FAILED"));

      const result = await harness.run(async (step, { fetchUser, chargeCard }) => {
        const user = await step("fetch-user", () => fetchUser());
        const payment = await step("charge-card", () => chargeCard());
        return { user, payment };
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("FAILED");
      }
    });

    it("should support step.try for catching throws", async () => {
      const fetchUser = (): { id: string } => {
        throw new Error("Network error");
      };

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([okOutcome({ id: "1", name: "Alice" })]);

      const result = await harness.run(async (step, { fetchUser }) => {
        const user = await step.try("fetch-user", () => fetchUser(), {
          error: "FETCH_FAILED" as const,
        });
        return user;
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ id: "1", name: "Alice" });
      }
    });

    it("should support step.try with onError callback", async () => {
      const fetchUser = (): { id: string } => {
        throw new Error("Network error");
      };

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([errOutcome({ code: "NETWORK_ERROR", message: "Network error" })]);

      const result = await harness.run(async (step, { fetchUser }) => {
        const user = await step.try("fetch-user", () => fetchUser(), {
          onError: (e) => ({
            code: "NETWORK_ERROR" as const,
            message: e instanceof Error ? e.message : "Unknown",
          }),
        });
        return user;
      });

      expect(result.ok).toBe(false);
    });

    it("should run workflow with input", async () => {
      const fetchUser = (id: string): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([okOutcome({ id: "user-123" })]);

      const result = await harness.runWithInput(
        { userId: "user-123" },
        async (step, { fetchUser }, input) => {
          const user = await step("fetch-user", () => fetchUser(input.userId));
          return user;
        }
      );

      expect(result.ok).toBe(true);
    });
  });

  describe("getInvocations", () => {
    it("should record step invocations", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([okOutcome({ id: "1" })]);

      await harness.run(async (step, { fetchUser }) => {
        return step("fetch-user", () => fetchUser(), { key: "user:1" });
      });

      const invocations = harness.getInvocations();
      expect(invocations).toHaveLength(1);
      expect(invocations[0].name).toBe("fetch-user");
      expect(invocations[0].key).toBe("user:1");
      expect(invocations[0].order).toBe(0);
    });

    it("should record invocation results", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([okOutcome({ id: "1", name: "Alice" })]);

      await harness.run(async (step, { fetchUser }) => {
        return step("fetch-user", () => fetchUser());
      });

      const invocations = harness.getInvocations();
      expect(invocations[0].result?.ok).toBe(true);
    });
  });

  describe("assertions", () => {
    it("should assert steps were invoked in order", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));
      const chargeCard = (): AsyncResult<{ txId: string }, "FAILED"> =>
        Promise.resolve(ok({ txId: "tx-1" }));

      const harness = createWorkflowHarness({ fetchUser, chargeCard });

      harness.script([
        okOutcome({ id: "1" }),
        okOutcome({ txId: "tx-1" }),
      ]);

      await harness.run(async (step, { fetchUser, chargeCard }) => {
        await step("fetch-user", () => fetchUser());
        await step("charge-card", () => chargeCard());
        return "done";
      });

      const assertion = harness.assertSteps(["fetch-user", "charge-card"]);
      expect(assertion.passed).toBe(true);
    });

    it("should fail assertion when steps are out of order", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));
      const chargeCard = (): AsyncResult<{ txId: string }, "FAILED"> =>
        Promise.resolve(ok({ txId: "tx-1" }));

      const harness = createWorkflowHarness({ fetchUser, chargeCard });

      harness.script([
        okOutcome({ id: "1" }),
        okOutcome({ txId: "tx-1" }),
      ]);

      await harness.run(async (step, { fetchUser, chargeCard }) => {
        await step("fetch-user", () => fetchUser());
        await step("charge-card", () => chargeCard());
        return "done";
      });

      const assertion = harness.assertSteps(["charge-card", "fetch-user"]);
      expect(assertion.passed).toBe(false);
      expect(assertion.message).toContain("Expected steps");
    });

    it("should assert step was called", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([okOutcome({ id: "1" })]);

      await harness.run(async (step, { fetchUser }) => {
        return step("fetch-user", () => fetchUser());
      });

      const assertion = harness.assertStepCalled("fetch-user");
      expect(assertion.passed).toBe(true);
    });

    it("should assert step was NOT called", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([okOutcome({ id: "1" })]);

      await harness.run(async (step, { fetchUser }) => {
        return step("fetch-user", () => fetchUser());
      });

      const assertion = harness.assertStepNotCalled("charge-card");
      expect(assertion.passed).toBe(true);
    });

    it("should assert result matches expected", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([okOutcome({ id: "1", name: "Alice" })]);

      const result = await harness.run(async (step, { fetchUser }) => {
        return step("fetch-user", () => fetchUser());
      });

      const assertion = harness.assertResult(result, ok({ id: "1", name: "Alice" }));
      expect(assertion.passed).toBe(true);
    });
  });

  describe("reset", () => {
    it("should reset harness state", async () => {
      const fetchUser = (): AsyncResult<{ id: string }, "NOT_FOUND"> =>
        Promise.resolve(ok({ id: "1" }));

      const harness = createWorkflowHarness({ fetchUser });

      harness.script([okOutcome({ id: "1" })]);

      await harness.run(async (step, { fetchUser }) => {
        return step("fetch-user", () => fetchUser());
      });

      expect(harness.getInvocations()).toHaveLength(1);

      harness.reset();

      expect(harness.getInvocations()).toHaveLength(0);
    });
  });

  describe("createMockFn", () => {
    it("should create a mock function", () => {
      const mock = createMockFn<{ id: string }, "NOT_FOUND">();
      expect(mock).toBeInstanceOf(Function);
    });

    it("should return configured value", async () => {
      const mock = createMockFn<{ id: string }, "NOT_FOUND">();
      mock.returns(ok({ id: "1" }));

      const result = await mock("arg1", "arg2");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ id: "1" });
      }
    });

    it("should return values in sequence with returnsOnce", async () => {
      const mock = createMockFn<number, "ERROR">();
      mock.returnsOnce(ok(1));
      mock.returnsOnce(ok(2));
      mock.returnsOnce(err("ERROR"));

      const r1 = await mock();
      const r2 = await mock();
      const r3 = await mock();

      expect(r1.ok && r1.value).toBe(1);
      expect(r2.ok && r2.value).toBe(2);
      expect(r3.ok).toBe(false);
    });

    it("should fall back to default after sequence exhausted", async () => {
      const mock = createMockFn<number, "ERROR">();
      mock.returnsOnce(ok(1));
      mock.returns(ok(99));

      const r1 = await mock();
      const r2 = await mock();
      const r3 = await mock();

      expect(r1.ok && r1.value).toBe(1);
      expect(r2.ok && r2.value).toBe(99);
      expect(r3.ok && r3.value).toBe(99);
    });

    it("should track calls", async () => {
      const mock = createMockFn<number, "ERROR">();
      mock.returns(ok(1));

      await mock("a", "b");
      await mock("c");

      expect(mock.getCallCount()).toBe(2);
      expect(mock.getCalls()).toEqual([["a", "b"], ["c"]]);
    });

    it("should throw when called without configured return", async () => {
      const mock = createMockFn<number, "ERROR">();

      await expect(async () => mock()).rejects.toThrow("Mock function called without configured return value");
    });

    it("should reset state", async () => {
      const mock = createMockFn<number, "ERROR">();
      mock.returns(ok(1));
      await mock();

      mock.reset();

      expect(mock.getCallCount()).toBe(0);
      await expect(async () => mock()).rejects.toThrow();
    });
  });

  describe("createTestClock", () => {
    it("should create a test clock", () => {
      const clock = createTestClock(1000);
      expect(clock.now()).toBe(1000);
    });

    it("should advance time", () => {
      const clock = createTestClock(0);
      clock.advance(100);
      expect(clock.now()).toBe(100);

      clock.advance(50);
      expect(clock.now()).toBe(150);
    });

    it("should set time directly", () => {
      const clock = createTestClock(0);
      clock.set(5000);
      expect(clock.now()).toBe(5000);
    });

    it("should reset to start time", () => {
      const clock = createTestClock(1000);
      clock.advance(500);
      clock.reset();
      expect(clock.now()).toBe(1000);
    });
  });

  describe("createSnapshot / compareSnapshots", () => {
    it("should create a snapshot", () => {
      const invocations = [
        { name: "Step A", order: 0, timestamp: 1000, durationMs: 10, result: ok("a") },
        { name: "Step B", order: 1, timestamp: 1010, durationMs: 20, result: ok("b") },
      ];

      const snapshot = createSnapshot(invocations, ok({ a: "a", b: "b" }));

      expect(snapshot.invocations).toHaveLength(2);
      expect(snapshot.result.ok).toBe(true);
      expect(snapshot.durationMs).toBe(30);
      // Timestamps should be normalized
      expect(snapshot.invocations[0].timestamp).toBe(0);
    });

    it("should compare equal snapshots", () => {
      const invocations1 = [
        { name: "Step A", order: 0, timestamp: 1000, result: ok("a") },
      ];
      const invocations2 = [
        { name: "Step A", order: 0, timestamp: 2000, result: ok("a") },
      ];

      const snapshot1 = createSnapshot(invocations1, ok("result"));
      const snapshot2 = createSnapshot(invocations2, ok("result"));

      const comparison = compareSnapshots(snapshot1, snapshot2);
      expect(comparison.equal).toBe(true);
      expect(comparison.differences).toHaveLength(0);
    });

    it("should detect different invocation counts", () => {
      const snapshot1 = createSnapshot(
        [{ name: "Step A", order: 0, timestamp: 0, result: ok("a") }],
        ok("result")
      );
      const snapshot2 = createSnapshot(
        [
          { name: "Step A", order: 0, timestamp: 0, result: ok("a") },
          { name: "Step B", order: 1, timestamp: 0, result: ok("b") },
        ],
        ok("result")
      );

      const comparison = compareSnapshots(snapshot1, snapshot2);
      expect(comparison.equal).toBe(false);
      expect(comparison.differences).toContain("Invocation count: 1 vs 2");
    });

    it("should detect different step names", () => {
      const snapshot1 = createSnapshot(
        [{ name: "Step A", order: 0, timestamp: 0, result: ok("a") }],
        ok("result")
      );
      const snapshot2 = createSnapshot(
        [{ name: "Step B", order: 0, timestamp: 0, result: ok("a") }],
        ok("result")
      );

      const comparison = compareSnapshots(snapshot1, snapshot2);
      expect(comparison.equal).toBe(false);
      expect(comparison.differences.some((d) => d.includes("name"))).toBe(true);
    });

    it("should detect different final results", () => {
      const snapshot1 = createSnapshot([], ok("result"));
      const snapshot2 = createSnapshot([], err("ERROR"));

      const comparison = compareSnapshots(snapshot1, snapshot2);
      expect(comparison.equal).toBe(false);
      expect(comparison.differences.some((d) => d.includes("Final result"))).toBe(true);
    });
  });

  describe("outcome helpers", () => {
    it("okOutcome should create ok outcome", () => {
      const outcome = okOutcome({ id: "1" });
      expect(outcome).toEqual({ type: "ok", value: { id: "1" } });
    });

    it("errOutcome should create err outcome", () => {
      const outcome = errOutcome("NOT_FOUND");
      expect(outcome).toEqual({ type: "err", error: "NOT_FOUND" });
    });

    it("throwOutcome should create throw outcome", () => {
      const error = new Error("Network error");
      const outcome = throwOutcome(error);
      expect(outcome).toEqual({ type: "throw", error });
    });
  });

  describe("Result Assertions", () => {
    describe("expectOk", () => {
      it("should pass for ok result", () => {
        const result = ok(42);
        expect(() => expectOk(result)).not.toThrow();
      });

      it("should throw for err result with descriptive message", () => {
        const result = err("NOT_FOUND");
        expect(() => expectOk(result)).toThrow("Expected Ok result, got Err");
      });

      it("should narrow type after assertion", () => {
        const result = ok(42) as ReturnType<typeof ok<number>> | ReturnType<typeof err<string>>;
        expectOk(result);
        // TypeScript allows accessing .value after expectOk
        const value: number = result.value;
        expect(value).toBe(42);
      });
    });

    describe("expectErr", () => {
      it("should pass for err result", () => {
        expect(() => expectErr(err("oops"))).not.toThrow();
      });

      it("should throw for ok result with descriptive message", () => {
        expect(() => expectErr(ok(42))).toThrow("Expected Err result, got Ok");
      });

      it("should narrow type after assertion", () => {
        const result = err("NOT_FOUND") as ReturnType<typeof ok<number>> | ReturnType<typeof err<string>>;
        expectErr(result);
        // TypeScript allows accessing .error after expectErr
        const error: string = result.error;
        expect(error).toBe("NOT_FOUND");
      });
    });

    describe("unwrapOk", () => {
      it("should return value for ok result", () => {
        expect(unwrapOk(ok(42))).toBe(42);
      });

      it("should return complex value", () => {
        const user = { id: "1", name: "Alice" };
        expect(unwrapOk(ok(user))).toEqual(user);
      });

      it("should throw for err result", () => {
        expect(() => unwrapOk(err("oops"))).toThrow();
      });
    });

    describe("unwrapErr", () => {
      it("should return error for err result", () => {
        expect(unwrapErr(err("NOT_FOUND"))).toBe("NOT_FOUND");
      });

      it("should return complex error", () => {
        const error = { type: "VALIDATION", field: "email" };
        expect(unwrapErr(err(error))).toEqual(error);
      });

      it("should throw for ok result", () => {
        expect(() => unwrapErr(ok(42))).toThrow();
      });
    });

    describe("unwrapOkAsync", () => {
      it("should await and return value", async () => {
        const asyncResult = Promise.resolve(ok(42));
        expect(await unwrapOkAsync(asyncResult)).toBe(42);
      });

      it("should throw for err result", async () => {
        const asyncResult = Promise.resolve(err("oops"));
        await expect(unwrapOkAsync(asyncResult)).rejects.toThrow();
      });
    });

    describe("unwrapErrAsync", () => {
      it("should await and return error", async () => {
        const asyncResult = Promise.resolve(err("NOT_FOUND"));
        expect(await unwrapErrAsync(asyncResult)).toBe("NOT_FOUND");
      });

      it("should throw for ok result", async () => {
        const asyncResult = Promise.resolve(ok(42));
        await expect(unwrapErrAsync(asyncResult)).rejects.toThrow();
      });
    });
  });
});
