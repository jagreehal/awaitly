/**
 * Saga / Compensation Pattern
 *
 * Define compensating actions for steps that need rollback on downstream failures.
 * When a workflow fails after some steps have completed, compensations run in
 * reverse order automatically.
 *
 * @example
 * ```typescript
 * import { createSagaWorkflow, ok, err } from 'awaitly';
 *
 * const checkout = createSagaWorkflow({ reserveInventory, chargeCard, sendEmail });
 *
 * const result = await checkout(async (saga) => {
 *   const reservation = await saga.step(
 *     'reserveInventory',
 *     () => reserveInventory(items),
 *     { compensate: (res) => releaseInventory(res.reservationId) }
 *   );
 *
 *   const payment = await saga.step(
 *     'chargeCard',
 *     () => chargeCard(amount),
 *     { compensate: (p) => refundPayment(p.txId) }
 *   );
 *
 *   await saga.step('sendEmail', () => sendEmail(userId)); // No compensation needed
 *
 *   return { reservation, payment };
 * });
 * // On failure: compensations run in reverse order automatically
 * ```
 */

import {
  ok,
  err,
  type Result,
  type AsyncResult,
  type UnexpectedError,
  isEarlyExit,
  createEarlyExit,
  type EarlyExit,
  type WorkflowEvent,
} from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * A compensation action to run on rollback.
 */
export type CompensationAction<T> = (value: T) => void | Promise<void>;

/**
 * Options for a saga step.
 */
export interface SagaStepOptions<T> {
  /**
   * Compensation action to run if a later step fails.
   * Receives the value returned by this step.
   */
  compensate?: CompensationAction<T>;
}

/**
 * A recorded compensation with its value.
 */
interface RecordedCompensation<T = unknown> {
  name?: string;
  value: T;
  compensate: CompensationAction<T>;
}

/**
 * Error returned when compensation actions fail.
 */
export interface SagaCompensationError {
  type: "SAGA_COMPENSATION_ERROR";
  /** The original error that triggered the saga rollback */
  originalError: unknown;
  /** Errors from failed compensation actions */
  compensationErrors: Array<{
    stepName?: string;
    error: unknown;
  }>;
}

/**
 * Type guard for SagaCompensationError.
 */
export function isSagaCompensationError(
  error: unknown
): error is SagaCompensationError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as SagaCompensationError).type === "SAGA_COMPENSATION_ERROR"
  );
}

/**
 * Saga execution context provided to the workflow callback.
 */
export interface SagaContext<E = unknown> {
  /**
   * Execute a step with optional compensation.
   * Name is required as the first argument (consistent with other step APIs).
   *
   * @param name - Step name (for observability and compensation tracking)
   * @param operation - The operation to execute (returns Result)
   * @param options - Step options including compensation action
   * @returns The unwrapped success value
   */
  step: <T, StepE extends E, StepC = unknown>(
    name: string,
    operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
    options?: SagaStepOptions<T>
  ) => Promise<T>;

  /**
   * Execute a throwing operation with optional compensation.
   * Name is required as the first argument.
   *
   * @param name - Step name (for observability and compensation tracking)
   * @param operation - The operation to execute (may throw)
   * @param options - Step options including error mapping and compensation
   * @returns The success value
   */
  tryStep: <T, Err extends E>(
    name: string,
    operation: () => T | Promise<T>,
    options:
      | {
          error: Err;
          compensate?: CompensationAction<T>;
        }
      | {
          onError: (cause: unknown) => Err;
          compensate?: CompensationAction<T>;
        }
  ) => Promise<T>;

  /**
   * Get all recorded compensations (for debugging/testing).
   */
  getCompensations: () => Array<{ name?: string; hasValue: boolean }>;
}

/**
 * Saga event types for observability.
 */
export type SagaEvent =
  | { type: "saga_start"; sagaId: string; ts: number }
  | { type: "saga_success"; sagaId: string; ts: number; durationMs: number }
  | { type: "saga_error"; sagaId: string; ts: number; durationMs: number; error: unknown }
  | { type: "saga_compensation_start"; sagaId: string; ts: number; stepCount: number }
  | { type: "saga_compensation_step"; sagaId: string; stepName?: string; ts: number; success: boolean; error?: unknown }
  | { type: "saga_compensation_end"; sagaId: string; ts: number; durationMs: number; success: boolean; failedCount: number };

/**
 * Options for createSagaWorkflow.
 */
export interface SagaWorkflowOptions<E> {
  /**
   * Called when errors occur.
   */
  onError?: (error: E | UnexpectedError | SagaCompensationError, stepName?: string) => void;

  /**
   * Event stream for saga lifecycle events.
   */
  onEvent?: (event: SagaEvent | WorkflowEvent<E | UnexpectedError>) => void;

  /**
   * Whether to throw if compensation actions fail.
   * If false, original error is returned with compensation errors attached.
   * @default false
   */
  throwOnCompensationFailure?: boolean;
}

/**
 * Result type for saga workflow.
 */
export type SagaResult<T, E> = Result<T, E | UnexpectedError | SagaCompensationError, unknown>;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Helper type for Result-returning functions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResultFn = (...args: any[]) => Result<any, any, any> | Promise<Result<any, any, any>>;

/**
 * Extract union of error types from a deps object.
 */
type ErrorsOfDeps<Deps extends Record<string, AnyResultFn>> = {
  [K in keyof Deps]: Deps[K] extends (...args: never[]) => infer R
    ? R extends Promise<infer PR>
      ? PR extends { ok: false; error: infer E }
        ? E
        : never
      : R extends { ok: false; error: infer E }
        ? E
        : never
    : never;
}[keyof Deps];

/**
 * Create a saga workflow with automatic compensation on failure.
 *
 * @param deps - Object mapping names to Result-returning functions
 * @param options - Saga workflow options
 * @returns A saga executor function
 *
 * @example
 * ```typescript
 * const saga = createSagaWorkflow({ reserveInventory, chargeCard });
 *
 * const result = await saga(async (ctx) => {
 *   const reservation = await ctx.step(
 *     'reserveInventory',
 *     () => reserveInventory(items),
 *     { compensate: (res) => releaseInventory(res.id) }
 *   );
 *
 *   const payment = await ctx.step(
 *     'chargeCard',
 *     () => chargeCard(amount),
 *     { compensate: (p) => refundPayment(p.txId) }
 *   );
 *
 *   return { reservation, payment };
 * });
 * ```
 */
export function createSagaWorkflow<
  const Deps extends Readonly<Record<string, AnyResultFn>>
>(
  deps: Deps,
  options?: SagaWorkflowOptions<ErrorsOfDeps<Deps>>
): <T>(
  fn: (saga: SagaContext<ErrorsOfDeps<Deps>>, deps: Deps) => Promise<T>
) => Promise<SagaResult<T, ErrorsOfDeps<Deps>>> {
  type E = ErrorsOfDeps<Deps>;

  return async <T>(
    fn: (saga: SagaContext<E>, deps: Deps) => Promise<T>
  ): Promise<SagaResult<T, E | UnexpectedError | SagaCompensationError>> => {
    const sagaId = crypto.randomUUID();
    const startTime = performance.now();
    const compensations: RecordedCompensation[] = [];

    const emitEvent = (event: SagaEvent | WorkflowEvent<E | UnexpectedError>) => {
      options?.onEvent?.(event);
    };

    emitEvent({
      type: "saga_start",
      sagaId,
      ts: Date.now(),
    });

    /**
     * Run all compensations in reverse order.
     */
    async function runCompensations(
      _originalError: unknown
    ): Promise<Array<{ stepName?: string; error: unknown }>> {
      const errors: Array<{ stepName?: string; error: unknown }> = [];

      emitEvent({
        type: "saga_compensation_start",
        sagaId,
        ts: Date.now(),
        stepCount: compensations.length,
      });

      const compensationStartTime = performance.now();

      // Run compensations in reverse order
      for (let i = compensations.length - 1; i >= 0; i--) {
        const comp = compensations[i];
        try {
          await comp.compensate(comp.value);
          emitEvent({
            type: "saga_compensation_step",
            sagaId,
            stepName: comp.name,
            ts: Date.now(),
            success: true,
          });
        } catch (error) {
          errors.push({ stepName: comp.name, error });
          emitEvent({
            type: "saga_compensation_step",
            sagaId,
            stepName: comp.name,
            ts: Date.now(),
            success: false,
            error,
          });
        }
      }

      emitEvent({
        type: "saga_compensation_end",
        sagaId,
        ts: Date.now(),
        durationMs: performance.now() - compensationStartTime,
        success: errors.length === 0,
        failedCount: errors.length,
      });

      return errors;
    }

    // Create saga context
    const sagaContext: SagaContext<E> = {
      step: async function stepImpl<T, StepE extends E, StepC = unknown>(
        name: string,
        operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
        stepOptions?: SagaStepOptions<T>
      ): Promise<T> {
        if (typeof name !== "string" || name.length === 0) {
          throw new TypeError(
            "saga.step(name, operation, options?): first argument must be a string (step name). Example: saga.step('createOrder', () => deps.createOrder(), { compensate: (o) => deps.cancelOrder(o) })"
          );
        }
        const result = await operation();
        if (result.ok) {
          if (stepOptions?.compensate) {
            compensations.push({
              name,
              value: result.value,
              compensate: stepOptions.compensate as CompensationAction<unknown>,
            });
          }
          return result.value;
        }
        throw createEarlyExit(result.error as unknown as E, {
          origin: "result",
          resultCause: result.cause,
        });
      },

      tryStep: async function tryStepImpl<T, Err extends E>(
        name: string,
        operation: () => T | Promise<T>,
        opts: {
          error: Err;
          compensate?: CompensationAction<T>;
        } | {
          onError: (cause: unknown) => Err;
          compensate?: CompensationAction<T>;
        }
      ): Promise<T> {
        if (typeof name !== "string" || name.length === 0) {
          throw new TypeError(
            "saga.tryStep(name, operation, options): first argument must be a string (step name). Example: saga.tryStep('riskyOp', () => deps.riskyOp(), { error: 'RISKY_FAILED' })"
          );
        }
        const mapToError = "error" in opts ? () => opts.error : opts.onError;
        try {
          const value = await operation();
          if (opts.compensate) {
            compensations.push({
              name,
              value,
              compensate: opts.compensate as CompensationAction<unknown>,
            });
          }
          return value;
        } catch (thrown) {
          const mapped = mapToError(thrown);
          throw createEarlyExit(mapped as unknown as E, {
            origin: "throw",
            thrown,
          });
        }
      },

      getCompensations() {
        return compensations.map((c) => ({
          name: c.name,
          hasValue: c.value !== undefined,
        }));
      },
    };

    try {
      const result = await fn(sagaContext, deps);

      const durationMs = performance.now() - startTime;
      emitEvent({
        type: "saga_success",
        sagaId,
        ts: Date.now(),
        durationMs,
      });

      return ok(result);
    } catch (thrown) {
      const durationMs = performance.now() - startTime;

      // Extract the actual error from early exit
      let originalError: unknown;
      if (isEarlyExit(thrown)) {
        originalError = (thrown as EarlyExit<E>).error;
      } else {
        originalError = thrown;
      }

      emitEvent({
        type: "saga_error",
        sagaId,
        ts: Date.now(),
        durationMs,
        error: originalError,
      });

      // Run compensations
      const compensationErrors = await runCompensations(originalError);

      // Handle compensation failures
      if (compensationErrors.length > 0) {
        const sagaError: SagaCompensationError = {
          type: "SAGA_COMPENSATION_ERROR",
          originalError,
          compensationErrors,
        };

        options?.onError?.(sagaError);

        if (options?.throwOnCompensationFailure) {
          throw sagaError;
        }

        return err(sagaError);
      }

      // Compensation succeeded - return original error
      options?.onError?.(originalError as E);

      // Wrap non-typed errors as UnexpectedError
      if (!isEarlyExit(thrown)) {
        return err({
          type: "UNEXPECTED_ERROR",
          cause: { type: "UNCAUGHT_EXCEPTION", thrown },
        } as UnexpectedError);
      }

      return err(originalError as E);
    }
  };
}

/**
 * Run a saga with explicit compensation registration.
 *
 * Lower-level API for when you don't want automatic error inference
 * from a deps object.
 *
 * @example
 * ```typescript
 * const result = await runSaga<CheckoutResult, CheckoutError>(async (saga) => {
 *   const reservation = await saga.step(
 *     'reserveInventory',
 *     () => reserveInventory(items),
 *     { compensate: (res) => releaseInventory(res.id) }
 *   );
 *   return { reservation };
 * });
 * ```
 */
export async function runSaga<T, E>(
  fn: (saga: SagaContext<E>) => Promise<T>,
  options?: Omit<SagaWorkflowOptions<E>, "onEvent"> & {
    onEvent?: (event: SagaEvent) => void;
  }
): Promise<SagaResult<T, E>> {
  const sagaId = crypto.randomUUID();
  const startTime = performance.now();
  const compensations: RecordedCompensation[] = [];

  const emitEvent = (event: SagaEvent) => {
    options?.onEvent?.(event);
  };

  emitEvent({
    type: "saga_start",
    sagaId,
    ts: Date.now(),
  });

  /**
   * Run all compensations in reverse order.
   */
  async function runCompensations(
    _originalError: unknown
  ): Promise<Array<{ stepName?: string; error: unknown }>> {
    const errors: Array<{ stepName?: string; error: unknown }> = [];

    emitEvent({
      type: "saga_compensation_start",
      sagaId,
      ts: Date.now(),
      stepCount: compensations.length,
    });

    const compensationStartTime = performance.now();

    // Run compensations in reverse order
    for (let i = compensations.length - 1; i >= 0; i--) {
      const comp = compensations[i];
      try {
        await comp.compensate(comp.value);
        emitEvent({
          type: "saga_compensation_step",
          sagaId,
          stepName: comp.name,
          ts: Date.now(),
          success: true,
        });
      } catch (error) {
        errors.push({ stepName: comp.name, error });
        emitEvent({
          type: "saga_compensation_step",
          sagaId,
          stepName: comp.name,
          ts: Date.now(),
          success: false,
          error,
        });
      }
    }

    emitEvent({
      type: "saga_compensation_end",
      sagaId,
      ts: Date.now(),
      durationMs: performance.now() - compensationStartTime,
      success: errors.length === 0,
      failedCount: errors.length,
    });

    return errors;
  }

  // Create saga context
  const sagaContext: SagaContext<E> = {
    step: async function stepImpl<T, StepE extends E, StepC = unknown>(
      name: string,
      operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
      stepOptions?: SagaStepOptions<T>
    ): Promise<T> {
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError(
          "saga.step(name, operation, options?): first argument must be a string (step name). Example: saga.step('createOrder', () => deps.createOrder(), { compensate: (o) => deps.cancelOrder(o) })"
        );
      }
      const result = await operation();
      if (result.ok) {
        if (stepOptions?.compensate) {
          compensations.push({
            name,
            value: result.value,
            compensate: stepOptions.compensate as CompensationAction<unknown>,
          });
        }
        return result.value;
      }
      throw createEarlyExit(result.error as unknown as E, {
        origin: "result",
        resultCause: result.cause,
      });
    },

    tryStep: async function tryStepImpl<T, Err extends E>(
      name: string,
      operation: () => T | Promise<T>,
      opts: {
        error: Err;
        compensate?: CompensationAction<T>;
      } | {
        onError: (cause: unknown) => Err;
        compensate?: CompensationAction<T>;
      }
    ): Promise<T> {
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError(
          "saga.tryStep(name, operation, options): first argument must be a string (step name). Example: saga.tryStep('riskyOp', () => deps.riskyOp(), { error: 'RISKY_FAILED' })"
        );
      }
      const mapToError = "error" in opts ? () => opts.error : opts.onError;
      try {
        const value = await operation();
        if (opts.compensate) {
          compensations.push({
            name,
            value,
            compensate: opts.compensate as CompensationAction<unknown>,
          });
        }
        return value;
      } catch (thrown) {
        const mapped = mapToError(thrown);
        throw createEarlyExit(mapped as unknown as E, {
          origin: "throw",
          thrown,
        });
      }
    },

    getCompensations() {
      return compensations.map((c) => ({
        name: c.name,
        hasValue: c.value !== undefined,
      }));
    },
  };

  try {
    const result = await fn(sagaContext);

    const durationMs = performance.now() - startTime;
    emitEvent({
      type: "saga_success",
      sagaId,
      ts: Date.now(),
      durationMs,
    });

    return ok(result);
  } catch (thrown) {
    const durationMs = performance.now() - startTime;

    let originalError: unknown;
    if (isEarlyExit(thrown)) {
      originalError = (thrown as EarlyExit<E>).error;
    } else {
      originalError = thrown;
    }

    emitEvent({
      type: "saga_error",
      sagaId,
      ts: Date.now(),
      durationMs,
      error: originalError,
    });

    const compensationErrors = await runCompensations(originalError);

    if (compensationErrors.length > 0) {
      const sagaError: SagaCompensationError = {
        type: "SAGA_COMPENSATION_ERROR",
        originalError,
        compensationErrors,
      };

      options?.onError?.(sagaError);

      if (options?.throwOnCompensationFailure) {
        throw sagaError;
      }

      return err(sagaError);
    }

    options?.onError?.(originalError as E);

    if (!isEarlyExit(thrown)) {
      return err({
        type: "UNEXPECTED_ERROR",
        cause: { type: "UNCAUGHT_EXCEPTION", thrown },
      } as UnexpectedError);
    }

    return err(originalError as E);
  }
}
