/**
 * Mermaid Renderer for Workflow Diff
 *
 * Generates a Mermaid flowchart from the "after" workflow IR with
 * color-coded diff styling overlaid. Added, removed, renamed, and
 * moved steps are visually distinguished.
 */

import type { StaticWorkflowIR } from "../types";
import { renderStaticMermaid } from "../output/mermaid";
import type { WorkflowDiff, DiffMermaidOptions } from "./types";

const DIFF_STYLE_DEFS = [
  "classDef diffAddedStyle fill:#c8e6c9,stroke:#2e7d32,stroke-width:2px",
  "classDef diffRemovedStyle fill:#ffcdd2,stroke:#c62828,stroke-width:2px,stroke-dasharray:5",
  "classDef diffRenamedStyle fill:#fff3e0,stroke:#e65100,stroke-width:2px",
  "classDef diffMovedStyle fill:#e3f2fd,stroke:#1565c0,stroke-width:2px",
];

/**
 * Render a Mermaid diff diagram.
 *
 * Takes the "after" workflow IR and a WorkflowDiff, renders the base
 * diagram via `renderStaticMermaid`, then post-processes the output
 * to inject diff styling (classDefs and class directives) and ghost
 * nodes for removed steps.
 */
export function renderDiffMermaid(
  after: StaticWorkflowIR,
  diff: WorkflowDiff,
  options?: DiffMermaidOptions
): string {
  const showRemovedSteps = options?.showRemovedSteps ?? true;

  const baseDiagram = renderStaticMermaid(after, {
    direction: options?.direction,
  });

  const lines = baseDiagram.split("\n");
  const stepIdToNodeId = buildStepIdMap(lines);

  const classDirectives: string[] = [];
  for (const entry of diff.steps) {
    if (entry.kind === "unchanged") continue;
    if (entry.kind === "removed") continue;

    const nodeId = stepIdToNodeId.get(entry.stepId);
    if (!nodeId) continue;

    const styleClass = kindToStyleClass(entry.kind);
    if (styleClass) {
      classDirectives.push(`  class ${nodeId} ${styleClass}`);
    }
  }

  const ghostLines: string[] = [];
  if (showRemovedSteps) {
    const removed = diff.steps.filter((s) => s.kind === "removed");
    for (let i = 0; i < removed.length; i++) {
      const entry = removed[i];
      const ghostId = `removed_${i + 1}`;
      ghostLines.push(`  ${ghostId}["\u274c ${entry.stepId}"]`);
      classDirectives.push(`  class ${ghostId} diffRemovedStyle`);
    }
  }

  // Inject diff classDefs before the existing %% Styles marker, or append at end
  const stylesIndex = lines.findIndex((l) => l.trim() === "%% Styles");

  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (i === stylesIndex) {
      result.push("");
      result.push("  %% Diff Styles");
      for (const def of DIFF_STYLE_DEFS) {
        result.push(`  ${def}`);
      }
      result.push("");
    }
    result.push(lines[i]);
  }

  if (stylesIndex === -1) {
    result.push("");
    result.push("  %% Diff Styles");
    for (const def of DIFF_STYLE_DEFS) {
      result.push(`  ${def}`);
    }
  }

  if (ghostLines.length > 0) {
    result.push("");
    result.push("  %% Removed Steps (ghost nodes)");
    for (const line of ghostLines) {
      result.push(line);
    }
  }

  if (classDirectives.length > 0) {
    result.push("");
    result.push("  %% Diff class assignments");
    for (const directive of classDirectives) {
      result.push(directive);
    }
  }

  return result.join("\n");
}

/**
 * Parse rendered Mermaid lines to build a map from workflow stepId
 * to the Mermaid node ID (e.g. "step_3").
 *
 * Each step is rendered as a line like:
 *   step_3["validate-cart: validateCart"]
 *   step_1["fetchUser"]
 *
 * The label starts with the stepId (before any colon or space).
 */
function buildStepIdMap(lines: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const nodePattern = /^\s+((?:saga_)?step_\d+)\["([^"]*)"\]/;

  for (const line of lines) {
    const match = line.match(nodePattern);
    if (!match) continue;

    const [, nodeId, label] = match;
    // stepId is the label text before any colon, parens suffix, or backslash
    const colonIdx = label.indexOf(":");
    const parenIdx = label.indexOf(" (");
    const backslashIdx = label.indexOf("\\");

    let endIdx = label.length;
    if (colonIdx !== -1 && colonIdx < endIdx) endIdx = colonIdx;
    if (parenIdx !== -1 && parenIdx < endIdx) endIdx = parenIdx;
    if (backslashIdx !== -1 && backslashIdx < endIdx) endIdx = backslashIdx;

    const stepId = label.substring(0, endIdx).trim();
    if (stepId) {
      map.set(stepId, nodeId);
    }
  }

  return map;
}

/**
 * Map a diff entry kind to a Mermaid style class name.
 */
function kindToStyleClass(
  kind: "added" | "renamed" | "moved"
): string | null {
  switch (kind) {
    case "added":
      return "diffAddedStyle";
    case "renamed":
      return "diffRenamedStyle";
    case "moved":
      return "diffMovedStyle";
    default:
      return null;
  }
}
