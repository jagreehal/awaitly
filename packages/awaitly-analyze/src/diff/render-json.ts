/**
 * JSON Renderer for Workflow Diff
 *
 * Serializes a WorkflowDiff to JSON format.
 */

import type { WorkflowDiff } from "./types";

export function renderDiffJSON(
  diff: WorkflowDiff,
  options?: { pretty?: boolean }
): string {
  const pretty = options?.pretty ?? true;

  return pretty
    ? JSON.stringify(diff, null, 2)
    : JSON.stringify(diff);
}
