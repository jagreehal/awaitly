/**
 * awaitly/testing
 *
 * Deterministic Workflow Testing Harness.
 * Provides tools for scripting step outcomes and asserting workflow behavior.
 */

import type { Result, AsyncResult, StepOptions, WorkflowEvent, Ok, Err } from "../core";
import { ok, err, isOk } from "../core";
import type { AnyResultFn, ErrorsOfDeps } from "../workflow";

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

  /** Execute with explicit name as first param */
  <T, StepE extends E>(
    name: string,
    operation: () => Result<T, StepE> | AsyncResult<T, StepE>,
    options?: StepOptions
  ): Promise<T>;

  /** Execute with a direct Result */
  <T, StepE extends E>(
    result: Result<T, StepE> | AsyncResult<T, StepE>,
    options?: StepOptions | string
  ): Promise<T>;

  /** step.try for catching throws */
  try: {
    <T, Err extends E>(
      operation: () => T | Promise<T>,
      options: { error: Err; key?: string } | { onError: (cause: unknown) => Err; key?: string }
    ): Promise<T>;
    <T, Err extends E>(
      name: string,
      operation: () => T | Promise<T>,
      options: { error: Err } | { onError: (cause: unknown) => Err }
    ): Promise<T>;
  };
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
    // Overloaded: step(name, operation, options?) or step(operation, options?)
    const mockStep = async <T, StepE extends E>(
      nameOrOperation:
        | string
        | (() => Result<T, StepE> | AsyncResult<T, StepE>)
        | Result<T, StepE>
        | AsyncResult<T, StepE>,
      operationOrOptions?:
        | (() => Result<T, StepE> | AsyncResult<T, StepE>)
        | StepOptions
        | string,
      maybeOptions?: StepOptions
    ): Promise<T> => {
      // Detect overload: step(name, operation, options?) vs step(operation, options?)
      let name: string;
      let operationOrResult:
        | (() => Result<T, StepE> | AsyncResult<T, StepE>)
        | Result<T, StepE>
        | AsyncResult<T, StepE>;
      let opts: StepOptions;

      if (typeof nameOrOperation === "string") {
        // step(name, operation, options?)
        name = nameOrOperation;
        operationOrResult = operationOrOptions as
          | (() => Result<T, StepE> | AsyncResult<T, StepE>)
          | Result<T, StepE>
          | AsyncResult<T, StepE>;
        opts = maybeOptions ?? {};
      } else {
        // step(operation, options?)
        operationOrResult = nameOrOperation;
        if (typeof operationOrOptions === "string") {
          name = operationOrOptions;
          opts = {};
        } else {
          opts = (operationOrOptions as StepOptions) ?? {};
          name = opts.key ?? "step";
        }
      }

      const startTime = clock();

      // Record invocation
      const invocation: StepInvocation = {
        name,
        key: opts.key,
        order: invocations.length,
        timestamp: startTime,
      };

      if (recordInvocations) {
        invocations.push(invocation);
      }

      // Get scripted outcome
      const outcome = getNextOutcome(name);

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

    // Overloaded: step.try(name, operation, opts) or step.try(operation, opts)
    mockStep.try = async <T, Err extends E>(
      nameOrOperation: string | (() => T | Promise<T>),
      operationOrOpts:
        | (() => T | Promise<T>)
        | { error: Err; key?: string }
        | { onError: (cause: unknown) => Err; key?: string },
      maybeOpts?: { error: Err } | { onError: (cause: unknown) => Err }
    ): Promise<T> => {
      // Detect overload: step.try(name, operation, opts) vs step.try(operation, opts)
      let name: string;
      let operation: () => T | Promise<T>;
      let opts: { error: Err; key?: string } | { onError: (cause: unknown) => Err; key?: string };

      if (typeof nameOrOperation === "string") {
        // step.try(name, operation, opts)
        name = nameOrOperation;
        operation = operationOrOpts as () => T | Promise<T>;
        opts = maybeOpts as typeof opts;
      } else {
        // step.try(operation, opts)
        operation = nameOrOperation;
        opts = operationOrOpts as typeof opts;
        name = opts.key ?? "step";
      }

      const startTime = clock();

      const invocation: StepInvocation = {
        name,
        key: "key" in opts ? opts.key : undefined,
        order: invocations.length,
        timestamp: startTime,
      };

      if (recordInvocations) {
        invocations.push(invocation);
      }

      // Get scripted outcome
      const outcome = getNextOutcome(name);

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

// =============================================================================
// Saga Testing Harness
// =============================================================================

/**
 * Compensation invocation record.
 */
export interface CompensationInvocation {
  /** Step name that was compensated (if provided) */
  stepName?: string;
  /** Order in which compensation ran (0 = first) */
  order: number;
  /** The value passed to the compensation function */
  value: unknown;
  /** Timestamp when compensation was invoked */
  timestamp: number;
}

/**
 * Saga test harness interface.
 */
export interface SagaHarness<E, Deps> extends WorkflowHarness<E, Deps> {
  /**
   * Get the recorded compensation invocations (in execution order).
   */
  getCompensations(): CompensationInvocation[];

  /**
   * Assert that compensations ran in the expected order (LIFO).
   */
  assertCompensationOrder(expectedStepNames: string[]): AssertionResult;

  /**
   * Assert that a specific step was compensated.
   */
  assertCompensated(stepName: string): AssertionResult;

  /**
   * Assert that a step was NOT compensated.
   */
  assertNotCompensated(stepName: string): AssertionResult;

  /**
   * Run a saga workflow with compensation tracking.
   */
  runSaga<T>(
    fn: (
      saga: MockSagaContext<E>,
      deps: Deps
    ) => Promise<T>
  ): Promise<Result<T, E | unknown>>;
}

/**
 * Mock saga context for testing.
 */
export interface MockSagaContext<E> {
  step: <T, StepE extends E>(
    operation: () => Result<T, StepE> | AsyncResult<T, StepE>,
    options: SagaStepOptions<T>
  ) => Promise<T>;
}

/**
 * Saga step options with compensation.
 */
export interface SagaStepOptions<T> {
  compensate?: (value: T) => void | Promise<void>;
}

/**
 * Create a test harness for saga workflows.
 *
 * @example
 * ```typescript
 * const harness = createSagaHarness({ chargePayment, refundPayment, reserveInventory, releaseInventory });
 *
 * harness.script([
 *   okOutcome({ id: 'pay_1', amount: 100 }),        // chargePayment succeeds
 *   errOutcome('OUT_OF_STOCK'),                      // reserveInventory fails
 * ]);
 *
 * const result = await harness.runSaga(async (saga, deps) => {
 *   const payment = await saga.step(
 *     () => deps.chargePayment({ amount: 100 }),
 *     { name: 'charge-payment', compensate: (p) => deps.refundPayment({ id: p.id }) }
 *   );
 *
 *   const reservation = await saga.step(
 *     () => deps.reserveInventory({ items: [] }),
 *     { name: 'reserve-inventory', compensate: (r) => deps.releaseInventory({ id: r.id }) }
 *   );
 *
 *   return { payment, reservation };
 * });
 *
 * // Assert compensation ran (LIFO order)
 * harness.assertCompensationOrder(['charge-payment']);
 * harness.assertCompensated('charge-payment');
 * harness.assertNotCompensated('reserve-inventory'); // Failed step isn't compensated
 * ```
 */
export function createSagaHarness<
  Deps extends Record<string, AnyResultFn>
>(
  deps: Deps,
  options: TestHarnessOptions = {}
): SagaHarness<ErrorsOfDeps<Deps>, Deps> {
  type E = ErrorsOfDeps<Deps>;

  const { clock = Date.now } = options;

  // Reuse the workflow harness for basic functionality
  const baseHarness = createWorkflowHarness(deps, options);

  // Track compensations
  let compensations: CompensationInvocation[] = [];
  let compensationStack: Array<{ name?: string; value: unknown; compensate: (value: unknown) => void | Promise<void> }> = [];

  async function runSaga<T>(
    fn: (saga: MockSagaContext<E>, deps: Deps) => Promise<T>
  ): Promise<Result<T, E | unknown>> {
    // Reset compensation tracking
    compensations = [];
    compensationStack = [];

    const sagaContext: MockSagaContext<E> = {
      step: async <StepT, StepE extends E>(
        operation: () => Result<StepT, StepE> | AsyncResult<StepT, StepE>,
        stepOptions?: SagaStepOptions<StepT>
      ): Promise<StepT> => {
        // Use the base harness step mechanism
        try {
          const result = await (baseHarness as unknown as { run: (fn: (step: MockStep<E>, deps: Deps) => Promise<StepT>) => Promise<Result<StepT, E | unknown>> }).run(
            async (step) => step(operation)
          );

          if (!result.ok) {
            // Step failed - run compensations
            await runCompensations();
            throw { __earlyExit: true, error: result.error };
          }

          // Step succeeded - add to compensation stack if compensation provided
          if (stepOptions?.compensate) {
            compensationStack.push({
              value: result.value,
              compensate: stepOptions.compensate as (value: unknown) => void | Promise<void>,
            });
          }

          return result.value;
        } catch (error) {
          // Re-run compensations if we haven't already
          if (compensationStack.length > 0) {
            await runCompensations();
          }
          throw error;
        }
      },
    };

    async function runCompensations(): Promise<void> {
      // Run compensations in LIFO order
      const toCompensate = [...compensationStack].reverse();
      compensationStack = [];

      for (const { name, value, compensate } of toCompensate) {
        try {
          await compensate(value);
          compensations.push({
            stepName: name,
            order: compensations.length,
            value,
            timestamp: clock(),
          });
        } catch (error) {
          // Log compensation error but continue with remaining compensations
          console.error(`Compensation failed for step "${name}":`, error);
        }
      }
    }

    try {
      const value = await fn(sagaContext, deps);
      return ok(value);
    } catch (error) {
      if (isTestEarlyExit(error)) {
        return err(error.error);
      }
      // Run compensations for unexpected errors
      await runCompensations();
      return err({ type: "UNEXPECTED_ERROR", cause: error });
    }
  }

  function getCompensations(): CompensationInvocation[] {
    return [...compensations];
  }

  function assertCompensationOrder(expectedStepNames: string[]): AssertionResult {
    const actualNames = compensations.map((c) => c.stepName);
    const passed = JSON.stringify(actualNames) === JSON.stringify(expectedStepNames);

    return {
      passed,
      message: passed
        ? `Compensations ran in order: ${expectedStepNames.join(" → ")}`
        : `Expected compensations [${expectedStepNames.join(" → ")}] but got [${actualNames.join(" → ")}]`,
      expected: expectedStepNames,
      actual: actualNames,
    };
  }

  function assertCompensated(stepName: string): AssertionResult {
    const found = compensations.some((c) => c.stepName === stepName);

    return {
      passed: found,
      message: found
        ? `Step "${stepName}" was compensated`
        : `Step "${stepName}" was NOT compensated`,
      expected: stepName,
      actual: found,
    };
  }

  function assertNotCompensated(stepName: string): AssertionResult {
    const found = compensations.some((c) => c.stepName === stepName);

    return {
      passed: !found,
      message: !found
        ? `Step "${stepName}" was correctly NOT compensated`
        : `Step "${stepName}" was compensated but should not have been`,
      expected: "not compensated",
      actual: found ? "compensated" : "not compensated",
    };
  }

  // Reset also clears compensation state
  const originalReset = baseHarness.reset;
  function reset(): void {
    originalReset();
    compensations = [];
    compensationStack = [];
  }

  return {
    ...baseHarness,
    reset,
    getCompensations,
    assertCompensationOrder,
    assertCompensated,
    assertNotCompensated,
    runSaga,
  };
}

// =============================================================================
// Event Assertion Helpers
// =============================================================================

/**
 * Options for event assertions.
 */
export interface EventAssertionOptions {
  /** Whether order matters (if false, allows extra events between expected ones) */
  strict?: boolean;
}

/**
 * Assert that events were emitted in the expected sequence.
 *
 * @example
 * ```typescript
 * const events: WorkflowEvent[] = [];
 * const workflow = createWorkflow({ fetchUser }, { onEvent: (e) => events.push(e) });
 *
 * await workflow(async (step) => step(() => fetchUser('1'), { name: 'fetch-user' }));
 *
 * const result = assertEventSequence(events, [
 *   'workflow_start',
 *   'step_start:fetch-user',
 *   'step_success:fetch-user',
 *   'workflow_end',
 * ]);
 *
 * expect(result.passed).toBe(true);
 * ```
 */
export function assertEventSequence(
  events: WorkflowEvent<unknown>[],
  expectedSequence: string[],
  options: EventAssertionOptions = {}
): AssertionResult {
  const { strict = true } = options;

  // Parse expected sequence into type and optional name
  const expected = expectedSequence.map((s) => {
    const [type, name] = s.split(":");
    return { type, name };
  });

  // Filter events to those matching expected types
  const relevantEvents = strict
    ? events
    : events.filter((e) => expected.some((exp) => e.type === exp.type));

  // Build actual sequence for comparison
  const actual: string[] = relevantEvents.map((e) => {
    const name = "name" in e ? (e as { name?: string }).name : undefined;
    const stepKey = "stepKey" in e ? (e as { stepKey?: string }).stepKey : undefined;
    const identifier = name ?? stepKey;
    return identifier ? `${e.type}:${identifier}` : e.type;
  });

  // Compare sequences
  const passed = JSON.stringify(actual) === JSON.stringify(expectedSequence);

  return {
    passed,
    message: passed
      ? `Event sequence matches: ${expectedSequence.join(" → ")}`
      : `Event sequence mismatch.\nExpected: ${expectedSequence.join(" → ")}\nActual: ${actual.join(" → ")}`,
    expected: expectedSequence,
    actual,
  };
}

/**
 * Assert that a specific event was emitted.
 *
 * @example
 * ```typescript
 * const result = assertEventEmitted(events, {
 *   type: 'step_error',
 *   stepKey: 'payment',
 * });
 * ```
 */
export function assertEventEmitted(
  events: WorkflowEvent<unknown>[],
  expected: Partial<WorkflowEvent<unknown>>
): AssertionResult {
  const found = events.find((e) => {
    return Object.entries(expected).every(([key, value]) => {
      const eventValue = (e as Record<string, unknown>)[key];
      if (typeof value === "object" && value !== null) {
        return JSON.stringify(eventValue) === JSON.stringify(value);
      }
      return eventValue === value;
    });
  });

  return {
    passed: !!found,
    message: found
      ? `Event matching ${JSON.stringify(expected)} was emitted`
      : `No event matching ${JSON.stringify(expected)} was found`,
    expected,
    actual: found ?? "not found",
  };
}

/**
 * Assert that a specific event was NOT emitted.
 */
export function assertEventNotEmitted(
  events: WorkflowEvent<unknown>[],
  expected: Partial<WorkflowEvent<unknown>>
): AssertionResult {
  const result = assertEventEmitted(events, expected);
  return {
    passed: !result.passed,
    message: result.passed
      ? `Event matching ${JSON.stringify(expected)} was found but should not have been`
      : `Correctly, no event matching ${JSON.stringify(expected)} was emitted`,
    expected: "not emitted",
    actual: result.actual,
  };
}

// =============================================================================
// Result Assertions (throw on failure, provide type narrowing)
// =============================================================================

/**
 * Asserts that a Result is Ok and narrows the type.
 * Throws with descriptive error if not ok.
 *
 * @example
 * ```typescript
 * const result = await fetchUser('123');
 * expectOk(result);
 * console.log(result.value.name); // TypeScript knows this exists
 * ```
 */
export function expectOk<T, E, C = unknown>(
  result: Result<T, E, C>
): asserts result is Ok<T> {
  if (!result.ok) {
    throw new Error(
      `Expected Ok result, got Err: ${JSON.stringify(result.error, null, 2)}`
    );
  }
}

/**
 * Asserts that a Result is Err and narrows the type.
 * Throws with descriptive error if not err.
 *
 * @example
 * ```typescript
 * const result = await fetchUser('unknown');
 * expectErr(result);
 * console.log(result.error); // TypeScript knows this exists
 * ```
 */
export function expectErr<T, E, C = unknown>(
  result: Result<T, E, C>
): asserts result is Err<E, C> {
  if (result.ok) {
    throw new Error(
      `Expected Err result, got Ok: ${JSON.stringify(result.value, null, 2)}`
    );
  }
}

/**
 * Asserts Ok and returns the value. Most useful in tests.
 *
 * @example
 * ```typescript
 * const user = unwrapOk(await fetchUser('123'));
 * expect(user.name).toBe('Alice');
 * ```
 */
export function unwrapOk<T, E, C = unknown>(result: Result<T, E, C>): T {
  expectOk(result);
  return result.value;
}

/**
 * Asserts Err and returns the error.
 *
 * @example
 * ```typescript
 * const error = unwrapErr(await fetchUser('unknown'));
 * expect(error).toBe('NOT_FOUND');
 * ```
 */
export function unwrapErr<T, E, C = unknown>(result: Result<T, E, C>): E {
  expectErr(result);
  return result.error;
}

/**
 * Awaits an AsyncResult, asserts Ok, returns the value.
 *
 * @example
 * ```typescript
 * const user = await unwrapOkAsync(fetchUser('123'));
 * expect(user.name).toBe('Alice');
 * ```
 */
export async function unwrapOkAsync<T, E, C = unknown>(
  result: AsyncResult<T, E, C>
): Promise<T> {
  return unwrapOk(await result);
}

/**
 * Awaits an AsyncResult, asserts Err, returns the error.
 *
 * @example
 * ```typescript
 * const error = await unwrapErrAsync(fetchUser('unknown'));
 * expect(error).toBe('NOT_FOUND');
 * ```
 */
export async function unwrapErrAsync<T, E, C = unknown>(
  result: AsyncResult<T, E, C>
): Promise<E> {
  return unwrapErr(await result);
}

// =============================================================================
// Debug Helpers
// =============================================================================

/**
 * Format a Result for debugging/logging.
 *
 * @example
 * ```typescript
 * console.log(formatResult(ok(42)));           // "Ok(42)"
 * console.log(formatResult(err('NOT_FOUND'))); // "Err('NOT_FOUND')"
 * console.log(formatResult(err({ type: 'VALIDATION_ERROR', field: 'email' })));
 * // "Err({ type: 'VALIDATION_ERROR', field: 'email' })"
 * ```
 */
export function formatResult<T, E>(result: Result<T, E>): string {
  if (isOk(result)) {
    return `Ok(${formatValue(result.value)})`;
  }
  return `Err(${formatValue(result.error)})`;
}

/**
 * Format a value for display (handles objects, strings, etc.).
 */
function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `'${value}'`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "function") return `[Function: ${value.name || "anonymous"}]`;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.length <= 3) return `[${value.map(formatValue).join(", ")}]`;
    return `[${value.slice(0, 3).map(formatValue).join(", ")}, ... (${value.length} items)]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";
    if (keys.length <= 4) {
      const entries = keys.map((k) => `${k}: ${formatValue(obj[k])}`).join(", ");
      return `{ ${entries} }`;
    }
    const sample = keys.slice(0, 3).map((k) => `${k}: ${formatValue(obj[k])}`).join(", ");
    return `{ ${sample}, ... (${keys.length} keys) }`;
  }
  return String(value);
}

/**
 * Format a workflow event for debugging.
 */
export function formatEvent(event: WorkflowEvent<unknown>): string {
  const type = event.type;
  const name = "name" in event ? (event as { name?: string }).name : undefined;
  const stepKey = "stepKey" in event ? (event as { stepKey?: string }).stepKey : undefined;
  const identifier = name ?? stepKey;

  if (identifier) {
    return `${type}:${identifier}`;
  }
  return type;
}

/**
 * Format a sequence of events for debugging.
 */
export function formatEvents(events: WorkflowEvent<unknown>[]): string {
  return events.map(formatEvent).join(" → ");
}
