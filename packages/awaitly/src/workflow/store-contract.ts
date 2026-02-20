/**
 * Extended persistence contract: save/load accept both WorkflowSnapshot and ResumeState.
 * Use type guards (isWorkflowSnapshot, isResumeState, isSerializedResumeState) in adapters.
 * Core persistence.SnapshotStore stays narrow; this module defines the broad contract and helpers.
 */

import type { WorkflowSnapshot } from "../persistence";
import type { ResumeState } from "./types";
import type { SerializedResumeState } from "./serialize-resume-state";
import { isResumeState } from "./guards";

/** What stores persist (JSON/database shape). Use for type discrimination in adapters. */
export type PersistedWorkflowState = WorkflowSnapshot | SerializedResumeState;

/** What save() can accept: snapshot or runtime resume state. Adapters branch with type guards. */
export type StoreSaveInput = WorkflowSnapshot | ResumeState;

/** What load() can return. Use toResumeState() or loadResumeState for type-safe restore. */
export type StoreLoadResult = WorkflowSnapshot | ResumeState | null;

/**
 * Convert a loaded value to ResumeState for workflow.run(fn, { resumeState }).
 * - If loaded is already ResumeState, returns it.
 * - If loaded is null or WorkflowSnapshot, returns undefined (use run(fn, { snapshot }) for snapshots).
 * Two explicit flows: resume from ResumeState vs resume from snapshot; don't pass snapshot to resumeState.
 *
 * @example
 * const loaded = await store.load('wf-123');
 * const resumeState = toResumeState(loaded);
 * if (resumeState) await workflow.run(fn, { resumeState });
 */
export function toResumeState(loaded: StoreLoadResult): ResumeState | undefined {
  if (loaded === null) return undefined;
  if (isResumeState(loaded)) return loaded;
  return undefined;
}
