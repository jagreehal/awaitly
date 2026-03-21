/**
 * Auto-detection of optimal diagram type based on workflow structure.
 *
 * Analyzes the IR to determine whether a Mermaid flowchart or Railway diagram
 * best represents the workflow. Hard structural rules take precedence over
 * soft complexity heuristics.
 */

import { calculateComplexity } from "./complexity";
import type { StaticWorkflowIR, StaticFlowNode } from "./types";
import { getStaticChildren } from "./types";

export type DiagramType = "mermaid" | "railway";

/**
 * Infer the best diagram type for a workflow.
 *
 * Decision order:
 * 1. Hard rules: parallel/race/switch/loop → mermaid (railway can't represent these)
 * 2. Saga detection: saga-step nodes → railway (linear compensation chains)
 * 3. Soft heuristics: low complexity → railway, otherwise mermaid
 */
export function inferBestDiagramType(ir: StaticWorkflowIR): DiagramType {
  const nodes = ir.root.children;

  // Hard rules: structural nodes that railway cannot represent faithfully
  if (hasNodeType(nodes, "parallel")) return "mermaid";
  if (hasNodeType(nodes, "race")) return "mermaid";
  if (hasNodeType(nodes, "switch")) return "mermaid";
  if (hasNodeType(nodes, "loop")) return "mermaid";
  if (hasNodeType(nodes, "conditional")) return "mermaid";
  if (hasNodeType(nodes, "decision")) return "mermaid";

  // Saga workflows are inherently linear with compensation — railway's sweet spot
  if (hasNodeType(nodes, "saga-step")) return "railway";

  // Soft heuristics based on complexity metrics
  const metrics = calculateComplexity(ir);

  if (
    metrics.cyclomaticComplexity <= 3 &&
    metrics.decisionPoints <= 1 &&
    metrics.maxDepth <= 2
  ) {
    return "railway";
  }

  // Default: mermaid flowchart for anything moderately complex
  return "mermaid";
}

/**
 * Recursively check if any node in the tree matches the given type.
 */
function hasNodeType(
  nodes: StaticFlowNode[],
  type: StaticFlowNode["type"]
): boolean {
  for (const node of nodes) {
    if (node.type === type) return true;
    // Recurse into inlined workflow-ref IR (getStaticChildren returns [] for workflow-ref)
    if (node.type === "workflow-ref" && node.inlinedIR) {
      if (hasNodeType(node.inlinedIR.root.children, type)) return true;
    }
    const children = getStaticChildren(node);
    if (children.length > 0 && hasNodeType(children, type)) return true;
  }
  return false;
}
