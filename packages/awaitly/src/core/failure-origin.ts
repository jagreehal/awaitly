/**
 * Where a failure came from: what the code threw, or what it returned on
 * purpose. Tracing needs this to export the message and stack of a real throw
 * while keeping the messages of typed errors, which are often built from
 * customer data, out of spans.
 */
import { TaggedError, wrapsThrown } from '../tagged-error';
import { causeOf, isEarlyExit, isStepTimeoutError, type EarlyExit, type StepFailureMeta } from './step-failure';

export type FailedResult = { readonly ok: false; readonly error: unknown; readonly cause?: unknown };

/** How an operation failed: by returning an `err()`, or by throwing. */
export type Failure = { returned: FailedResult } | { threw: unknown };

/** `isEarlyExit` for a value that may be a Proxy: those can throw on any read. */
function isExit(value: unknown): value is EarlyExit<unknown> {
  try {
    return isEarlyExit(value);
  } catch {
    return false;
  }
}

/** The failure itself: a step exits by throwing a wrapper around it. */
export function errorOf(failure: Failure): unknown {
  let error = 'returned' in failure ? failure.returned.error : failure.threw;
  for (let i = 0; i < 4 && isExit(error); i++) error = error.error;
  return error;
}

// =============================================================================
// Notes the engine leaves
// =============================================================================

/**
 * What is behind a Result or early exit whose error a mapper built: a throw
 * (`step.try`, `catchUnexpected`) or a failed Result (`step.fromResult`). Its
 * `cause` alone can't tell them apart. Kept per occurrence: the same error can
 * be thrown in one run and returned in another. Notes are kept by identity, so
 * leaving one can't run user code. An exit is known by its meta, which caches
 * and resume state keep and replay.
 */
type Note = { thrown: unknown } | { remapped: FailedResult } | 'skipped';

/** One per process: each public entry is bundled on its own, and runs nest across them. */
const NOTES = /* @__PURE__ */ Symbol.for('awaitly.failureNotes');
function notes(): WeakMap<object, Note> {
  const shared = globalThis as { [NOTES]?: WeakMap<object, Note> };
  return (shared[NOTES] ??= new WeakMap());
}

function noteOnMeta(meta: StepFailureMeta): Note | undefined {
  return notes().get(meta) ?? (meta.origin === 'throw' ? { thrown: meta.thrown } : undefined);
}

function leave<F extends object>(failure: F, note: Note | undefined): F {
  if (note) notes().set(failure, note);
  return failure;
}

/** `failure` (a Result or an exit's meta) stands for `thrown`. */
export const rememberThrow = <F extends object>(failure: F, thrown: unknown): F => leave(failure, { thrown });

/** `failure` replaces the failed Result `remapped`. */
export const rememberRemap = <F extends object>(remapped: FailedResult, failure: F): F =>
  leave(failure, { remapped });

/** A hook skipped the run: the Error in `failure` is awaitly's own, never thrown. */
export const rememberSkipped = <F extends object>(failure: F): F => leave(failure, 'skipped');

/** Hand what is known about a Result to `to`, the failure that takes its place. */
export const carryOrigin = <F extends object>(from: FailedResult, to: F): F => leave(to, notes().get(from));

/** Hand what is known about an exit to `result`, which it ended in. */
export const exitTo = <F extends object>(exit: EarlyExit<unknown>, result: F): F =>
  leave(result, noteOnMeta(exit.meta));

/** The meta of a step that failed with `result`. */
export const metaOf = (result: FailedResult): StepFailureMeta =>
  carryOrigin<StepFailureMeta>(result, { origin: 'result', resultCause: result.cause });

/** A copy for an event: listeners can change what they receive, and the exit must keep its own. */
export const metaForEvent = (meta: StepFailureMeta): StepFailureMeta => leave({ ...meta }, noteOnMeta(meta));

// =============================================================================
// Errors rebuilt from a snapshot
// =============================================================================

/** A rebuilt Error has lost its class, so nothing can tell whether its message holds fields. */
const RESTORED = /* @__PURE__ */ Symbol.for('awaitly.restoredError');

export function markRestored(error: Error): void {
  Object.defineProperty(error, RESTORED, { value: true });
}

// =============================================================================
// Reading the origin
// =============================================================================

type Origin =
  | { kind: 'skipped'; error: unknown }
  /** `as` is the error awaitly or a mapper put in place of `thrown`. */
  | { kind: 'threw'; thrown: unknown; as: unknown }
  /** Outermost first: what each `step.fromResult` made of the one after it. */
  | { kind: 'returned'; errors: unknown[]; cause?: unknown };

const MAX_REMAPS = 4;

function originOf(failure: Failure, depth = 0): Origin {
  const source = 'returned' in failure ? failure.returned : failure.threw;
  const error = errorOf(failure);
  const returned: Origin = { kind: 'returned', errors: [error] };
  // awaitly throws timeouts, and nested steps exit by throwing: neither is an
  // exception from the code that ran.
  const threw = (thrown: unknown): Origin =>
    isStepTimeoutError(thrown) || isExit(thrown) ? returned : { kind: 'threw', thrown, as: error };

  const exit = isExit(source) ? source : undefined;
  const note = exit
    ? noteOnMeta(exit.meta)
    : typeof source === 'object' && source !== null
      ? notes().get(source)
      : undefined;
  if (note === 'skipped') return { kind: 'skipped', error };
  if (note && 'thrown' in note) return threw(note.thrown);
  if (note) {
    if (depth === MAX_REMAPS) return returned;
    const inner = originOf({ returned: note.remapped }, depth + 1);
    return inner.kind === 'returned' ? { ...inner, errors: [error, ...inner.errors] } : inner;
  }
  if ('threw' in failure && !exit) return threw(error);
  if (wrapsThrown(error)) return { kind: 'threw', thrown: error.cause, as: error };
  return { ...returned, cause: 'returned' in failure ? failure.returned.cause : exit && causeOf(exit.meta) };
}

/**
 * An error whose message is built from its fields, which can hold customer
 * data. A hand-written `type` counts only on an error the code returned: SDK
 * errors (Stripe's, say) have a `type` too, and those are thrown.
 */
function isTypedError(error: Error, returned: boolean): boolean {
  return (
    TaggedError.isTaggedError(error) ||
    RESTORED in error ||
    (returned && typeof (error as { type?: unknown }).type === 'string')
  );
}

/**
 * The Error whose message and stack are safe to export. A typed error or an
 * `UnexpectedError` shows the Error it carries as `cause` and nothing of its
 * own, unless it is an `UnexpectedError` around a value that has no message.
 */
function exportable(error: unknown, returned: readonly unknown[] = [], depth = 0): Error | undefined {
  if (depth > 4 || typeof error !== 'object' || error === null) return undefined;
  const { cause } = error as { cause?: unknown };
  if (error instanceof Error) {
    const hidden = wrapsThrown(error) ? cause instanceof Error : isTypedError(error, returned.includes(error));
    if (!hidden) return error;
  }
  return cause instanceof Error ? exportable(cause, returned, depth + 1) : undefined;
}

export type Explanation = {
  /** Whose message and stack to export. */
  source: Error | undefined;
  /** Something went wrong that the code did not return on purpose. */
  exception: boolean;
  /** The class of what was thrown, for an `UnexpectedError` around it. */
  thrown?: Error;
};

/** Reads the failing error's own fields, so a hostile getter can make it throw. */
export function explain(failure: Failure): Explanation {
  const origin = originOf(failure);
  switch (origin.kind) {
    case 'skipped':
      return { source: exportable(origin.error, [origin.error]), exception: false };
    case 'threw': {
      const { thrown, as } = origin;
      if (thrown instanceof Error) return { source: exportable(thrown), exception: true, thrown };
      // Never a cause the mapper gave its own error: nothing relates it to the throw.
      const ownWrapper = wrapsThrown(as) && as.cause === thrown;
      return { source: ownWrapper ? as : undefined, exception: true };
    }
    case 'returned': {
      const { errors, cause } = origin;
      let source: Error | undefined;
      // What came first says the most. Then the Error given as err(error, { cause }).
      for (const error of [...errors].reverse()) {
        source ??= exportable(error, errors);
        if (cause !== error && cause instanceof Error) source ??= exportable(cause, errors);
      }
      return { source, exception: source !== undefined || errors.some(wrapsThrown) };
    }
  }
}
