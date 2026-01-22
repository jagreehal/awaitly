/**
 * Static Workflow Analyzer
 *
 * Uses ts-morph to walk the TypeScript AST and extract workflow structure
 * without executing the code. This enables:
 * - Understanding all possible execution paths
 * - Generating test coverage matrices
 * - Creating documentation
 * - Calculating complexity metrics
 */

// Type-only imports - erased at compile time, no runtime dependency
// These provide type checking without creating a runtime dependency on ts-morph
import type { SourceFile, Project, Node } from "ts-morph";
import { loadTsMorph } from "./ts-morph-loader";

import type {
  StaticWorkflowIR,
  StaticWorkflowNode,
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticConditionalNode,
  StaticLoopNode,
  StaticWorkflowRefNode,
  SourceLocation,
  DependencyInfo,
  AnalysisWarning,
  AnalysisStats,
  StaticRetryConfig,
  StaticTimeoutConfig,
} from "./types";

// =============================================================================
// Analyzer Options
// =============================================================================

export interface AnalyzerOptions {
  /** Path to tsconfig.json (optional, will use default if not provided) */
  tsConfigPath?: string;
  /** Whether to resolve and inline referenced workflows */
  resolveReferences?: boolean;
  /** Maximum depth for reference resolution (default: 5) */
  maxReferenceDepth?: number;
  /** Whether to include source locations in output */
  includeLocations?: boolean;
}

const DEFAULT_OPTIONS: Required<AnalyzerOptions> = {
  tsConfigPath: "./tsconfig.json",
  resolveReferences: true,
  maxReferenceDepth: 5,
  includeLocations: true,
};

// =============================================================================
// Main Analyzer
// =============================================================================

/**
 * Analyze a workflow file and extract its static structure.
 *
 * @param filePath - Path to the TypeScript file containing the workflow
 * @param workflowName - Optional name of specific workflow to analyze (if file has multiple)
 * @param options - Analysis options
 * @returns Static workflow IR
 */
export function analyzeWorkflow(
  filePath: string,
  workflowName?: string,
  options: AnalyzerOptions = {}
): StaticWorkflowIR {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { ts } = loadTsMorph();

  // Create ts-morph project
  const project = createProject(opts);
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Find createWorkflow calls
  const workflows = findWorkflowCalls(sourceFile);

  if (workflows.length === 0) {
    throw new Error(`No createWorkflow calls found in ${filePath}`);
  }

  // Select the workflow to analyze
  const targetWorkflow = workflowName
    ? workflows.find((w) => w.name === workflowName)
    : workflows[0];

  if (!targetWorkflow) {
    const available = workflows.map((w) => w.name).join(", ");
    throw new Error(
      `Workflow "${workflowName}" not found. Available workflows: ${available}`
    );
  }

  const warnings: AnalysisWarning[] = [];
  const stats = createEmptyStats();

  // Analyze the workflow
  const rootNode = analyzeWorkflowCall(
    targetWorkflow,
    sourceFile,
    opts,
    warnings,
    stats
  );

  return {
    root: rootNode,
    metadata: {
      analyzedAt: Date.now(),
      filePath,
      tsVersion: ts.version,
      warnings,
      stats,
    },
    references: new Map(),
  };
}

// =============================================================================
// Project Setup
// =============================================================================

function createProject(opts: Required<AnalyzerOptions>): Project {
  // Lazy-load ts-morph at runtime - shows helpful error if not installed
  const { Project: TsMorphProject, ts } = loadTsMorph();

  try {
    return new TsMorphProject({
      tsConfigFilePath: opts.tsConfigPath,
      skipAddingFilesFromTsConfig: true,
    });
  } catch {
    // Fallback if tsconfig not found
    return new TsMorphProject({
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        esModuleInterop: true,
      },
    });
  }
}

// =============================================================================
// Workflow Discovery
// =============================================================================

interface WorkflowCallInfo {
  name: string;
  callExpression: Node;
  depsObject: Node | undefined;
  callbackFunction: Node | undefined;
  variableDeclaration: Node | undefined;
}

function findWorkflowCalls(sourceFile: SourceFile): WorkflowCallInfo[] {
  const { Node } = loadTsMorph();
  const workflows: WorkflowCallInfo[] = [];

  // Find all call expressions
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expression = node.getExpression();
    const text = expression.getText();

    // Check for createWorkflow calls
    if (text === "createWorkflow") {
      const args = node.getArguments();
      const parent = node.getParent();

      let name = "anonymous";
      let variableDeclaration: Node | undefined;

      // Try to get the name from variable declaration
      if (Node.isVariableDeclaration(parent)) {
        name = parent.getName();
        variableDeclaration = parent;
      } else if (Node.isPropertyAssignment(parent)) {
        name = parent.getName();
      }

      workflows.push({
        name,
        callExpression: node,
        depsObject: args[0],
        callbackFunction: args[1], // For createWorkflow with inline callback
        variableDeclaration,
      });
    }
  });

  return workflows;
}

// =============================================================================
// Workflow Analysis
// =============================================================================

function analyzeWorkflowCall(
  workflowInfo: WorkflowCallInfo,
  sourceFile: SourceFile,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticWorkflowNode {
  const { name, callExpression, depsObject } = workflowInfo;

  // Extract dependencies
  const dependencies = depsObject
    ? extractDependencies(depsObject, warnings)
    : [];

  // Extract error types from dependencies
  const errorTypes = extractErrorTypes(dependencies);

  // Find workflow invocations to analyze the callback
  const invocations = findWorkflowInvocations(workflowInfo, sourceFile);
  const children: StaticFlowNode[] = [];

  for (const invocation of invocations) {
    const callback = invocation.callbackArg;
    if (callback) {
      const analyzed = analyzeCallback(callback, opts, warnings, stats);
      children.push(...analyzed);
    }
  }

  // If no invocations found, try to find inline callback
  if (children.length === 0 && workflowInfo.callbackFunction) {
    const analyzed = analyzeCallback(
      workflowInfo.callbackFunction,
      opts,
      warnings,
      stats
    );
    children.push(...analyzed);
  }

  return {
    id: generateId(),
    type: "workflow",
    workflowName: name,
    dependencies,
    errorTypes,
    children,
    location: opts.includeLocations ? getLocation(callExpression) : undefined,
  };
}

interface WorkflowInvocation {
  callExpression: Node;
  callbackArg: Node | undefined;
}

function findWorkflowInvocations(
  workflowInfo: WorkflowCallInfo,
  sourceFile: SourceFile
): WorkflowInvocation[] {
  const { Node } = loadTsMorph();
  const invocations: WorkflowInvocation[] = [];
  const workflowName = workflowInfo.name;

  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expression = node.getExpression();
    const text = expression.getText();

    // Check if this is an invocation of our workflow
    if (text === workflowName || text === `await ${workflowName}`) {
      const args = node.getArguments();
      invocations.push({
        callExpression: node,
        callbackArg: args[0],
      });
    }
  });

  return invocations;
}

// =============================================================================
// Callback Analysis
// =============================================================================

function analyzeCallback(
  callback: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  // Get the function body
  let body: Node | undefined;

  if (Node.isArrowFunction(callback)) {
    body = callback.getBody();
  } else if (Node.isFunctionExpression(callback)) {
    body = callback.getBody();
  }

  if (!body) {
    warnings.push({
      code: "CALLBACK_NO_BODY",
      message: "Could not extract callback body",
      location: getLocation(callback),
    });
    return [];
  }

  // Analyze the body
  return analyzeNode(body, opts, warnings, stats);
}

function analyzeNode(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  const results: StaticFlowNode[] = [];

  // Handle block statement
  if (Node.isBlock(node)) {
    for (const statement of node.getStatements()) {
      results.push(...analyzeNode(statement, opts, warnings, stats));
    }
    return wrapInSequence(results, opts);
  }

  // Handle expression statement (e.g., await step(...))
  if (Node.isExpressionStatement(node)) {
    return analyzeNode(node.getExpression(), opts, warnings, stats);
  }

  // Handle await expression
  if (Node.isAwaitExpression(node)) {
    return analyzeNode(node.getExpression(), opts, warnings, stats);
  }

  // Handle variable declaration (const result = await step(...))
  if (Node.isVariableStatement(node)) {
    for (const decl of node.getDeclarationList().getDeclarations()) {
      const initializer = decl.getInitializer();
      if (initializer) {
        results.push(...analyzeNode(initializer, opts, warnings, stats));
      }
    }
    return results;
  }

  // Handle call expression
  if (Node.isCallExpression(node)) {
    const analyzed = analyzeCallExpression(node, opts, warnings, stats);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle if statement
  if (Node.isIfStatement(node)) {
    const analyzed = analyzeIfStatement(node, opts, warnings, stats);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for statement
  if (Node.isForStatement(node)) {
    const analyzed = analyzeForStatement(node, opts, warnings, stats);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for-of statement
  if (Node.isForOfStatement(node)) {
    const analyzed = analyzeForOfStatement(node, opts, warnings, stats);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for-in statement
  if (Node.isForInStatement(node)) {
    const analyzed = analyzeForInStatement(node, opts, warnings, stats);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle while statement
  if (Node.isWhileStatement(node)) {
    const analyzed = analyzeWhileStatement(node, opts, warnings, stats);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle return statement
  if (Node.isReturnStatement(node)) {
    const expr = node.getExpression();
    if (expr) {
      return analyzeNode(expr, opts, warnings, stats);
    }
    return results;
  }

  // NOTE: Arrow functions and function expressions are NOT handled generically here.
  // They are only analyzed in explicit callback contexts (when/unless helpers, allAsync arrays)
  // to avoid counting steps inside unused helper functions or variable initializers.

  return results;
}

/**
 * Analyze a callback argument (arrow function or function expression).
 * Only use this in explicit callback contexts like when(), unless(), allAsync(), etc.
 */
function analyzeCallbackArgument(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  // Handle arrow function (e.g., () => step(...))
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    return analyzeNode(body, opts, warnings, stats);
  }

  // Handle function expression (e.g., function() { step(...) })
  if (Node.isFunctionExpression(node)) {
    const body = node.getBody();
    return analyzeNode(body, opts, warnings, stats);
  }

  // Fallback: try analyzing as a regular node (e.g., a direct call expression)
  return analyzeNode(node, opts, warnings, stats);
}

// =============================================================================
// Call Expression Analysis
// =============================================================================

function analyzeCallExpression(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticFlowNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isCallExpression(node)) return undefined;

  const expression = node.getExpression();
  const callee = expression.getText();
  const args = node.getArguments();

  // step() call
  if (callee === "step" || callee.endsWith(".step")) {
    return analyzeStepCall(node, args, opts, warnings, stats);
  }

  // step.retry() call
  if (callee === "step.retry" || callee.endsWith(".retry")) {
    return analyzeStepRetryCall(node, args, opts, warnings, stats);
  }

  // step.withTimeout() call
  if (callee === "step.withTimeout" || callee.includes("withTimeout")) {
    return analyzeStepTimeoutCall(node, args, opts, warnings, stats);
  }

  // step.parallel() call
  if (callee === "step.parallel" || callee.includes("parallel")) {
    return analyzeParallelCall(node, args, "all", opts, warnings, stats);
  }

  // step.race() call
  if (callee === "step.race" || callee.includes("race")) {
    return analyzeRaceCall(node, args, opts, warnings, stats);
  }

  // allAsync() call
  if (callee === "allAsync") {
    return analyzeAllAsyncCall(node, args, "all", opts, warnings, stats);
  }

  // allSettledAsync() call
  if (callee === "allSettledAsync") {
    return analyzeAllAsyncCall(node, args, "allSettled", opts, warnings, stats);
  }

  // anyAsync() call
  if (callee === "anyAsync") {
    return analyzeAnyAsyncCall(node, args, opts, warnings, stats);
  }

  // when() / unless() / whenOr() / unlessOr() calls
  if (["when", "unless", "whenOr", "unlessOr"].includes(callee)) {
    return analyzeConditionalHelper(
      node,
      callee as "when" | "unless" | "whenOr" | "unlessOr",
      args,
      opts,
      warnings,
      stats
    );
  }

  // Check if this might be a workflow call
  if (isLikelyWorkflowCall(node)) {
    return analyzeWorkflowRefCall(node, callee, opts, warnings, stats);
  }

  return undefined;
}

// =============================================================================
// Step Analysis
// =============================================================================

function analyzeStepCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract the operation being called
  if (args[0]) {
    const firstArg = args[0];
    if (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg)) {
      // step(() => fetchUser(id))
      const body = firstArg.getBody();
      if (Node.isCallExpression(body)) {
        stepNode.callee = body.getExpression().getText();
      } else if (body) {
        stepNode.callee = body.getText();
      }
    } else if (Node.isCallExpression(firstArg)) {
      // step(fetchUser(id)) - direct call
      stepNode.callee = firstArg.getExpression().getText();
    } else {
      // step(someResult) - passing a result directly
      stepNode.callee = firstArg.getText();
    }
  }

  // Extract options from second argument
  if (args[1] && Node.isObjectLiteralExpression(args[1])) {
    const options = extractStepOptions(args[1]);
    if (options.key) stepNode.key = options.key;
    if (options.name) stepNode.name = options.name;
    if (options.retry) stepNode.retry = options.retry;
    if (options.timeout) stepNode.timeout = options.timeout;
  }

  // Use callee as name if no name specified
  if (!stepNode.name && stepNode.callee) {
    stepNode.name = stepNode.callee;
  }

  return stepNode;
}

function analyzeStepRetryCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract the operation
  if (args[0]) {
    stepNode.callee = extractCallee(args[0]);
    stepNode.name = stepNode.callee;
  }

  // Extract retry options
  if (args[1] && Node.isObjectLiteralExpression(args[1])) {
    stepNode.retry = extractRetryConfig(args[1]);
  }

  return stepNode;
}

function analyzeStepTimeoutCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract the operation
  if (args[0]) {
    stepNode.callee = extractCallee(args[0]);
    stepNode.name = stepNode.callee;
  }

  // Extract timeout options
  if (args[1] && Node.isObjectLiteralExpression(args[1])) {
    stepNode.timeout = extractTimeoutConfig(args[1]);
  }

  return stepNode;
}

// =============================================================================
// Parallel/Race Analysis
// =============================================================================

function analyzeParallelCall(
  node: Node,
  args: Node[],
  mode: "all" | "allSettled",
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticParallelNode {
  const { Node } = loadTsMorph();
  stats.parallelCount++;

  const parallelNode: StaticParallelNode = {
    id: generateId(),
    type: "parallel",
    mode,
    children: [],
    callee: "step.parallel",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract operations from arguments
  if (args[0] && Node.isObjectLiteralExpression(args[0])) {
    // Named parallel: step.parallel({ a: () => ..., b: () => ... })
    for (const prop of args[0].getProperties()) {
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName();
        const init = prop.getInitializer();
        if (init) {
          const implicitStep = tryExtractImplicitStep(init, opts, stats);
          if (implicitStep) {
            implicitStep.name = name;
            parallelNode.children.push(implicitStep);
          } else {
            const children = analyzeCallbackArgument(init, opts, warnings, stats);
            if (children.length > 0) {
              const child = children[0];
              child.name = name;
              parallelNode.children.push(child);
            }
          }
        }
      }
    }
  } else if (args[0] && Node.isArrayLiteralExpression(args[0])) {
    // Array parallel: step.parallel([() => ..., () => ...])
    for (const element of args[0].getElements()) {
      const implicitStep = tryExtractImplicitStep(element, opts, stats);
      if (implicitStep) {
        parallelNode.children.push(implicitStep);
      } else {
        const children = analyzeCallbackArgument(element, opts, warnings, stats);
        parallelNode.children.push(...children);
      }
    }
  }

  return parallelNode;
}

/**
 * Try to extract an implicit step from a callback that wraps a direct call expression.
 * e.g., () => deps.fetchPosts(id) -> implicit step for "fetchPosts"
 */
function tryExtractImplicitStep(
  node: Node,
  opts: Required<AnalyzerOptions>,
  stats: AnalysisStats
): StaticStepNode | undefined {
  const { Node } = loadTsMorph();
  // Check if it's an arrow function with a call expression body
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    if (Node.isCallExpression(body)) {
      const callee = body.getExpression().getText();
      stats.totalSteps++;
      return {
        id: generateId(),
        type: "step",
        location: opts.includeLocations ? getLocation(body) : undefined,
        callee,
        name: extractImplicitStepName(callee),
      };
    }
  }

  // Check if it's a function expression with a single return statement
  if (Node.isFunctionExpression(node)) {
    const body = node.getBody();
    if (!Node.isBlock(body)) return undefined;
    const statements = body.getStatements();
    if (statements.length === 1 && Node.isReturnStatement(statements[0])) {
      const expr = statements[0].getExpression();
      if (expr && Node.isCallExpression(expr)) {
        const callee = expr.getExpression().getText();
        stats.totalSteps++;
        return {
          id: generateId(),
          type: "step",
          location: opts.includeLocations ? getLocation(expr) : undefined,
          callee,
          name: extractImplicitStepName(callee),
        };
      }
    }
  }

  return undefined;
}

function analyzeAllAsyncCall(
  node: Node,
  args: Node[],
  mode: "all" | "allSettled",
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticParallelNode {
  const { Node } = loadTsMorph();
  stats.parallelCount++;

  const parallelNode: StaticParallelNode = {
    id: generateId(),
    type: "parallel",
    mode,
    children: [],
    callee: mode === "all" ? "allAsync" : "allSettledAsync",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract operations from array argument
  if (args[0] && Node.isArrayLiteralExpression(args[0])) {
    for (const element of args[0].getElements()) {
      // Use analyzeCallbackArgument for arrow functions/function expressions
      const children = analyzeCallbackArgument(element, opts, warnings, stats);

      // If analyzeCallbackArgument found known patterns (step, etc.), use those
      if (children.length > 0) {
        parallelNode.children.push(...children);
      } else if (Node.isCallExpression(element)) {
        // Treat direct call expressions as implicit steps
        // e.g., allAsync([deps.fetchPosts(id), deps.fetchFriends(id)])
        const callee = element.getExpression().getText();
        stats.totalSteps++;
        const implicitStep: StaticStepNode = {
          id: generateId(),
          type: "step",
          location: opts.includeLocations ? getLocation(element) : undefined,
          callee,
          name: extractImplicitStepName(callee),
        };
        parallelNode.children.push(implicitStep);
      }
    }
  }

  return parallelNode;
}

/**
 * Extract a human-readable name from a callee expression.
 * e.g., "deps.fetchPosts" -> "fetchPosts", "fetchUser" -> "fetchUser"
 */
function extractImplicitStepName(callee: string): string {
  // Get the last part after the last dot
  const parts = callee.split(".");
  return parts[parts.length - 1];
}

function analyzeRaceCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticRaceNode {
  const { Node } = loadTsMorph();
  stats.raceCount++;

  const raceNode: StaticRaceNode = {
    id: generateId(),
    type: "race",
    children: [],
    callee: "step.race",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract operations
  if (args[0] && Node.isArrayLiteralExpression(args[0])) {
    for (const element of args[0].getElements()) {
      const children = analyzeCallbackArgument(element, opts, warnings, stats);
      raceNode.children.push(...children);
    }
  }

  return raceNode;
}

function analyzeAnyAsyncCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticRaceNode {
  const { Node } = loadTsMorph();
  stats.raceCount++;

  const raceNode: StaticRaceNode = {
    id: generateId(),
    type: "race",
    children: [],
    callee: "anyAsync",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  if (args[0] && Node.isArrayLiteralExpression(args[0])) {
    for (const element of args[0].getElements()) {
      const children = analyzeCallbackArgument(element, opts, warnings, stats);
      raceNode.children.push(...children);
    }
  }

  return raceNode;
}

// =============================================================================
// Conditional Analysis
// =============================================================================

function analyzeIfStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticConditionalNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isIfStatement(node)) return undefined;

  const condition = node.getExpression().getText();
  const thenStatement = node.getThenStatement();
  const elseStatement = node.getElseStatement();

  const consequent = analyzeNode(thenStatement, opts, warnings, stats);
  const alternate = elseStatement
    ? analyzeNode(elseStatement, opts, warnings, stats)
    : undefined;

  // Only create conditional node if there are step calls inside
  if (consequent.length === 0 && (!alternate || alternate.length === 0)) {
    return undefined;
  }

  stats.conditionalCount++;

  return {
    id: generateId(),
    type: "conditional",
    condition,
    helper: null,
    consequent,
    alternate,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };
}

function analyzeConditionalHelper(
  node: Node,
  helper: "when" | "unless" | "whenOr" | "unlessOr",
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticConditionalNode {
  stats.conditionalCount++;

  const conditionalNode: StaticConditionalNode = {
    id: generateId(),
    type: "conditional",
    condition: args[0]?.getText() ?? "<unknown>",
    helper,
    consequent: [],
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // when(condition, () => step(...))
  // unless(condition, () => step(...))
  // whenOr(condition, () => step(...), defaultValue)
  // unlessOr(condition, () => step(...), defaultValue)

  if (args[1]) {
    conditionalNode.consequent = analyzeCallbackArgument(args[1], opts, warnings, stats);
  }

  if ((helper === "whenOr" || helper === "unlessOr") && args[2]) {
    conditionalNode.defaultValue = args[2].getText();
  }

  return conditionalNode;
}

// =============================================================================
// Loop Analysis
// =============================================================================

function analyzeForStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats);

  if (bodyChildren.length === 0) return undefined;

  stats.loopCount++;

  return {
    id: generateId(),
    type: "loop",
    loopType: "for",
    body: bodyChildren,
    boundKnown: false,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };
}

function analyzeForOfStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForOfStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats);

  if (bodyChildren.length === 0) return undefined;

  stats.loopCount++;

  return {
    id: generateId(),
    type: "loop",
    loopType: "for-of",
    iterSource: node.getExpression().getText(),
    body: bodyChildren,
    boundKnown: false,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };
}

function analyzeForInStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForInStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats);

  if (bodyChildren.length === 0) return undefined;

  stats.loopCount++;

  return {
    id: generateId(),
    type: "loop",
    loopType: "for-in",
    iterSource: node.getExpression().getText(),
    body: bodyChildren,
    boundKnown: false,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };
}

function analyzeWhileStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isWhileStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats);

  if (bodyChildren.length === 0) return undefined;

  stats.loopCount++;

  return {
    id: generateId(),
    type: "loop",
    loopType: "while",
    body: bodyChildren,
    boundKnown: false,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };
}

// =============================================================================
// Workflow Reference Analysis
// =============================================================================

function analyzeWorkflowRefCall(
  node: Node,
  callee: string,
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticWorkflowRefNode {
  stats.workflowRefCount++;

  return {
    id: generateId(),
    type: "workflow-ref",
    workflowName: callee,
    resolved: false,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };
}

function isLikelyWorkflowCall(node: Node): boolean {
  const { Node } = loadTsMorph();
  if (!Node.isCallExpression(node)) return false;

  // Check if the call has a callback as first argument
  const args = node.getArguments();
  if (args.length === 0) return false;

  const firstArg = args[0];
  return (
    Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg)
  );
}

// =============================================================================
// Utility Functions
// =============================================================================

function extractDependencies(
  depsNode: Node,
  _warnings: AnalysisWarning[]
): DependencyInfo[] {
  const { Node } = loadTsMorph();
  const dependencies: DependencyInfo[] = [];

  if (!Node.isObjectLiteralExpression(depsNode)) {
    return dependencies;
  }

  for (const prop of depsNode.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      const name = prop.getName();
      // TODO: Extract type signature and error types
      dependencies.push({
        name,
        errorTypes: [],
      });
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      const name = prop.getName();
      dependencies.push({
        name,
        errorTypes: [],
      });
    }
  }

  return dependencies;
}

function extractErrorTypes(dependencies: DependencyInfo[]): string[] {
  const errorTypes = new Set<string>();
  for (const dep of dependencies) {
    for (const error of dep.errorTypes) {
      errorTypes.add(error);
    }
  }
  return Array.from(errorTypes);
}

interface StepOptions {
  key?: string;
  name?: string;
  retry?: StaticRetryConfig;
  timeout?: StaticTimeoutConfig;
}

function extractStepOptions(optionsNode: Node): StepOptions {
  const { Node } = loadTsMorph();
  const options: StepOptions = {};

  if (!Node.isObjectLiteralExpression(optionsNode)) {
    return options;
  }

  for (const prop of optionsNode.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "key" && init) {
      options.key = extractStringValue(init);
    } else if (propName === "name" && init) {
      options.name = extractStringValue(init);
    } else if (propName === "retry" && init && Node.isObjectLiteralExpression(init)) {
      options.retry = extractRetryConfig(init);
    } else if (propName === "timeout" && init && Node.isObjectLiteralExpression(init)) {
      options.timeout = extractTimeoutConfig(init);
    }
  }

  return options;
}

function extractRetryConfig(node: Node): StaticRetryConfig {
  const { Node } = loadTsMorph();
  const config: StaticRetryConfig = {};

  if (!Node.isObjectLiteralExpression(node)) {
    return config;
  }

  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "attempts" && init) {
      config.attempts = extractNumberValue(init);
    } else if (propName === "backoff" && init) {
      const val = extractStringValue(init);
      if (val === "fixed" || val === "linear" || val === "exponential") {
        config.backoff = val;
      } else {
        config.backoff = "<dynamic>";
      }
    } else if (propName === "baseDelay" && init) {
      config.baseDelay = extractNumberValue(init);
    } else if (propName === "retryOn" && init) {
      config.retryOn = init.getText();
    }
  }

  return config;
}

function extractTimeoutConfig(node: Node): StaticTimeoutConfig {
  const { Node } = loadTsMorph();
  const config: StaticTimeoutConfig = {};

  if (!Node.isObjectLiteralExpression(node)) {
    return config;
  }

  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "ms" && init) {
      config.ms = extractNumberValue(init);
    }
  }

  return config;
}

function extractStringValue(node: Node): string {
  const { Node } = loadTsMorph();
  if (Node.isStringLiteral(node)) {
    return node.getLiteralValue();
  }
  if (Node.isTemplateExpression(node)) {
    return "<dynamic>";
  }
  if (Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralValue();
  }
  return node.getText();
}

function extractNumberValue(node: Node): number | "<dynamic>" {
  const { Node } = loadTsMorph();
  if (Node.isNumericLiteral(node)) {
    return node.getLiteralValue();
  }
  return "<dynamic>";
}

function extractCallee(node: Node): string {
  const { Node } = loadTsMorph();
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const body = node.getBody();
    if (Node.isCallExpression(body)) {
      return body.getExpression().getText();
    }
    return body?.getText() ?? "<unknown>";
  }
  if (Node.isCallExpression(node)) {
    return node.getExpression().getText();
  }
  return node.getText();
}

function getLocation(node: Node): SourceLocation {
  const sourceFile = node.getSourceFile();
  const start = node.getStart();
  const end = node.getEnd();
  const startPos = sourceFile.getLineAndColumnAtPos(start);
  const endPos = sourceFile.getLineAndColumnAtPos(end);

  return {
    filePath: sourceFile.getFilePath(),
    line: startPos.line,
    column: startPos.column - 1,
    endLine: endPos.line,
    endColumn: endPos.column - 1,
  };
}

function wrapInSequence(
  nodes: StaticFlowNode[],
  _opts: Required<AnalyzerOptions>
): StaticFlowNode[] {
  if (nodes.length <= 1) {
    return nodes;
  }

  return [
    {
      id: generateId(),
      type: "sequence",
      children: nodes,
    } as StaticSequenceNode,
  ];
}

function createEmptyStats(): AnalysisStats {
  return {
    totalSteps: 0,
    conditionalCount: 0,
    parallelCount: 0,
    raceCount: 0,
    loopCount: 0,
    workflowRefCount: 0,
    unknownCount: 0,
  };
}

let idCounter = 0;
function generateId(): string {
  return `static-${++idCounter}`;
}

/**
 * Reset the ID counter (useful for testing).
 */
export function resetIdCounter(): void {
  idCounter = 0;
}
