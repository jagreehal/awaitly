/**
 * Path Generator
 *
 * Generates all possible execution paths through a workflow based on
 * static analysis. Each path represents a unique sequence of steps
 * that could execute given certain conditions.
 */

import type {
  StaticWorkflowIR,
  StaticFlowNode,
  WorkflowPath,
  PathStepRef,
  PathCondition,
} from "./types";

// =============================================================================
// Options
// =============================================================================

export interface PathGeneratorOptions {
  /** Maximum paths to generate (default: 1000) */
  maxPaths?: number;
  /** Whether to expand workflow references (default: false) */
  expandWorkflowRefs?: boolean;
  /** Whether to include loop iterations as separate paths (default: false) */
  expandLoops?: boolean;
  /** Maximum loop iterations to expand if expandLoops is true (default: 3) */
  maxLoopIterations?: number;
}

const DEFAULT_OPTIONS: Required<PathGeneratorOptions> = {
  maxPaths: 1000,
  expandWorkflowRefs: false,
  expandLoops: false,
  maxLoopIterations: 3,
};

// =============================================================================
// Path Generation
// =============================================================================

export interface PathGenerationResult {
  /** Generated workflow paths */
  paths: WorkflowPath[];
  /** Whether the maxPaths limit was hit (truncation occurred) */
  limitHit: boolean;
}

/**
 * Generate all possible execution paths through a workflow.
 *
 * @param ir - Static workflow IR
 * @param options - Generation options
 * @returns Array of workflow paths
 */
export function generatePaths(
  ir: StaticWorkflowIR,
  options: PathGeneratorOptions = {}
): WorkflowPath[] {
  return generatePathsWithMetadata(ir, options).paths;
}

/**
 * Generate all possible execution paths through a workflow with metadata.
 *
 * @param ir - Static workflow IR
 * @param options - Generation options
 * @returns Paths and metadata about generation
 */
export function generatePathsWithMetadata(
  ir: StaticWorkflowIR,
  options: PathGeneratorOptions = {}
): PathGenerationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Start path generation from the workflow root
  const context: PathContext = {
    opts,
    pathCount: 0,
    hasHitLimit: false,
  };

  const initialState: PathState = {
    steps: [],
    conditions: [],
    hasLoops: false,
    hasUnresolvedRefs: false,
  };

  const states = generatePathsForNodes(ir.root.children, initialState, context);

  // Convert states to WorkflowPath objects
  const paths = states.map((state, index) => ({
    id: `path-${index + 1}`,
    description: generatePathDescription(state),
    steps: state.steps,
    conditions: state.conditions,
    hasLoops: state.hasLoops,
    hasUnresolvedRefs: state.hasUnresolvedRefs,
  }));

  return {
    paths,
    limitHit: context.hasHitLimit,
  };
}

// =============================================================================
// Internal Types
// =============================================================================

interface PathContext {
  opts: Required<PathGeneratorOptions>;
  pathCount: number;
  hasHitLimit: boolean;
}

interface PathState {
  steps: PathStepRef[];
  conditions: PathCondition[];
  hasLoops: boolean;
  hasUnresolvedRefs: boolean;
}

// =============================================================================
// Path Generation Logic
// =============================================================================

function generatePathsForNodes(
  nodes: StaticFlowNode[],
  currentState: PathState,
  context: PathContext
): PathState[] {
  if (nodes.length === 0) {
    return [currentState];
  }

  let states = [currentState];

  for (const node of nodes) {
    const newStates: PathState[] = [];

    for (const state of states) {
      const nodeStates = generatePathsForNode(node, state, context);
      newStates.push(...nodeStates);
    }

    states = newStates;
  }

  return states;
}

function generatePathsForNode(
  node: StaticFlowNode,
  currentState: PathState,
  context: PathContext
): PathState[] {
  switch (node.type) {
    case "step":
      return handleStepNode(node, currentState);

    case "saga-step":
      return handleSagaStepNode(node, currentState);

    case "sequence":
      return handleSequenceNode(node, currentState, context);

    case "parallel":
      return handleParallelNode(node, currentState, context);

    case "race":
      return handleRaceNode(node, currentState, context);

    case "conditional":
      return handleConditionalNode(node, currentState, context);

    case "switch":
      return handleSwitchNode(node, currentState, context);

    case "loop":
      return handleLoopNode(node, currentState, context);

    case "stream":
      return handleStreamNode(node, currentState);

    case "workflow-ref":
      return handleWorkflowRefNode(node, currentState, context);

    case "unknown":
      return [currentState];

    default:
      return [currentState];
  }
}

// =============================================================================
// Node Handlers
// =============================================================================

function handleStepNode(
  node: StaticFlowNode & { type: "step" },
  currentState: PathState
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    key: node.key,
    name: node.name ?? node.callee,
    repeated: false,
  };

  return [
    {
      ...currentState,
      steps: [...currentState.steps, stepRef],
    },
  ];
}

function handleSagaStepNode(
  node: StaticFlowNode & { type: "saga-step" },
  currentState: PathState
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    key: node.key,
    name: node.name ?? node.callee,
    repeated: false,
  };

  return [
    {
      ...currentState,
      steps: [...currentState.steps, stepRef],
    },
  ];
}

function handleSequenceNode(
  node: StaticFlowNode & { type: "sequence" },
  currentState: PathState,
  context: PathContext
): PathState[] {
  return generatePathsForNodes(node.children, currentState, context);
}

function handleParallelNode(
  node: StaticFlowNode & { type: "parallel" },
  currentState: PathState,
  context: PathContext
): PathState[] {
  // For parallel execution, all children execute
  // We combine all paths from all children
  let combinedStates = [currentState];

  for (const child of node.children) {
    const newCombinedStates: PathState[] = [];

    for (const state of combinedStates) {
      const childStates = generatePathsForNode(child, state, context);

      // Each child state combines with the current combined state
      for (const childState of childStates) {
        newCombinedStates.push({
          steps: childState.steps,
          conditions: childState.conditions,
          hasLoops: state.hasLoops || childState.hasLoops,
          hasUnresolvedRefs: state.hasUnresolvedRefs || childState.hasUnresolvedRefs,
        });
      }
    }

    combinedStates = newCombinedStates;
  }

  return combinedStates;
}

function handleRaceNode(
  node: StaticFlowNode & { type: "race" },
  currentState: PathState,
  context: PathContext
): PathState[] {
  // For race execution, only one child wins
  // We generate a separate path for each possible winner

  if (node.children.length === 0) {
    return [currentState];
  }

  const currentPaths = context.pathCount + 1;
  const atLimit = context.hasHitLimit || currentPaths >= context.opts.maxPaths;
  if (atLimit) {
    context.hasHitLimit = true;
    return generatePathsForNode(node.children[0], currentState, context);
  }

  const pathCountBefore = context.pathCount;
  const maxAllowedPaths = context.opts.maxPaths;

  const allStates: PathState[] = [];

  for (const child of node.children) {
    if (allStates.length >= maxAllowedPaths) {
      context.hasHitLimit = true;
      break;
    }

    const childStates = generatePathsForNode(child, currentState, context);

    const roomLeft = maxAllowedPaths - allStates.length;
    const statesToAdd = childStates.slice(0, roomLeft);
    allStates.push(...statesToAdd);

    if (statesToAdd.length < childStates.length) {
      context.hasHitLimit = true;
    }
  }

  context.pathCount = pathCountBefore + (allStates.length - 1);

  return allStates;
}

function handleConditionalNode(
  node: StaticFlowNode & { type: "conditional" },
  currentState: PathState,
  context: PathContext
): PathState[] {
  const currentPaths = context.pathCount + 1;
  const atLimit = context.hasHitLimit || currentPaths >= context.opts.maxPaths;
  if (atLimit) {
    context.hasHitLimit = true;
  }

  // Path where condition is true (consequent)
  const trueCondition: PathCondition = {
    expression: node.condition,
    mustBe: node.helper === "unless" || node.helper === "unlessOr" ? false : true,
    location: node.location,
  };

  const trueState: PathState = {
    ...currentState,
    conditions: [...currentState.conditions, trueCondition],
  };

  const consequentStates = generatePathsForNodes(
    node.consequent,
    trueState,
    context
  );

  if (atLimit || context.hasHitLimit) {
    return consequentStates;
  }

  const allStates: PathState[] = [...consequentStates];

  // Path where condition is false (alternate or skip)
  const falseCondition: PathCondition = {
    expression: node.condition,
    mustBe: node.helper === "unless" || node.helper === "unlessOr" ? true : false,
    location: node.location,
  };

  const falseState: PathState = {
    ...currentState,
    conditions: [...currentState.conditions, falseCondition],
  };

  if (node.alternate && node.alternate.length > 0) {
    const alternateStates = generatePathsForNodes(
      node.alternate,
      falseState,
      context
    );
    allStates.push(...alternateStates);
  } else {
    // No alternate - just continue with the condition marked false
    allStates.push(falseState);
  }

  context.pathCount += allStates.length - 1;
  if (context.pathCount + 1 >= context.opts.maxPaths) {
    context.hasHitLimit = true;
  }
  return allStates;
}

function handleSwitchNode(
  node: StaticFlowNode & { type: "switch" },
  currentState: PathState,
  context: PathContext
): PathState[] {
  const allStates: PathState[] = [];

  for (const caseClause of node.cases) {
    const caseCondition: PathCondition = {
      expression: caseClause.isDefault
        ? `${node.expression} === default`
        : `${node.expression} === ${caseClause.value}`,
      mustBe: true,
      location: node.location,
    };

    const caseState: PathState = {
      ...currentState,
      conditions: [...currentState.conditions, caseCondition],
    };

    const caseStates = generatePathsForNodes(caseClause.body, caseState, context);
    allStates.push(...caseStates);

    if (context.hasHitLimit) break;
  }

  return allStates.length > 0 ? allStates : [currentState];
}

function handleLoopNode(
  node: StaticFlowNode & { type: "loop" },
  currentState: PathState,
  context: PathContext
): PathState[] {
  // Mark steps inside loop as repeated
  const loopBodyStates = generatePathsForNodes(
    node.body,
    currentState,
    context
  );

  // Mark all steps in loop body as repeated
  return loopBodyStates.map((state) => ({
    ...state,
    steps: state.steps.map((step, idx) =>
      idx >= currentState.steps.length ? { ...step, repeated: true } : step
    ),
    hasLoops: true,
  }));
}

function handleStreamNode(
  node: StaticFlowNode & { type: "stream" },
  currentState: PathState
): PathState[] {
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: node.namespace ? `stream:${node.namespace}` : `stream:${node.streamType}`,
    repeated: false,
  };

  return [
    {
      ...currentState,
      steps: [...currentState.steps, stepRef],
    },
  ];
}

function handleWorkflowRefNode(
  node: StaticFlowNode & { type: "workflow-ref" },
  currentState: PathState,
  context: PathContext
): PathState[] {
  if (context.opts.expandWorkflowRefs && node.resolved && node.inlinedIR) {
    // Expand the referenced workflow
    return generatePathsForNodes(
      node.inlinedIR.root.children,
      currentState,
      context
    );
  }

  // Add as a single step reference
  const stepRef: PathStepRef = {
    nodeId: node.id,
    name: `[workflow: ${node.workflowName}]`,
    repeated: false,
  };

  return [
    {
      ...currentState,
      steps: [...currentState.steps, stepRef],
      hasUnresolvedRefs: !node.resolved,
    },
  ];
}

// =============================================================================
// Path Description Generation
// =============================================================================

function generatePathDescription(state: PathState): string {
  const parts: string[] = [];

  // Describe the conditions
  if (state.conditions.length > 0) {
    const conditionParts = state.conditions.map((c) => {
      const verb = c.mustBe ? "is true" : "is false";
      // Truncate long conditions
      const expr =
        c.expression.length > 30
          ? c.expression.slice(0, 30) + "..."
          : c.expression;
      return `${expr} ${verb}`;
    });
    parts.push(`When ${conditionParts.join(" AND ")}`);
  }

  // Describe the steps
  const stepNames = state.steps
    .map((s) => {
      const name = s.name ?? s.nodeId;
      return s.repeated ? `${name} (repeated)` : name;
    })
    .join(" → ");

  if (stepNames) {
    parts.push(`Steps: ${stepNames}`);
  }

  // Add markers
  if (state.hasLoops) {
    parts.push("[contains loops]");
  }
  if (state.hasUnresolvedRefs) {
    parts.push("[has unresolved workflow refs]");
  }

  return parts.join(". ") || "Empty path";
}

// =============================================================================
// Path Statistics
// =============================================================================

export interface PathStatistics {
  /** Total number of paths generated */
  totalPaths: number;
  /** Whether the path limit was hit */
  pathLimitHit: boolean;
  /** Number of paths containing loops */
  pathsWithLoops: number;
  /** Number of paths with unresolved workflow refs */
  pathsWithUnresolvedRefs: number;
  /** Unique conditions across all paths */
  uniqueConditions: string[];
  /** Maximum path length (number of steps) */
  maxPathLength: number;
  /** Minimum path length */
  minPathLength: number;
  /** Average path length */
  avgPathLength: number;
}

export interface PathStatisticsOptions {
  /** Whether the path limit was hit during generation (from generatePathsWithMetadata) */
  limitHit?: boolean;
}

/**
 * Calculate statistics about generated paths.
 *
 * @param paths - Generated workflow paths
 * @param options - Options including limitHit from path generation
 */
export function calculatePathStatistics(
  paths: WorkflowPath[],
  options?: PathStatisticsOptions
): PathStatistics {
  if (paths.length === 0) {
    return {
      totalPaths: 0,
      pathLimitHit: false,
      pathsWithLoops: 0,
      pathsWithUnresolvedRefs: 0,
      uniqueConditions: [],
      maxPathLength: 0,
      minPathLength: 0,
      avgPathLength: 0,
    };
  }

  const conditions = new Set<string>();
  let pathsWithLoops = 0;
  let pathsWithUnresolvedRefs = 0;
  let totalLength = 0;
  let maxLength = 0;
  let minLength = Infinity;

  for (const path of paths) {
    if (path.hasLoops) pathsWithLoops++;
    if (path.hasUnresolvedRefs) pathsWithUnresolvedRefs++;

    const length = path.steps.length;
    totalLength += length;
    maxLength = Math.max(maxLength, length);
    minLength = Math.min(minLength, length);

    for (const condition of path.conditions) {
      conditions.add(condition.expression);
    }
  }

  return {
    totalPaths: paths.length,
    pathLimitHit: options?.limitHit ?? false,
    pathsWithLoops,
    pathsWithUnresolvedRefs,
    uniqueConditions: Array.from(conditions),
    maxPathLength: maxLength,
    minPathLength: minLength === Infinity ? 0 : minLength,
    avgPathLength: totalLength / paths.length,
  };
}

// =============================================================================
// Path Filtering
// =============================================================================

/**
 * Filter paths based on criteria.
 */
export function filterPaths(
  paths: WorkflowPath[],
  filter: {
    /** Only include paths that execute this step */
    mustIncludeStep?: string;
    /** Exclude paths that execute this step */
    mustExcludeStep?: string;
    /** Only include paths where this condition is true */
    conditionTrue?: string;
    /** Only include paths where this condition is false */
    conditionFalse?: string;
    /** Only include paths without loops */
    noLoops?: boolean;
    /** Maximum path length */
    maxLength?: number;
  }
): WorkflowPath[] {
  return paths.filter((path) => {
    if (filter.mustIncludeStep) {
      const hasStep = path.steps.some(
        (s) => s.name === filter.mustIncludeStep || s.key === filter.mustIncludeStep
      );
      if (!hasStep) return false;
    }

    if (filter.mustExcludeStep) {
      const hasStep = path.steps.some(
        (s) =>
          s.name === filter.mustExcludeStep || s.key === filter.mustExcludeStep
      );
      if (hasStep) return false;
    }

    if (filter.conditionTrue) {
      const hasCondition = path.conditions.some(
        (c) => c.expression === filter.conditionTrue && c.mustBe === true
      );
      if (!hasCondition) return false;
    }

    if (filter.conditionFalse) {
      const hasCondition = path.conditions.some(
        (c) => c.expression === filter.conditionFalse && c.mustBe === false
      );
      if (!hasCondition) return false;
    }

    if (filter.noLoops && path.hasLoops) {
      return false;
    }

    if (filter.maxLength && path.steps.length > filter.maxLength) {
      return false;
    }

    return true;
  });
}
