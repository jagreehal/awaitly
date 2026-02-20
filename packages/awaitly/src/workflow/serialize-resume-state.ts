/**
 * Serialization for ResumeState to/from JSON-safe format.
 * Centralizes Map serialization so adapters don't re-implement it.
 */

import type { ResumeState, ResumeStateEntry } from "./types";
import type { StepResult, SerializedCause, JSONValue } from "../persistence";
import { serializeError, serializeThrown, deserializeCauseNew } from "../persistence";
import { ok } from "../core";
import { isCachedErrorCause } from "./cache-encoding";
import { encodeCachedError } from "./cache-encoding";

/**
 * JSON-serializable resume state. Use this shape when persisting to storage.
 * Discriminator `kind: "ResumeState"` enables adapters and migrations to detect format.
 */
export type SerializedResumeState = {
  kind: "ResumeState";
  steps: [string, StepResult][];
};

/**
 * Serialize resume state to a JSON-safe object. Preserves step order (array).
 * Use with JSON.stringify for storage; adapters can rely on this shape.
 *
 * @example
 * const serialized = serializeResumeState(collector.getResumeState());
 * await store.save(id, JSON.stringify(serialized));
 */
export function serializeResumeState(state: ResumeState): SerializedResumeState {
  const steps: [string, StepResult][] = [];
  for (const [key, entry] of state.steps) {
    const stepResult = entryToStepResult(entry);
    steps.push([key, stepResult]);
  }
  return { kind: "ResumeState", steps };
}

/**
 * Type guard for SerializedResumeState. Use when loading from storage to discriminate from WorkflowSnapshot.
 */
export function isSerializedResumeState(x: unknown): x is SerializedResumeState {
  return (
    typeof x === "object" &&
    x !== null &&
    (x as SerializedResumeState).kind === "ResumeState" &&
    Array.isArray((x as SerializedResumeState).steps)
  );
}

/**
 * Deserialize from JSON-parsed object back to ResumeState (runtime Map).
 *
 * @example
 * const parsed = JSON.parse(await store.load(id));
 * if (isSerializedResumeState(parsed)) {
 *   const state = deserializeResumeState(parsed);
 *   await workflow.run(fn, { resumeState: state });
 * }
 */
export function deserializeResumeState(raw: SerializedResumeState): ResumeState {
  const steps = new Map<string, ResumeStateEntry>();
  for (const [key, stepResult] of raw.steps) {
    steps.set(key, stepResultToEntry(stepResult));
  }
  return { steps };
}

function entryToStepResult(entry: ResumeStateEntry): StepResult {
  const { result, meta } = entry;
  if (result.ok) {
    return { ok: true, value: result.value as JSONValue };
  }
  const causeToSerialize = isCachedErrorCause(result.cause)
    ? result.cause.originalCause
    : result.cause;
  const serializedCause: SerializedCause =
    causeToSerialize instanceof Error
      ? serializeError(causeToSerialize)
      : serializeThrown(causeToSerialize);
  const origin: "result" | "throw" =
    meta?.origin === "throw" ? "throw" : "result";
  return {
    ok: false,
    error: result.error as JSONValue,
    cause: serializedCause,
    meta: { origin },
  };
}

function stepResultToEntry(sr: StepResult): ResumeStateEntry {
  if (sr.ok) {
    return { result: ok(sr.value) };
  }
  const deserializedCause = deserializeCauseNew(sr.cause);
  const meta =
    sr.meta?.origin === "throw"
      ? { origin: "throw" as const, thrown: deserializedCause }
      : { origin: "result" as const, resultCause: deserializedCause };
  const errorResult = encodeCachedError(sr.error, meta, deserializedCause);
  return { result: errorResult, meta };
}
