/**
 * Complexity Metrics Calculator
 *
 * Calculates various complexity metrics for workflows including:
 * - Cyclomatic complexity (McCabe)
 * - Cognitive complexity (Sonar-style)
 * - Path count
 * - Depth and breadth metrics
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  ComplexityMetrics,
  ComplexityThresholds,
} from "./types";

// =============================================================================
// Default Thresholds
// =============================================================================

export const DEFAULT_THRESHOLDS: ComplexityThresholds = {
  cyclomaticWarning: 10,
  cyclomaticError: 20,
  pathCountWarning: 50,
  maxDepthWarning: 5,
};

// =============================================================================
// Main Complexity Calculator
// =============================================================================

/**
 * Calculate complexity metrics for a workflow.
 *
 * @param ir - Static workflow IR
 * @returns Complexity metrics
 */
export function calculateComplexity(ir: StaticWorkflowIR): ComplexityMetrics {
  const nodes = ir.root.children;

  const cyclomatic = calculateCyclomaticComplexity(nodes);
  const cognitive = calculateCognitiveComplexity(nodes);
  const pathCount = calculatePathCount(nodes);
  const maxDepth = calculateMaxDepth(nodes);
  const maxParallelBreadth = calculateMaxParallelBreadth(nodes);
  const decisionPoints = countDecisionPoints(nodes);

  return {
    cyclomaticComplexity: cyclomatic,
    cognitiveComplexity: cognitive,
    pathCount,
    maxDepth,
    maxParallelBreadth,
    decisionPoints,
  };
}

// =============================================================================
// Cyclomatic Complexity
// =============================================================================

/**
 * Calculate McCabe's cyclomatic complexity.
 *
 * Cyclomatic complexity = E - N + 2P
 * Where:
 * - E = number of edges in the control flow graph
 * - N = number of nodes in the control flow graph
 * - P = number of connected components (usually 1 for a single workflow)
 *
 * Simplified: CC = 1 + number of decision points
 */
function calculateCyclomaticComplexity(nodes: StaticFlowNode[]): number {
  let complexity = 1; // Base complexity

  for (const node of nodes) {
    complexity += countDecisionPointsInNode(node);
  }

  return complexity;
}

function countDecisionPointsInNode(node: StaticFlowNode): number {
  let count = 0;

  switch (node.type) {
    case "conditional":
    case "decision":
      // Each conditional/decision adds a decision point
      count += 1;
      // Count decision points in branches
      for (const child of node.consequent) {
        count += countDecisionPointsInNode(child);
      }
      if (node.alternate) {
        for (const child of node.alternate) {
          count += countDecisionPointsInNode(child);
        }
      }
      break;

    case "switch":
      // Each case adds a decision point
      count += node.cases.length;
      for (const caseClause of node.cases) {
        for (const child of caseClause.body) {
          count += countDecisionPointsInNode(child);
        }
      }
      break;

    case "race":
      // Race adds n-1 decision points (one for each branch except first)
      count += Math.max(0, node.children.length - 1);
      for (const child of node.children) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case "loop":
      // Loops add a decision point (continue or exit)
      count += 1;
      for (const child of node.body) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case "sequence":
    case "parallel":
      for (const child of node.children) {
        count += countDecisionPointsInNode(child);
      }
      break;

    case "workflow-ref":
      if (node.inlinedIR) {
        for (const child of node.inlinedIR.root.children) {
          count += countDecisionPointsInNode(child);
        }
      }
      break;

    case "step":
    case "saga-step":
    case "stream":
    case "unknown":
      // No decision points
      break;
  }

  return count;
}

// =============================================================================
// Cognitive Complexity
// =============================================================================

/**
 * Calculate cognitive complexity (Sonar-style).
 *
 * Cognitive complexity accounts for:
 * - Nesting depth (harder to understand)
 * - Break in linear flow (conditionals, loops, etc.)
 * - Additional complexity for certain constructs
 */
function calculateCognitiveComplexity(nodes: StaticFlowNode[]): number {
  return calculateCognitiveForNodes(nodes, 0);
}

function calculateCognitiveForNodes(
  nodes: StaticFlowNode[],
  nestingDepth: number
): number {
  let complexity = 0;

  for (const node of nodes) {
    complexity += calculateCognitiveForNode(node, nestingDepth);
  }

  return complexity;
}

function calculateCognitiveForNode(
  node: StaticFlowNode,
  nestingDepth: number
): number {
  let complexity = 0;

  switch (node.type) {
    case "conditional":
    case "decision":
      // +1 for the conditional/decision, plus nesting penalty
      complexity += 1 + nestingDepth;
      // Process branches at increased nesting
      complexity += calculateCognitiveForNodes(
        node.consequent,
        nestingDepth + 1
      );
      if (node.alternate) {
        // else branch adds +1
        complexity += 1;
        complexity += calculateCognitiveForNodes(
          node.alternate,
          nestingDepth + 1
        );
      }
      break;

    case "switch":
      // +1 for the switch, plus nesting penalty
      complexity += 1 + nestingDepth;
      for (const caseClause of node.cases) {
        complexity += calculateCognitiveForNodes(
          caseClause.body,
          nestingDepth + 1
        );
      }
      break;

    case "loop":
      // +1 for the loop, plus nesting penalty
      complexity += 1 + nestingDepth;
      complexity += calculateCognitiveForNodes(node.body, nestingDepth + 1);
      break;

    case "race":
      // Race is complex - each branch is a potential path
      complexity += node.children.length;
      for (const child of node.children) {
        complexity += calculateCognitiveForNode(child, nestingDepth + 1);
      }
      break;

    case "parallel":
      // Parallel adds complexity proportional to branches
      complexity += Math.max(0, node.children.length - 1);
      for (const child of node.children) {
        complexity += calculateCognitiveForNode(child, nestingDepth);
      }
      break;

    case "sequence":
      for (const child of node.children) {
        complexity += calculateCognitiveForNode(child, nestingDepth);
      }
      break;

    case "workflow-ref":
      // Referenced workflows add some cognitive load
      complexity += 1;
      if (node.inlinedIR) {
        complexity += calculateCognitiveForNodes(
          node.inlinedIR.root.children,
          nestingDepth + 1
        );
      }
      break;

    case "step":
    case "saga-step":
    case "stream":
    case "unknown":
      // Steps don't add cognitive complexity
      break;
  }

  return complexity;
}

// =============================================================================
// Path Count
// =============================================================================

/**
 * Calculate the total number of unique paths through the workflow.
 * Returns "unbounded" if there are loops (infinite paths possible).
 */
function calculatePathCount(nodes: StaticFlowNode[]): number | "unbounded" {
  let pathCount = 1;
  let hasLoop = false;

  for (const node of nodes) {
    const result = pathCountForNode(node);
    if (result === "unbounded") {
      hasLoop = true;
    } else {
      pathCount *= result;
    }
  }

  return hasLoop ? "unbounded" : pathCount;
}

function pathCountForNode(node: StaticFlowNode): number | "unbounded" {
  switch (node.type) {
    case "conditional":
    case "decision": {
      // Two paths: consequent and alternate
      const consequentPaths = pathCountForNodes(node.consequent);
      const alternatePaths = node.alternate
        ? pathCountForNodes(node.alternate)
        : 1;

      if (consequentPaths === "unbounded" || alternatePaths === "unbounded") {
        return "unbounded";
      }
      return consequentPaths + alternatePaths;
    }

    case "switch": {
      // Each case is a separate path
      let total = 0;
      for (const caseClause of node.cases) {
        const casePaths = pathCountForNodes(caseClause.body);
        if (casePaths === "unbounded") return "unbounded";
        total += casePaths;
      }
      return Math.max(1, total);
    }

    case "race": {
      // Each child is a separate path
      let total = 0;
      for (const child of node.children) {
        const childPaths = pathCountForNode(child);
        if (childPaths === "unbounded") return "unbounded";
        total += childPaths;
      }
      return Math.max(1, total);
    }

    case "parallel": {
      // All children execute, paths multiply
      let product = 1;
      for (const child of node.children) {
        const childPaths = pathCountForNode(child);
        if (childPaths === "unbounded") return "unbounded";
        product *= childPaths;
      }
      return product;
    }

    case "loop":
      // Loops create unbounded paths
      return "unbounded";

    case "sequence":
      return pathCountForNodes(node.children);

    case "workflow-ref":
      if (node.inlinedIR) {
        return pathCountForNodes(node.inlinedIR.root.children);
      }
      return 1;

    case "step":
    case "saga-step":
    case "stream":
    case "unknown":
      return 1;
  }
}

function pathCountForNodes(nodes: StaticFlowNode[]): number | "unbounded" {
  let product = 1;
  for (const node of nodes) {
    const paths = pathCountForNode(node);
    if (paths === "unbounded") return "unbounded";
    product *= paths;
  }
  return product;
}

// =============================================================================
// Depth Metrics
// =============================================================================

/**
 * Calculate the maximum nesting depth.
 */
function calculateMaxDepth(nodes: StaticFlowNode[]): number {
  let maxDepth = 0;

  for (const node of nodes) {
    maxDepth = Math.max(maxDepth, depthOfNode(node, 0));
  }

  return maxDepth;
}

function depthOfNode(node: StaticFlowNode, currentDepth: number): number {
  let maxChildDepth = currentDepth;

  switch (node.type) {
    case "conditional":
    case "decision":
      for (const child of node.consequent) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(child, currentDepth + 1)
        );
      }
      if (node.alternate) {
        for (const child of node.alternate) {
          maxChildDepth = Math.max(
            maxChildDepth,
            depthOfNode(child, currentDepth + 1)
          );
        }
      }
      break;

    case "switch":
      for (const caseClause of node.cases) {
        for (const child of caseClause.body) {
          maxChildDepth = Math.max(
            maxChildDepth,
            depthOfNode(child, currentDepth + 1)
          );
        }
      }
      break;

    case "loop":
      for (const child of node.body) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(child, currentDepth + 1)
        );
      }
      break;

    case "parallel":
    case "race":
      for (const child of node.children) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(child, currentDepth + 1)
        );
      }
      break;

    case "sequence":
      for (const child of node.children) {
        maxChildDepth = Math.max(
          maxChildDepth,
          depthOfNode(child, currentDepth)
        );
      }
      break;

    case "workflow-ref":
      if (node.inlinedIR) {
        for (const child of node.inlinedIR.root.children) {
          maxChildDepth = Math.max(
            maxChildDepth,
            depthOfNode(child, currentDepth + 1)
          );
        }
      }
      break;

    case "step":
    case "saga-step":
    case "stream":
    case "unknown":
      break;
  }

  return maxChildDepth;
}

// =============================================================================
// Parallel Breadth
// =============================================================================

/**
 * Calculate the maximum parallel breadth (concurrent operations).
 * Returns 0 if there are no parallel/race operations.
 */
function calculateMaxParallelBreadth(nodes: StaticFlowNode[]): number {
  let maxBreadth = 0;

  for (const node of nodes) {
    maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(node));
  }

  return maxBreadth;
}

function parallelBreadthOfNode(node: StaticFlowNode): number {
  let maxBreadth = 0;

  switch (node.type) {
    case "parallel":
      // This node's breadth is the number of concurrent children
      maxBreadth = node.children.length;
      // Check children for nested parallel
      for (const child of node.children) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      break;

    case "race":
      maxBreadth = node.children.length;
      for (const child of node.children) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      break;

    case "conditional":
    case "decision":
      for (const child of node.consequent) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      if (node.alternate) {
        for (const child of node.alternate) {
          maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
        }
      }
      break;

    case "switch":
      for (const caseClause of node.cases) {
        for (const child of caseClause.body) {
          maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
        }
      }
      break;

    case "loop":
      for (const child of node.body) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      break;

    case "sequence":
      for (const child of node.children) {
        maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
      }
      break;

    case "workflow-ref":
      if (node.inlinedIR) {
        for (const child of node.inlinedIR.root.children) {
          maxBreadth = Math.max(maxBreadth, parallelBreadthOfNode(child));
        }
      }
      break;

    case "step":
    case "saga-step":
    case "stream":
    case "unknown":
      break;
  }

  return maxBreadth;
}

// =============================================================================
// Decision Points
// =============================================================================

/**
 * Count total decision points in the workflow.
 */
function countDecisionPoints(nodes: StaticFlowNode[]): number {
  let count = 0;

  for (const node of nodes) {
    count += countDecisionPointsInNode(node);
  }

  return count;
}

// =============================================================================
// Complexity Assessment
// =============================================================================

export interface ComplexityAssessment {
  /** Overall complexity level */
  level: "low" | "medium" | "high" | "very-high";
  /** Specific warnings */
  warnings: ComplexityWarning[];
  /** Recommendations */
  recommendations: string[];
}

export interface ComplexityWarning {
  type: "cyclomatic" | "cognitive" | "paths" | "depth" | "breadth";
  message: string;
  severity: "warning" | "error";
}

/**
 * Assess workflow complexity and generate recommendations.
 */
export function assessComplexity(
  metrics: ComplexityMetrics,
  thresholds: ComplexityThresholds = DEFAULT_THRESHOLDS
): ComplexityAssessment {
  const warnings: ComplexityWarning[] = [];
  const recommendations: string[] = [];

  // Check cyclomatic complexity
  if (metrics.cyclomaticComplexity >= thresholds.cyclomaticError) {
    warnings.push({
      type: "cyclomatic",
      message: `Cyclomatic complexity (${metrics.cyclomaticComplexity}) exceeds error threshold (${thresholds.cyclomaticError})`,
      severity: "error",
    });
    recommendations.push(
      "Consider breaking this workflow into smaller sub-workflows"
    );
  } else if (metrics.cyclomaticComplexity >= thresholds.cyclomaticWarning) {
    warnings.push({
      type: "cyclomatic",
      message: `Cyclomatic complexity (${metrics.cyclomaticComplexity}) exceeds warning threshold (${thresholds.cyclomaticWarning})`,
      severity: "warning",
    });
    recommendations.push(
      "Consider simplifying conditional logic or extracting sub-workflows"
    );
  }

  // Check path count
  if (metrics.pathCount === "unbounded") {
    warnings.push({
      type: "paths",
      message: "Workflow has unbounded paths due to loops",
      severity: "warning",
    });
    recommendations.push(
      "Ensure loop termination conditions are well-tested"
    );
  } else if (metrics.pathCount >= thresholds.pathCountWarning) {
    warnings.push({
      type: "paths",
      message: `Path count (${metrics.pathCount}) exceeds threshold (${thresholds.pathCountWarning})`,
      severity: "warning",
    });
    recommendations.push(
      "High path count makes exhaustive testing difficult - consider simplifying"
    );
  }

  // Check nesting depth
  if (metrics.maxDepth >= thresholds.maxDepthWarning) {
    warnings.push({
      type: "depth",
      message: `Nesting depth (${metrics.maxDepth}) exceeds threshold (${thresholds.maxDepthWarning})`,
      severity: "warning",
    });
    recommendations.push(
      "Deep nesting reduces readability - consider flattening or extracting functions"
    );
  }

  // Determine overall level
  let level: ComplexityAssessment["level"] = "low";
  const hasError = warnings.some((w) => w.severity === "error");
  const hasWarning = warnings.some((w) => w.severity === "warning");

  if (hasError) {
    level = "very-high";
  } else if (hasWarning) {
    if (warnings.length >= 2) {
      level = "high";
    } else {
      level = "medium";
    }
  }

  return {
    level,
    warnings,
    recommendations,
  };
}

// =============================================================================
// Summary Generation
// =============================================================================

/**
 * Generate a human-readable complexity summary.
 */
export function formatComplexitySummary(
  metrics: ComplexityMetrics,
  assessment: ComplexityAssessment
): string {
  const lines: string[] = [];

  lines.push("## Workflow Complexity Report");
  lines.push("");

  // Level badge
  lines.push(`**Overall Complexity:** ${assessment.level.toUpperCase()}`);
  lines.push("");

  // Metrics table
  lines.push("### Metrics");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Cyclomatic Complexity | ${metrics.cyclomaticComplexity} |`);
  lines.push(`| Cognitive Complexity | ${metrics.cognitiveComplexity} |`);
  lines.push(`| Unique Paths | ${metrics.pathCount} |`);
  lines.push(`| Max Nesting Depth | ${metrics.maxDepth} |`);
  lines.push(`| Max Parallel Breadth | ${metrics.maxParallelBreadth} |`);
  lines.push(`| Decision Points | ${metrics.decisionPoints} |`);
  lines.push("");

  // Warnings
  if (assessment.warnings.length > 0) {
    lines.push("### Warnings");
    lines.push("");
    for (const warning of assessment.warnings) {
      const icon = warning.severity === "error" ? "ERROR" : "WARNING";
      lines.push(`- **${icon}:** ${warning.message}`);
    }
    lines.push("");
  }

  // Recommendations
  if (assessment.recommendations.length > 0) {
    lines.push("### Recommendations");
    lines.push("");
    for (const rec of assessment.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
