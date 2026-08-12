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
  | "unknown-node"
  | "empty-diagram";

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
  /** 0-100: share of flow nodes with no determinism gap (0 when nothing resolved) */
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

  // A workflow that resolved to no flow nodes has no diagram to score. Calling
  // that "fully diagrammable" hands a CI gate a pass on a workflow the analyzer
  // could not read — the failure mode `--assert-diagrammable` exists to catch.
  // Report it as a gap so the gate fails and the reason is visible.
  if (total === 0) {
    return {
      deterministic: false,
      score: 0,
      totalNodes: 0,
      deterministicNodes: 0,
      issues: [
        {
          kind: "empty-diagram",
          message:
            "Workflow resolved to no diagrammable nodes, so there is no diagram to verify.",
          suggestion:
            "Check that the workflow's callback is passed inline to run(); a callback the analyzer cannot resolve produces an empty diagram.",
          nodeId: ir.root.id,
        },
      ],
    };
  }

  const deterministicNodes = total - flagged;
  const score = Math.round((deterministicNodes / total) * 100);

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
      // when / unless / whenOr / unlessOr are first-class analyzable helpers,
      // and a raw if/else whose condition is statically readable gets a
      // derived id that identifies the branch just as stably. Only a raw
      // conditional whose condition the analyzer cannot read — a call result,
      // a computed member — leaves the diagram without a stable label.
      const isRaw = node.helper == null;
      if (isRaw && node.derivedId == null && branchesHaveSteps(node)) {
        issues.push({
          kind: "raw-conditional",
          message:
            "This branch condition is computed at runtime, so the diagram cannot label it deterministically.",
          suggestion:
            "Hoist the condition into a named boolean (`const isPremium = check(user)`) so it reads statically, or label it with step.if('decision-id', () => condition, ...).",
          location: node.location,
          nodeId: node.id,
        });
      }
      break;
    }

    case "loop": {
      if (node.loopType !== "step.forEach") {
        // A native loop over a statically readable iterable gets a derived id,
        // which gives its iterations stable identity. Only an unreadable
        // iterable leaves the diagram unable to name the loop.
        if (node.derivedId == null && loopBodyHasSteps(node)) {
          issues.push({
            kind: "raw-loop",
            message:
              "This loop iterates over a runtime-computed expression, so its iterations have no stable id in the diagram.",
            suggestion:
              "Hoist the iterable into a named variable (`const items = getItems()`) so it reads statically, or use step.forEach('loop-id', items, ...) for bounded, structured iteration.",
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
