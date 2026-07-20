/**
 * Diagrammability
 *
 * A workflow is "diagrammable" when its diagram is deterministic: every node
 * has a stable identity and every branch/loop uses a first-class awaitly
 * construct the analyzer can render. Control flow with no first-class
 * construct breaks that determinism:
 *
 * - a `<dynamic>` step id (computed or template literal): unstable node identity
 * - a raw `if/else` containing steps: branch has no stable id (use step.if, when, or unless)
 * - a native loop containing steps: unbounded, unstable iteration ids (use step.forEach)
 * - an unbounded loop: path count is unknowable
 * - an `unknown` node: unanalyzable block
 *
 * Each issue names the construct that fixes it, so a failing report is a
 * to-do list for a deterministic diagram.
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  SourceLocation,
} from "./types";
import { getStaticChildren } from "./types";

// =============================================================================
// Types
// =============================================================================

export type DiagrammabilityIssueKind =
  | "dynamic-step-id"
  | "dynamic-decision-id"
  | "raw-conditional"
  | "raw-loop"
  | "unbounded-loop"
  | "unknown-node";

export interface DiagrammabilityIssue {
  /** What kind of determinism gap this is */
  kind: DiagrammabilityIssueKind;
  /** Human-readable description of the gap */
  message: string;
  /** The first-class construct that closes the gap */
  suggestion: string;
  /** Source location of the offending node */
  location?: SourceLocation;
  /** IR node id */
  nodeId: string;
}

export interface DiagrammabilityReport {
  /** True iff the diagram is fully deterministic (no issues) */
  deterministic: boolean;
  /** 0-100: share of flow nodes with no determinism gap (100 when empty) */
  score: number;
  /** Total flow nodes considered */
  totalNodes: number;
  /** Nodes with no determinism gap */
  deterministicNodes: number;
  /** Every determinism gap, each naming the construct that fixes it */
  issues: DiagrammabilityIssue[];
}

// =============================================================================
// Computation
// =============================================================================

/**
 * Compute the diagrammability report for a workflow IR.
 *
 * Walks the whole flow tree (including branch/loop/parallel bodies and inlined
 * workflow references) and collects every node whose shape makes the diagram
 * non-deterministic.
 */
export function computeDiagrammability(
  ir: StaticWorkflowIR
): DiagrammabilityReport {
  const issues: DiagrammabilityIssue[] = [];
  let total = 0;
  let flagged = 0;

  const visit = (nodes: StaticFlowNode[]): void => {
    for (const node of nodes) {
      total++;
      const before = issues.length;
      classify(node, issues);
      if (issues.length > before) flagged++;

      // Recurse into structural children. Inlined workflow refs carry their
      // own IR, so descend into it and score composed workflows as a whole.
      if (node.type === "workflow-ref" && node.inlinedIR) {
        visit(node.inlinedIR.root.children);
      } else {
        const children = getStaticChildren(node);
        if (children.length > 0) visit(children);
      }
    }
  };

  visit(ir.root.children);

  const deterministicNodes = total - flagged;
  const score = total === 0 ? 100 : Math.round((deterministicNodes / total) * 100);

  return {
    deterministic: issues.length === 0,
    score,
    totalNodes: total,
    deterministicNodes,
    issues,
  };
}

/**
 * Flag a single node's determinism gaps (does not recurse).
 */
function classify(node: StaticFlowNode, issues: DiagrammabilityIssue[]): void {
  switch (node.type) {
    case "step": {
      if (node.stepId === "<dynamic>") {
        issues.push({
          kind: "dynamic-step-id",
          message:
            "Step id is computed at runtime, so its diagram node has no stable identity.",
          suggestion:
            "Use a literal step id and move the dynamic part to `key`: step('fetchUser', fn, { key: `user:${id}` }).",
          location: node.location,
          nodeId: node.id,
        });
      }
      break;
    }

    case "decision": {
      if (node.decisionId === "<dynamic>") {
        issues.push({
          kind: "dynamic-decision-id",
          message:
            "step.if decision id is computed at runtime, so the branch has no stable identity.",
          suggestion: "Give step.if a literal decision id as its first argument.",
          location: node.location,
          nodeId: node.id,
        });
      }
      break;
    }

    case "conditional": {
      // when / unless / whenOr / unlessOr are first-class analyzable helpers.
      // A raw if/else (helper == null) that contains steps has no stable branch
      // identity. Steer it onto step.if or a when/unless helper.
      const isRaw = node.helper == null;
      if (isRaw && branchesHaveSteps(node)) {
        issues.push({
          kind: "raw-conditional",
          message:
            "A raw if/else containing steps has no stable branch id, so the diagram cannot label it deterministically.",
          suggestion:
            "Use step.if('decision-id', () => condition, ...) for a labelled branch, or when()/unless() for a guarded step.",
          location: node.location,
          nodeId: node.id,
        });
      }
      break;
    }

    case "loop": {
      if (node.loopType !== "step.forEach") {
        if (loopBodyHasSteps(node)) {
          issues.push({
            kind: "raw-loop",
            message:
              "A native loop containing steps produces unstable, unbounded iteration ids in the diagram.",
            suggestion:
              "Use step.forEach('loop-id', items, { stepIdPattern: 'item-{i}', run: (item) => ... }) for structured iteration.",
            location: node.location,
            nodeId: node.id,
          });
        }
      } else if (!node.boundKnown) {
        issues.push({
          kind: "unbounded-loop",
          message:
            "step.forEach iteration count is not statically known, so the diagram's path count is unbounded.",
          suggestion:
            "Iterate over a statically known collection, or set maxIterations to bound the diagram.",
          location: node.location,
          nodeId: node.id,
        });
      }
      break;
    }

    case "unknown": {
      issues.push({
        kind: "unknown-node",
        message: `Unanalyzable block: ${node.reason}`,
        suggestion:
          "Express this control flow with an awaitly construct (step, step.if, step.forEach, step.all/race) so the analyzer can render it.",
        location: node.location,
        nodeId: node.id,
      });
      break;
    }
  }
}

function branchesHaveSteps(node: {
  consequent: StaticFlowNode[];
  alternate?: StaticFlowNode[];
}): boolean {
  return (
    containsSteps(node.consequent) ||
    (node.alternate != null && containsSteps(node.alternate))
  );
}

function loopBodyHasSteps(node: { body: StaticFlowNode[] }): boolean {
  return containsSteps(node.body);
}

/**
 * Whether a subtree contains any step or saga-step (the thing that makes a
 * branch/loop diagram-relevant).
 */
function containsSteps(nodes: StaticFlowNode[]): boolean {
  for (const node of nodes) {
    if (node.type === "step" || node.type === "saga-step") return true;
    const children = getStaticChildren(node);
    if (children.length > 0 && containsSteps(children)) return true;
  }
  return false;
}

// =============================================================================
// Formatting
// =============================================================================

/**
 * Format a diagrammability report as human-readable text.
 */
export function formatDiagrammability(report: DiagrammabilityReport): string {
  const lines: string[] = [];

  if (report.deterministic) {
    lines.push(`✓ Fully diagrammable (${report.score}/100): deterministic diagram`);
    return lines.join("\n");
  }

  lines.push(
    `✗ Not fully diagrammable (${report.score}/100): ${report.issues.length} determinism gap${report.issues.length === 1 ? "" : "s"}`
  );
  lines.push("");

  for (const issue of report.issues) {
    const loc = issue.location ? `:${issue.location.line}:${issue.location.column}` : "";
    lines.push(`⚠ [${issue.kind}]${loc}`);
    lines.push(`  ${issue.message}`);
    lines.push(`  Fix: ${issue.suggestion}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
