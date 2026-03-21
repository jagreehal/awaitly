/**
 * Markdown Renderer for Workflow Diff
 *
 * Produces a human-readable markdown report from a WorkflowDiff.
 * Sections with zero entries are omitted.
 */

import type { WorkflowDiff, DiffMarkdownOptions, StepDiffEntry } from "./types";

export function renderDiffMarkdown(
  diff: WorkflowDiff,
  options?: DiffMarkdownOptions
): string {
  const showUnchanged = options?.showUnchanged ?? true;
  const title =
    options?.title ?? `Workflow Diff: ${diff.beforeName} → ${diff.afterName}`;

  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push("");

  lines.push("## Summary");
  lines.push(
    `- ${diff.summary.stepsAdded} added, ${diff.summary.stepsRemoved} removed, ${diff.summary.stepsRenamed} renamed, ${diff.summary.stepsMoved} moved, ${diff.summary.stepsUnchanged} unchanged`
  );
  if (diff.summary.structuralChanges > 0) {
    lines.push(
      `- ${diff.summary.structuralChanges} structural change${diff.summary.structuralChanges !== 1 ? "s" : ""}`
    );
  }
  lines.push("");

  const added = diff.steps.filter((s) => s.kind === "added");
  if (added.length > 0) {
    lines.push("## Added Steps");
    for (const entry of added) {
      lines.push(`- ${formatStepEntry(entry)}`);
    }
    lines.push("");
  }

  const removed = diff.steps.filter((s) => s.kind === "removed");
  if (removed.length > 0) {
    const warning =
      diff.summary.hasRegressions ? "\u26a0\ufe0f " : "";
    lines.push(`## ${warning}Removed Steps`);
    for (const entry of removed) {
      lines.push(`- ${formatStepEntry(entry)}`);
    }
    lines.push("");
  }

  const renamed = diff.steps.filter((s) => s.kind === "renamed");
  if (renamed.length > 0) {
    lines.push("## Renamed Steps");
    for (const entry of renamed) {
      const callee = entry.callee ? ` (${entry.callee})` : "";
      lines.push(
        `- \`${entry.previousStepId}\` → \`${entry.stepId}\`${callee}`
      );
    }
    lines.push("");
  }

  const moved = diff.steps.filter((s) => s.kind === "moved");
  if (moved.length > 0) {
    lines.push("## Moved Steps");
    for (const entry of moved) {
      lines.push(
        `- \`${entry.stepId}\` moved from ${entry.containerBefore ?? "unknown"} → ${entry.containerAfter ?? "unknown"}`
      );
    }
    lines.push("");
  }

  if (diff.structuralChanges.length > 0) {
    lines.push("## Structural Changes");
    for (const change of diff.structuralChanges) {
      const verb = change.kind === "added" ? "Added" : "Removed";
      lines.push(`- ${verb}: ${change.description}`);
    }
    lines.push("");
  }

  if (showUnchanged) {
    const unchanged = diff.steps.filter((s) => s.kind === "unchanged");
    if (unchanged.length > 0) {
      lines.push("## Unchanged Steps");
      for (const entry of unchanged) {
        lines.push(`- ${formatStepEntry(entry)}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function formatStepEntry(entry: StepDiffEntry): string {
  const callee = entry.callee ? ` (${entry.callee})` : "";
  return `\`${entry.stepId}\`${callee}`;
}
