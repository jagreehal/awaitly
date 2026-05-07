/**
 * Saga / Compensation Pattern
 *
 * Compensation is a first-class step option on every workflow. Pass `{ compensate }`
 * to any step and the workflow will run compensations in reverse order if anything
 * downstream fails.
 *
 * `createSagaWorkflow` is a thin alias for `createWorkflow` whose result error union
 * also includes `SagaCompensationError` — useful when you know you'll be using
 * compensation and want the type system to remind you.
 *
 * @example
 * ```typescript
 * import { createSagaWorkflow, isSagaCompensationError } from 'awaitly/saga';
 *
 * const checkout = createSagaWorkflow('checkout', {
 *   reserveInventory, releaseInventory,
 *   chargeCard, refundPayment,
 *   sendEmail,
 * });
 *
 * const result = await checkout.run(async ({ step, deps }) => {
 *   const r = await step('reserve', () => deps.reserveInventory(items), {
 *     compensate: (r) => deps.releaseInventory(r.id),
 *   });
 *   const p = await step('charge', () => deps.chargeCard(amount), {
 *     compensate: (p) => deps.refundPayment(p.id),
 *   });
 *   await step('notify', () => deps.sendEmail(userId));
 *   return { r, p };
 * });
 *
 * if (!result.ok && isSagaCompensationError(result.error)) {
 *   // result.error.originalError    — what triggered the rollback
 *   // result.error.compensationErrors — which cleanups failed
 * }
 * ```
 */

import {
  ok,
  err,
  type Result,
  type AsyncResult,
  UnexpectedError,
  isEarlyExit,
  createEarlyExit,
  type EarlyExit,
} from "./core";
import { createWorkflow } from "./workflow/execute";
import type {
  Workflow,
  WorkflowOptions,
  AnyResultFn,
  ErrorsOfDeps,
} from "./workflow/types";

// =============================================================================
// Compensation types
// =============================================================================

/** A compensation action to run on rollback. */
export type CompensationAction<T> = (value: T) => void | Promise<void>;

/** Options for a saga step (kept for back-compat — `compensate` lives on `StepOptions`). */
export interface SagaStepOptions<T> {
  compensate?: CompensationAction<T>;
}

/**
 * @deprecated Use `WorkflowOptions` from `awaitly/workflow`. Kept as an alias for back-compat.
 */
export type SagaWorkflowOptions<E> = {
  onError?: (error: E | UnexpectedError | SagaCompensationError, stepName?: string) => void;
  onEvent?: (event: unknown) => void;
  throwOnCompensationFailure?: boolean;
};

/** Error returned when one or more compensation actions fail. */
export interface SagaCompensationError {
  type: "SAGA_COMPENSATION_ERROR";
  /** The original error that triggered the rollback. */
  originalError: unknown;
  /** Errors from failed compensation actions. */
  compensationErrors: Array<{
    stepName?: string;
    error: unknown;
  }>;
}

/** Type guard for SagaCompensationError. */
export function isSagaCompensationError(
  error: unknown
): error is SagaCompensationError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as SagaCompensationError).type === "SAGA_COMPENSATION_ERROR"
  );
}

// =============================================================================
// SagaWorkflow type — Workflow with SagaCompensationError in the error union
// =============================================================================

/**
 * A `Workflow` whose result error union includes `SagaCompensationError`.
 * Identical to `Workflow` at runtime — only the static type is widened.
 */
export type SagaWorkflow<
  E,
  U = UnexpectedError,
  Deps = unknown,
  C = void
> = Workflow<E | SagaCompensationError, U, Deps, C>;

// =============================================================================
// createSagaWorkflow — thin alias for createWorkflow with widened error union
// =============================================================================

/**
 * Create a workflow that uses compensation. Identical to `createWorkflow` —
 * only the result type is widened to include `SagaCompensationError`.
 *
 * Prefer this when you intend to use `step(..., { compensate })` so the type
 * system reminds you to handle the SAGA_COMPENSATION_ERROR case.
 *
 * @example
 * ```typescript
 * const saga = createSagaWorkflow('checkout', { reserve, release, charge, refund });
 *
 * const result = await saga.run(async ({ step, deps }) => {
 *   const r = await step('reserve', () => deps.reserve(...), {
 *     compensate: (r) => deps.release(r.id),
 *   });
 *   await step('charge', () => deps.charge(...), {
 *     compensate: (p) => deps.refund(p.id),
 *   });
 *   return r;
 * });
 * ```
 */
export function createSagaWorkflow<
  const Deps extends Readonly<Record<string, AnyResultFn>>,
  U = UnexpectedError,
  C = void
>(
  workflowName: string,
  deps: Deps,
  options?: WorkflowOptions<ErrorsOfDeps<Deps>, U, C>
): SagaWorkflow<ErrorsOfDeps<Deps>, U, Deps, C> {
  return createWorkflow(workflowName, deps, options) as unknown as SagaWorkflow<
    ErrorsOfDeps<Deps>,
    U,
    Deps,
    C
  >;
}

// =============================================================================
// runSaga — low-level executor (no deps inference)
// =============================================================================

/** Saga events emitted by `runSaga` for observability. */
export type SagaEvent =
  | { type: "saga_start"; sagaId: string; ts: number }
  | { type: "saga_success"; sagaId: string; ts: number; durationMs: number }
  | { type: "saga_error"; sagaId: string; ts: number; durationMs: number; error: unknown }
  | { type: "saga_compensation_start"; sagaId: string; ts: number; stepCount: number }
  | { type: "saga_compensation_step"; sagaId: string; stepName?: string; ts: number; success: boolean; error?: unknown }
  | { type: "saga_compensation_end"; sagaId: string; ts: number; durationMs: number; success: boolean; failedCount: number };

export type SagaResult<T, E> = Result<T, E | UnexpectedError | SagaCompensationError, unknown>;

/** Saga step function — like RunStep but every step takes an optional compensate. */
export interface SagaStep<E = unknown> {
  <T, StepE extends E, StepC = unknown>(
    name: string,
    operation: () => Result<T, StepE, StepC> | AsyncResult<T, StepE, StepC>,
    options?: SagaStepOptions<T>
  ): Promise<T>;
  try: <T, Err extends E>(
    name: string,
    operation: () => T | Promise<T>,
    options:
      | { error: Err; compensate?: CompensationAction<T> }
      | { onError: (cause: unknown) => Err; compensate?: CompensationAction<T> }
  ) => Promise<T>;
}

interface RecordedCompensation<T = unknown> {
  name: string;
  value: T;
  compensate: CompensationAction<T>;
}

/**
 * Run a saga with explicit error typing — for cases where you don't have a
 * deps object to infer errors from. Most users should reach for
 * `createSagaWorkflow` (or just `createWorkflow` with `step({ compensate })`).
 */
export async function runSaga<T, E>(
  fn: (context: { step: SagaStep<E> }) => Promise<T>,
  options?: {
    onError?: (error: E | UnexpectedError | SagaCompensationError) => void;
    onEvent?: (event: SagaEvent) => void;
    throwOnCompensationFailure?: boolean;
  }
): Promise<SagaResult<T, E>> {
  const sagaId = crypto.randomUUID();
  const startTime = performance.now();
  const compensations: RecordedCompensation[] = [];
  const emit = (e: SagaEvent) => options?.onEvent?.(e);

  emit({ type: "saga_start", sagaId, ts: Date.now() });

  const stepFn = async <V, StepE extends E, StepC = unknown>(
    name: string,
    operation: () => Result<V, StepE, StepC> | AsyncResult<V, StepE, StepC>,
    stepOptions?: SagaStepOptions<V>
  ): Promise<V> => {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(
        "step(name, operation, options?): first argument must be a string."
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
  };

  const stepTry = async <V, Err extends E>(
    name: string,
    operation: () => V | Promise<V>,
    opts:
      | { error: Err; compensate?: CompensationAction<V> }
      | { onError: (cause: unknown) => Err; compensate?: CompensationAction<V> }
  ): Promise<V> => {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError(
        "step.try(name, operation, options): first argument must be a string."
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
      throw createEarlyExit(mapped as unknown as E, { origin: "throw", thrown });
    }
  };

  const step: SagaStep<E> = Object.assign(stepFn, { try: stepTry });

  try {
    const value = await fn({ step });
    emit({
      type: "saga_success",
      sagaId,
      ts: Date.now(),
      durationMs: performance.now() - startTime,
    });
    return ok(value);
  } catch (thrown) {
    const durationMs = performance.now() - startTime;
    const originalError = isEarlyExit(thrown)
      ? (thrown as EarlyExit<E>).error
      : thrown;

    emit({ type: "saga_error", sagaId, ts: Date.now(), durationMs, error: originalError });

    emit({
      type: "saga_compensation_start",
      sagaId,
      ts: Date.now(),
      stepCount: compensations.length,
    });
    const compensationStart = performance.now();
    const compensationErrors: Array<{ stepName?: string; error: unknown }> = [];
    for (let i = compensations.length - 1; i >= 0; i--) {
      const comp = compensations[i];
      try {
        await comp.compensate(comp.value);
        emit({
          type: "saga_compensation_step",
          sagaId,
          stepName: comp.name,
          ts: Date.now(),
          success: true,
        });
      } catch (error) {
        compensationErrors.push({ stepName: comp.name, error });
        emit({
          type: "saga_compensation_step",
          sagaId,
          stepName: comp.name,
          ts: Date.now(),
          success: false,
          error,
        });
      }
    }
    emit({
      type: "saga_compensation_end",
      sagaId,
      ts: Date.now(),
      durationMs: performance.now() - compensationStart,
      success: compensationErrors.length === 0,
      failedCount: compensationErrors.length,
    });

    if (compensationErrors.length > 0) {
      const sagaError: SagaCompensationError = {
        type: "SAGA_COMPENSATION_ERROR",
        originalError,
        compensationErrors,
      };
      options?.onError?.(sagaError);
      if (options?.throwOnCompensationFailure) throw sagaError;
      return err(sagaError);
    }

    options?.onError?.(originalError as E);

    if (!isEarlyExit(thrown)) {
      return err(new UnexpectedError({ cause: thrown }));
    }
    return err(originalError as E);
  }
}
