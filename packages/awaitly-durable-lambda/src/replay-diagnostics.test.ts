import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ok } from "awaitly";
import { explainReplayViolation, replayDiagnostics, withDurableExecution, type ReplayDiagnostic } from "./index";
import { LocalDurableTestRunner, WaitingOperationStatus } from "./testing";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment({ skipTime: true }));
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("explainReplayViolation", () => {
  it.each([
    [
      'Non-deterministic execution detected: Operation name mismatch for step "1". Expected name "a", but got "b". This indicates non-deterministic control flow in your workflow code.',
      { kind: "name-mismatch", operation: "1", expected: "a", actual: "b" },
    ],
    [
      'Non-deterministic execution detected: Operation type mismatch for step "2". Expected type "STEP", but got "WAIT". This indicates non-deterministic control flow in your workflow code.',
      { kind: "type-mismatch", operation: "2", expected: "STEP", actual: "WAIT" },
    ],
    [
      'Non-deterministic execution detected: Operation subtype mismatch for step "3". Expected subtype "Step", but got "WaitForCallback". This indicates non-deterministic control flow in your workflow code.',
      { kind: "subtype-mismatch", operation: "3", expected: "Step", actual: "WaitForCallback" },
    ],
    [
      'Context usage error in "charge": You are using a parent or sibling context instead of the current child context.',
      { kind: "context-scope", operation: "charge" },
    ],
  ])("explains %s", (message, expected) => {
    expect(explainReplayViolation(new Error(message))).toMatchObject(expected);
  });

  it("says what to change, not only what diverged", () => {
    const diagnostic = explainReplayViolation(
      new Error('Operation type mismatch for step "2". Expected type "STEP", but got "WAIT".')
    );
    expect(diagnostic?.explanation).toContain("Compute it inside context.step(...)");
    expect(diagnostic?.explanation).toContain("published version or alias");
  });

  it("ignores other errors", () => {
    expect(explainReplayViolation(new Error("ECONNRESET"))).toBeUndefined();
    expect(explainReplayViolation(undefined)).toBeUndefined();
  });
});

describe("replayDiagnostics", () => {
  it("explains a replay violation that fails an execution, leaving the native error as is", async () => {
    const logged: ReplayDiagnostic[] = [];
    let invocation = 0;
    const handler = withDurableExecution(
      async (_event: unknown, context) => {
        invocation += 1;
        // A name that differs between invocations: the replay violation.
        await context.step(invocation === 1 ? "first" : "second", async () => ok(1));
        // Suspends until the callback arrives, so the next invocation replays.
        await context.waitForCallback("approve", async () => {}, { timeout: { hours: 1 } });
        return "done";
      },
      { plugins: [replayDiagnostics({ log: (d) => logged.push(d) })] }
    );

    const runner = new LocalDurableTestRunner({ handlerFunction: handler });
    const pending = runner.run();
    await (await runner.getOperation("approve").waitForData(WaitingOperationStatus.SUBMITTED)).sendCallbackSuccess('"ok"');
    const execution = await pending;

    expect(execution.getStatus()).toBe("FAILED");
    expect(execution.getError().errorType).toBe("NonDeterministicExecutionError");
    expect(logged).toEqual([
      expect.objectContaining({ kind: "name-mismatch", expected: "first", actual: "second" }),
    ]);
  });
});
