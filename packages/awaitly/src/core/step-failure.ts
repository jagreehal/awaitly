/**
 * How a step signals failure: timeout errors, and the early exit that carries a
 * failed step out of the workflow callback.
 */

/**
 * Standard timeout error type.
 */
export type StepTimeoutError = {
  type: "STEP_TIMEOUT";
  stepName?: string;
  stepKey?: string;
  timeoutMs: number;
  attempt?: number;
};

/**
 * Symbol used to mark any error (including custom errors) as a timeout error.
 * This allows detection of timeout errors even when users provide custom error payloads.
 */
export const STEP_TIMEOUT_MARKER: unique symbol = Symbol.for("step_timeout_marker");

/**
 * Metadata attached to timeout-marked errors.
 */
export type StepTimeoutMarkerMeta = {
  timeoutMs: number;
  stepName?: string;
  stepKey?: string;
  attempt?: number;
};

/**
 * Type guard to check if an error is a StepTimeoutError.
 * This checks both the standard type field AND the timeout marker symbol,
 * so custom errors provided via timeout.error are also detected.
 */
export function isStepTimeoutError(e: unknown): e is StepTimeoutError {
  if (typeof e !== "object" || e === null) {
    return false;
  }
  if ((e as StepTimeoutError).type === "STEP_TIMEOUT") {
    return true;
  }
  return STEP_TIMEOUT_MARKER in e;
}

/**
 * Get timeout metadata from a timeout error (works with both standard and custom errors).
 * Returns undefined if the error is not a timeout error.
 */
export function getStepTimeoutMeta(e: unknown): StepTimeoutMarkerMeta | undefined {
  if (typeof e !== "object" || e === null) {
    return undefined;
  }
  if ((e as StepTimeoutError).type === "STEP_TIMEOUT") {
    const err = e as StepTimeoutError;
    return {
      timeoutMs: err.timeoutMs,
      stepName: err.stepName,
      stepKey: err.stepKey,
      attempt: err.attempt,
    };
  }
  if (STEP_TIMEOUT_MARKER in e) {
    return (e as Record<symbol, StepTimeoutMarkerMeta>)[STEP_TIMEOUT_MARKER];
  }
  return undefined;
}

/**
 * Symbol used to identify early exit throws.
 * Exported for the caching layer in workflow.ts.
 * @internal
 */
export const EARLY_EXIT_SYMBOL: unique symbol = Symbol("early-exit");

/**
 * Metadata about how a step failed.
 * @internal
 */
export type StepFailureMeta =
  | { origin: "result"; resultCause?: unknown }
  | { origin: "throw"; thrown: unknown }
  | { origin: "fallback"; fallbackUsed: true; fallbackReason: string };

/**
 * Early exit object thrown to short-circuit workflow execution.
 * @internal
 */
export type EarlyExit<E> = {
  [EARLY_EXIT_SYMBOL]: true;
  error: E;
  meta: StepFailureMeta;
};

/**
 * Create an early exit throw object.
 * Used by the caching layer to synthesize early exits for cached errors.
 * @internal
 */
export function createEarlyExit<E>(error: E, meta: StepFailureMeta): EarlyExit<E> {
  return {
    [EARLY_EXIT_SYMBOL]: true,
    error,
    meta,
  };
}

/**
 * Type guard for early exit objects.
 * @internal
 */
export function isEarlyExit<E>(e: unknown): e is EarlyExit<E> {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as Record<PropertyKey, unknown>)[EARLY_EXIT_SYMBOL] === true
  );
}

/** The `cause` a failed step leaves on the run's Result. @internal */
export function causeOf(meta: StepFailureMeta): unknown {
  if (meta.origin === "throw") return meta.thrown;
  return meta.origin === "result" ? meta.resultCause : undefined;
}
