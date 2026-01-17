/**
 * awaitly/testing
 *
 * Deterministic Workflow Testing Harness.
 * Provides tools for scripting step outcomes and asserting workflow behavior.
 */

import type { Result, AsyncResult, StepOptions, WorkflowEvent } from "./core";
import { ok, err } from "./core";
import type { AnyResultFn, ErrorsOfDeps } from "./workflow";

// =============================================================================
// Internal Types
// =============================================================================

/**
 * Internal early exit marker used by the testing harness.
 * @internal
 */
interface TestEarlyExit<E = unknown> {
  __earlyExit: true;
  error: E;
}

/**
 * Type guard for test early exit objects.
 * @internal
 */
function isTestEarlyExit(e: unknown): e is TestEarlyExit {
  return (
    typeof e === "object" &&
    e !== null &&
    "__earlyExit" in e &&
    (e as TestEarlyExit).__earlyExit === true
  );
}

// =============================================================================
// Types
// =============================================================================

/**
 * A scripted outcome for a step.
 */
export type ScriptedOutcome<T = unknown, E = unknown> =
  | { type: "ok"; value: T }
  | { type: "err"; error: E }
  | { type: "throw"; error: unknown };

/**
 * Step invocation record.
 */
export interface StepInvocation {
  /** Step name */
  name?: string;
  /** Step key */
  key?: string;
  /** Invocation order (0-indexed) */
  order: number;
  /** Timestamp when step was invoked */
  timestamp: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Result of the step */
  result?: Result<unknown, unknown>;
  /** Whether the step was from cache */
  cached?: boolean;
}

/**
 * Assertion result.
 */
export interface AssertionResult {
  passed: boolean;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Test harness options.
 */
export interface TestHarnessOptions {
  /** Whether to record step invocations */
  recordInvocations?: boolean;
  /** Custom clock for deterministic timing */
  clock?: () => number;
}

/**
 * Mock step function that returns scripted outcomes.
 */
export type MockStep<E> = {
  /** Execute with a Result-returning operation */
  <T, StepE extends E>(
    operation: () => Result<T, StepE> | AsyncResult<T, StepE>,
    options?: StepOptions | string
  ): Promise<T>;

  /** Execute with a direct Result */
  <T, StepE extends E>(
    result: Result<T, StepE> | AsyncResult<T, StepE>,
    options?: StepOptions | string
  ): Promise<T>;

  /** step.try for catching throws */
  try: <T, Err extends E>(
    operation: () => T | Promise<T>,
    options: { error: Err; name?: string; key?: string } | { onError: (cause: unknown) => Err; name?: string; key?: string }
  ) => Promise<T>;
};

// =============================================================================
// Test Harness
// =============================================================================

/**
 * Workflow test harness interface.
 */
export interface WorkflowHarness<E, Deps> {
  /**
   * Script step outcomes in order.
   * Each outcome will be returned for the corresponding step invocation.
   */
  script(outcomes: ScriptedOutcome[]): void;

  /**
   * Script a specific step outcome by name or key.
   */
  scriptStep(nameOrKey: string, outcome: ScriptedOutcome): void;

  /**
   * Run the workflow with scripted outcomes.
   */
  run<T>(
    fn: (step: MockStep<E>, deps: Deps) => Promise<T>
  ): Promise<Result<T, E | unknown>>;

  /**
   * Run the workflow with input.
   */
  runWithInput<T, TInput>(
    input: TInput,
    fn: (step: MockStep<E>, deps: Deps, input: TInput) => Promise<T>
  ): Promise<Result<T, E | unknown>>;

  /**
   * Get recorded step invocations.
   */
  getInvocations(): StepInvocation[];

  /**
   * Assert that steps were invoked in order.
   */
  assertSteps(expectedNames: string[]): AssertionResult;

  /**
   * Assert that a step was invoked with specific options.
   */
  assertStepCalled(nameOrKey: string): AssertionResult;

  /**
   * Assert that a step was NOT invoked.
   */
  assertStepNotCalled(nameOrKey: string): AssertionResult;

  /**
   * Assert the workflow result.
   */
  assertResult<T>(result: Result<T, unknown>, expected: Result<T, unknown>): AssertionResult;

  /**
   * Clear all state for a new test.
   */
  reset(): void;
}

/**
 * Create a test harness for a workflow.
 *
 * @example
 * ```typescript
 * const harness = createWorkflowHarness({ fetchUser, chargeCard });
 *
 * // Script step outcomes
 * harness.script([
 *   { type: 'ok', value: { id: '1', name: 'Alice' } },
 *   { type: 'ok', value: { transactionId: 'tx_123' } },
 * ]);
 *
 * // Run the workflow
 * const result = await harness.run(async (step, { fetchUser, chargeCard }) => {
 *   const user = await step(() => fetchUser('1'), 'fetch-user');
 *   const charge = await step(() => chargeCard(100), 'charge-card');
 *   return { user, charge };
 * });
 *
 * // Assert
 * expect(result.ok).toBe(true);
 * harness.assertSteps(['fetch-user', 'charge-card']);
 * ```
 */
export function createWorkflowHarness<
  Deps extends Record<string, AnyResultFn>
>(
  deps: Deps,
  options: TestHarnessOptions = {}
): WorkflowHarness<ErrorsOfDeps<Deps>, Deps> {
  type E = ErrorsOfDeps<Deps>;

  const { recordInvocations = true, clock = Date.now } = options;

  let scriptedOutcomes: ScriptedOutcome[] = [];
  const namedOutcomes = new Map<string, ScriptedOutcome>();
  let invocationIndex = 0;
  let invocations: StepInvocation[] = [];

  function script(outcomes: ScriptedOutcome[]): void {
    scriptedOutcomes = [...outcomes];
    invocationIndex = 0; // Reset index when script is called
    namedOutcomes.clear(); // Clear named overrides for deterministic behavior
  }

  function scriptStep(nameOrKey: string, outcome: ScriptedOutcome): void {
    namedOutcomes.set(nameOrKey, outcome);
  }

  function getNextOutcome(nameOrKey?: string): ScriptedOutcome | undefined {
    // Check named outcomes first
    if (nameOrKey && namedOutcomes.has(nameOrKey)) {
      return namedOutcomes.get(nameOrKey);
    }

    // Fall back to sequential outcomes
    if (invocationIndex < scriptedOutcomes.length) {
      return scriptedOutcomes[invocationIndex++];
    }

    return undefined;
  }

  function createMockStep(): MockStep<E> {
    const mockStep = async <T, StepE extends E>(
      operationOrResult:
        | (() => Result<T, StepE> | AsyncResult<T, StepE>)
        | Result<T, StepE>
        | AsyncResult<T, StepE>,
      stepOptions?: StepOptions | string
    ): Promise<T> => {
      const opts = typeof stepOptions === "string" ? { name: stepOptions } : (stepOptions ?? {});
      const nameOrKey = opts.name ?? opts.key;
      const startTime = clock();

      // Record invocation
      const invocation: StepInvocation = {
        name: opts.name,
        key: opts.key,
        order: invocations.length,
        timestamp: startTime,
      };

      if (recordInvocations) {
        invocations.push(invocation);
      }

      // Get scripted outcome
      const outcome = getNextOutcome(nameOrKey);

      if (outcome) {
        invocation.durationMs = clock() - startTime;

        switch (outcome.type) {
          case "ok":
            invocation.result = ok(outcome.value);
            return outcome.value as T;

          case "err":
            invocation.result = err(outcome.error);
            throw { __earlyExit: true, error: outcome.error };

          case "throw":
            throw outcome.error;
        }
      }

      // No scripted outcome - execute the real operation
      const result =
        typeof operationOrResult === "function"
          ? await operationOrResult()
          : await operationOrResult;

      invocation.durationMs = clock() - startTime;
      invocation.result = result;

      if (!result.ok) {
        throw { __earlyExit: true, error: result.error };
      }

      return result.value;
    };

    mockStep.try = async <T, Err extends E>(
      operation: () => T | Promise<T>,
      opts:
        | { error: Err; name?: string; key?: string }
        | { onError: (cause: unknown) => Err; name?: string; key?: string }
    ): Promise<T> => {
      const nameOrKey = opts.name ?? opts.key;
      const startTime = clock();

      const invocation: StepInvocation = {
        name: opts.name,
        key: opts.key,
        order: invocations.length,
        timestamp: startTime,
      };

      if (recordInvocations) {
        invocations.push(invocation);
      }

      // Get scripted outcome
      const outcome = getNextOutcome(nameOrKey);

      if (outcome) {
        invocation.durationMs = clock() - startTime;

        switch (outcome.type) {
          case "ok":
            invocation.result = ok(outcome.value);
            return outcome.value as T;

          case "err":
            invocation.result = err(outcome.error);
            throw { __earlyExit: true, error: outcome.error };

          case "throw":
            throw outcome.error;
        }
      }

      // No scripted outcome - execute the real operation
      try {
        const value = await operation();
        invocation.durationMs = clock() - startTime;
        invocation.result = ok(value);
        return value;
      } catch (error) {
        invocation.durationMs = clock() - startTime;
        const mappedError = "error" in opts ? opts.error : opts.onError(error);
        invocation.result = err(mappedError);
        throw { __earlyExit: true, error: mappedError };
      }
    };

    return mockStep as MockStep<E>;
  }

  async function run<T>(
    fn: (step: MockStep<E>, deps: Deps) => Promise<T>
  ): Promise<Result<T, E | unknown>> {
    const mockStep = createMockStep();

    try {
      const value = await fn(mockStep, deps);
      return ok(value);
    } catch (error) {
      if (isTestEarlyExit(error)) {
        return err(error.error);
      }
      return err({ type: "UNEXPECTED_ERROR", cause: error });
    }
  }

  async function runWithInput<T, TInput>(
    input: TInput,
    fn: (step: MockStep<E>, deps: Deps, input: TInput) => Promise<T>
  ): Promise<Result<T, E | unknown>> {
    const mockStep = createMockStep();

    try {
      const value = await fn(mockStep, deps, input);
      return ok(value);
    } catch (error) {
      if (isTestEarlyExit(error)) {
        return err(error.error);
      }
      return err({ type: "UNEXPECTED_ERROR", cause: error });
    }
  }

  function getInvocations(): StepInvocation[] {
    return [...invocations];
  }

  function assertSteps(expectedNames: string[]): AssertionResult {
    const actualNames = invocations
      .map((inv) => inv.name ?? inv.key ?? "unnamed")
      .filter((n) => n !== "unnamed");

    const passed = JSON.stringify(actualNames) === JSON.stringify(expectedNames);

    return {
      passed,
      message: passed
        ? `Steps invoked in order: ${expectedNames.join(", ")}`
        : `Expected steps [${expectedNames.join(", ")}] but got [${actualNames.join(", ")}]`,
      expected: expectedNames,
      actual: actualNames,
    };
  }

  function assertStepCalled(nameOrKey: string): AssertionResult {
    const found = invocations.some(
      (inv) => inv.name === nameOrKey || inv.key === nameOrKey
    );

    return {
      passed: found,
      message: found
        ? `Step "${nameOrKey}" was invoked`
        : `Step "${nameOrKey}" was NOT invoked`,
      expected: nameOrKey,
      actual: found,
    };
  }

  function assertStepNotCalled(nameOrKey: string): AssertionResult {
    const found = invocations.some(
      (inv) => inv.name === nameOrKey || inv.key === nameOrKey
    );

    return {
      passed: !found,
      message: !found
        ? `Step "${nameOrKey}" was correctly NOT invoked`
        : `Step "${nameOrKey}" was invoked but should not have been`,
      expected: "not called",
      actual: found ? "called" : "not called",
    };
  }

  function assertResult<T>(
    result: Result<T, unknown>,
    expected: Result<T, unknown>
  ): AssertionResult {
    const passed =
      result.ok === expected.ok &&
      (result.ok
        ? JSON.stringify(result.value) === JSON.stringify((expected as { ok: true; value: T }).value)
        : JSON.stringify(result.error) === JSON.stringify((expected as { ok: false; error: unknown }).error));

    return {
      passed,
      message: passed
        ? `Result matches expected`
        : `Result does not match expected`,
      expected,
      actual: result,
    };
  }

  function reset(): void {
    scriptedOutcomes = [];
    namedOutcomes.clear();
    invocationIndex = 0;
    invocations = [];
  }

  return {
    script,
    scriptStep,
    run,
    runWithInput,
    getInvocations,
    assertSteps,
    assertStepCalled,
    assertStepNotCalled,
    assertResult,
    reset,
  };
}

// =============================================================================
// Mock Factories
// =============================================================================

/**
 * Create a mock Result-returning function.
 *
 * @example
 * ```typescript
 * const fetchUser = createMockFn<User, 'NOT_FOUND'>();
 *
 * fetchUser.returns(ok({ id: '1', name: 'Alice' }));
 * // or
 * fetchUser.returnsOnce(ok({ id: '1', name: 'Alice' }));
 * fetchUser.returnsOnce(err('NOT_FOUND'));
 * ```
 */
export function createMockFn<T, E>(): MockFunction<T, E> {
  let defaultReturn: Result<T, E> | undefined;
  const returnQueue: Result<T, E>[] = [];
  const calls: unknown[][] = [];

  const fn = ((...args: unknown[]) => {
    calls.push(args);

    if (returnQueue.length > 0) {
      return Promise.resolve(returnQueue.shift()!);
    }

    if (defaultReturn) {
      return Promise.resolve(defaultReturn);
    }

    throw new Error("Mock function called without configured return value");
  }) as MockFunction<T, E>;

  fn.returns = (result: Result<T, E>) => {
    defaultReturn = result;
    return fn;
  };

  fn.returnsOnce = (result: Result<T, E>) => {
    returnQueue.push(result);
    return fn;
  };

  fn.getCalls = () => [...calls];

  fn.getCallCount = () => calls.length;

  fn.reset = () => {
    defaultReturn = undefined;
    returnQueue.length = 0;
    calls.length = 0;
  };

  return fn;
}

/**
 * Mock function interface.
 */
export interface MockFunction<T, E> {
  (...args: unknown[]): AsyncResult<T, E>;

  /** Set the default return value */
  returns(result: Result<T, E>): MockFunction<T, E>;

  /** Queue a return value for the next call */
  returnsOnce(result: Result<T, E>): MockFunction<T, E>;

  /** Get all call arguments */
  getCalls(): unknown[][];

  /** Get the number of times the function was called */
  getCallCount(): number;

  /** Reset the mock */
  reset(): void;
}

// =============================================================================
// Snapshot Testing
// =============================================================================

/**
 * Workflow snapshot for comparison.
 */
export interface WorkflowSnapshot {
  /** Step invocations */
  invocations: StepInvocation[];
  /** Final result */
  result: Result<unknown, unknown>;
  /** Events emitted */
  events?: WorkflowEvent<unknown>[];
  /** Total duration */
  durationMs?: number;
}

/**
 * Create a snapshot of a workflow execution.
 */
export function createSnapshot(
  invocations: StepInvocation[],
  result: Result<unknown, unknown>,
  events?: WorkflowEvent<unknown>[]
): WorkflowSnapshot {
  const totalDuration = invocations.reduce(
    (sum, inv) => sum + (inv.durationMs ?? 0),
    0
  );

  return {
    invocations: invocations.map((inv) => ({
      ...inv,
      // Normalize timestamps for comparison
      timestamp: 0,
    })),
    result,
    events: events?.map((e) => ({
      ...e,
      ts: 0, // Normalize timestamps
    })),
    durationMs: totalDuration,
  };
}

/**
 * Compare two workflow snapshots.
 */
export function compareSnapshots(
  snapshot1: WorkflowSnapshot,
  snapshot2: WorkflowSnapshot
): {
  equal: boolean;
  differences: string[];
} {
  const differences: string[] = [];

  // Compare invocations count
  if (snapshot1.invocations.length !== snapshot2.invocations.length) {
    differences.push(
      `Invocation count: ${snapshot1.invocations.length} vs ${snapshot2.invocations.length}`
    );
  }

  // Compare each invocation
  const maxLen = Math.max(
    snapshot1.invocations.length,
    snapshot2.invocations.length
  );

  for (let i = 0; i < maxLen; i++) {
    const inv1 = snapshot1.invocations[i];
    const inv2 = snapshot2.invocations[i];

    if (!inv1) {
      differences.push(`Step ${i}: missing in first snapshot`);
      continue;
    }

    if (!inv2) {
      differences.push(`Step ${i}: missing in second snapshot`);
      continue;
    }

    if (inv1.name !== inv2.name) {
      differences.push(`Step ${i} name: "${inv1.name}" vs "${inv2.name}"`);
    }

    if (inv1.key !== inv2.key) {
      differences.push(`Step ${i} key: "${inv1.key}" vs "${inv2.key}"`);
    }

    // Compare results
    if (inv1.result?.ok !== inv2.result?.ok) {
      differences.push(
        `Step ${i} result: ${inv1.result?.ok ? "ok" : "err"} vs ${inv2.result?.ok ? "ok" : "err"}`
      );
    }
  }

  // Compare final result
  if (snapshot1.result.ok !== snapshot2.result.ok) {
    differences.push(
      `Final result: ${snapshot1.result.ok ? "ok" : "err"} vs ${snapshot2.result.ok ? "ok" : "err"}`
    );
  }

  return {
    equal: differences.length === 0,
    differences,
  };
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Create a deterministic clock for testing.
 */
export function createTestClock(startTime = 0): {
  now: () => number;
  advance: (ms: number) => void;
  set: (time: number) => void;
  reset: () => void;
} {
  let currentTime = startTime;

  return {
    now: () => currentTime,
    advance: (ms: number) => {
      currentTime += ms;
    },
    set: (time: number) => {
      currentTime = time;
    },
    reset: () => {
      currentTime = startTime;
    },
  };
}

/**
 * Helper to create ok outcomes.
 */
export function okOutcome<T>(value: T): ScriptedOutcome<T, never> {
  return { type: "ok", value };
}

/**
 * Helper to create err outcomes.
 */
export function errOutcome<E>(error: E): ScriptedOutcome<never, E> {
  return { type: "err", error };
}

/**
 * Helper to create throw outcomes.
 */
export function throwOutcome(error: unknown): ScriptedOutcome<never, never> {
  return { type: "throw", error };
}
