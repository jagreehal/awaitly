/**
 * Cache entry encoding for step results.
 * Preserves StepFailureMeta for proper replay. Internal use only.
 */

import { err, type StepFailureMeta, type Err } from "../core";

/**
 * Marker for cached error entries that include step failure metadata.
 * This allows us to preserve origin:"throw" vs origin:"result" when replaying,
 * while also preserving the original cause value for direct cache access.
 * @internal
 */
export interface CachedErrorCause<C = unknown> {
  __cachedMeta: true;
  /** The original cause from the step result (preserved for direct access) */
  originalCause: C;
  /** Metadata for proper replay behavior */
  meta: StepFailureMeta;
}

export function isCachedErrorCause(cause: unknown): cause is CachedErrorCause {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as CachedErrorCause).__cachedMeta === true
  );
}

/**
 * Encode an error result for caching, preserving both the original cause
 * and metadata needed for proper replay.
 */
export function encodeCachedError<E, C>(
  error: E,
  meta: StepFailureMeta,
  originalCause: C
): Err<E, CachedErrorCause<C>> {
  return err(error, {
    cause: { __cachedMeta: true, originalCause, meta } as CachedErrorCause<C>,
  });
}

export function decodeCachedMeta(cause: unknown): StepFailureMeta {
  if (isCachedErrorCause(cause)) {
    return cause.meta;
  }
  // Fallback for any non-encoded cause (shouldn't happen, but safe default)
  return { origin: "result", resultCause: cause };
}
