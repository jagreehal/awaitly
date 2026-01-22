/**
 * Static Workflow Analyzer (Tree-sitter POC)
 *
 * Uses tree-sitter to parse TypeScript AST and extract workflow structure.
 * This is a POC to evaluate tree-sitter as a replacement for ts-morph.
 *
 * Goals:
 * - Parse TypeScript files using WASM-based tree-sitter
 * - Find createWorkflow calls
 * - Extract step invocations from workflow callbacks
 * - Generate compatible StaticWorkflowIR output
 */

import { readFileSync } from "fs";
import { loadTreeSitter, type SyntaxNode } from "./tree-sitter-loader";
import type {
  StaticWorkflowIR,
  StaticWorkflowNode,
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticLoopNode,
  StaticConditionalNode,
  StaticRaceNode,
  StaticWorkflowRefNode,
  StaticRetryConfig,
  StaticTimeoutConfig,
  StaticAnalysisMetadata,
  SourceLocation,
  AnalysisWarning,
  AnalysisStats,
  AnalyzerOptions,
} from "./types";

// =============================================================================
// Types
// =============================================================================

interface AnalyzerContext {
  sourceCode: string;
  filePath: string;
  opts: Required<AnalyzerOptions>;
  warnings: AnalysisWarning[];
  stats: AnalysisStats;
  /** Set of workflow names defined in this file */
  workflowNames: Set<string>;
  /** The current workflow being analyzed (to detect self-references) */
  currentWorkflow?: string;
  /** The name of the step parameter in the current callback (e.g., "step") */
  stepParameterName?: string;
}

// =============================================================================
// Default Options
// =============================================================================

const DEFAULT_OPTIONS: Required<AnalyzerOptions> = {
  tsConfigPath: "./tsconfig.json",
  resolveReferences: false, // Not implemented in tree-sitter POC
  maxReferenceDepth: 5,
  includeLocations: true,
};

// =============================================================================
// Public API
// =============================================================================

/**
 * Analyze a workflow file using tree-sitter.
 *
 * @param filePath - Path to the TypeScript file
 * @param options - Analysis options
 * @returns Array of workflow IR objects
 */
export async function analyzeWorkflow(
  filePath: string,
  options: AnalyzerOptions = {}
): Promise<StaticWorkflowIR[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Load tree-sitter (downloads WASM on first use)
  const { parser } = await loadTreeSitter();

  // Read and parse the source file
  const sourceCode = readFileSync(filePath, "utf-8");
  const tree = parser.parse(sourceCode);

  // Create analysis context
  const ctx: AnalyzerContext = {
    sourceCode,
    filePath,
    opts,
    warnings: [],
    stats: createEmptyStats(),
    workflowNames: new Set(),
  };

  // Find all workflow definitions first to track names
  const definitions = findWorkflowDefinitions(tree.rootNode, ctx);
  definitions.forEach((d) => ctx.workflowNames.add(d.name));

  // Find all createWorkflow calls
  const workflowCalls = findWorkflowCalls(tree.rootNode, ctx);

  // Analyze each workflow
  const results: StaticWorkflowIR[] = [];
  for (const call of workflowCalls) {
    const ir = analyzeWorkflowCall(call, ctx);
    if (ir) {
      results.push(ir);
    }
  }

  return results;
}

/**
 * Parse source code directly (for testing).
 */
export async function analyzeWorkflowSource(
  sourceCode: string,
  options: AnalyzerOptions = {}
): Promise<StaticWorkflowIR[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { parser } = await loadTreeSitter();
  const tree = parser.parse(sourceCode);

  const ctx: AnalyzerContext = {
    sourceCode,
    filePath: "<source>",
    opts,
    warnings: [],
    stats: createEmptyStats(),
    workflowNames: new Set(),
  };

  // Find all workflow definitions first to track names
  const definitions = findWorkflowDefinitions(tree.rootNode, ctx);
  definitions.forEach((d) => ctx.workflowNames.add(d.name));

  const workflowCalls = findWorkflowCalls(tree.rootNode, ctx);
  const results: StaticWorkflowIR[] = [];

  for (const call of workflowCalls) {
    const ir = analyzeWorkflowCall(call, ctx);
    if (ir) {
      results.push(ir);
    }
  }

  return results;
}

// =============================================================================
// Workflow Discovery
// =============================================================================

interface WorkflowDefinition {
  name: string;
  createWorkflowCall: SyntaxNode;
}

/**
 * Find all createWorkflow calls and extract workflow names.
 */
function findWorkflowDefinitions(
  root: SyntaxNode,
  ctx: AnalyzerContext
): WorkflowDefinition[] {
  const results: WorkflowDefinition[] = [];

  traverseNode(root, (node) => {
    if (node.type === "call_expression") {
      const funcNode = node.childForFieldName("function");
      if (funcNode) {
        const funcText = getText(funcNode, ctx);
        if (funcText === "createWorkflow") {
          const workflowName = extractWorkflowName(node, ctx);
          if (workflowName) {
            results.push({ name: workflowName, createWorkflowCall: node });
          }
        }
      }
    }
  });

  return results;
}

/**
 * Find all calls to a workflow (workflow invocations with callbacks).
 */
function findWorkflowCalls(root: SyntaxNode, ctx: AnalyzerContext): SyntaxNode[] {
  const definitions = findWorkflowDefinitions(root, ctx);
  const workflowNames = new Set(definitions.map((d) => d.name));

  const results: SyntaxNode[] = [];

  traverseNode(root, (node) => {
    if (node.type === "call_expression") {
      const funcNode = node.childForFieldName("function");
      if (funcNode) {
        const funcText = getText(funcNode, ctx);
        // Check if this is a call to a known workflow
        if (workflowNames.has(funcText)) {
          // Check if it has a callback argument
          const args = node.childForFieldName("arguments");
          if (args) {
            const firstArg = args.namedChildren[0];
            if (
              firstArg?.type === "arrow_function" ||
              firstArg?.type === "function_expression"
            ) {
              results.push(node);
            }
          }
        }
      }
    }
  });

  return results;
}

/**
 * Analyze a workflow invocation and extract the workflow structure.
 */
function analyzeWorkflowCall(
  callNode: SyntaxNode,
  parentCtx: AnalyzerContext
): StaticWorkflowIR | null {
  // Get the workflow name from the function being called
  const funcNode = callNode.childForFieldName("function");
  const workflowName = funcNode ? getText(funcNode, parentCtx) : "<unknown>";

  // Get the callback argument
  const args = callNode.childForFieldName("arguments");
  const callbackNode = args?.namedChildren[0];

  // Create fresh stats and warnings for this workflow
  const workflowWarnings: AnalysisWarning[] = [];
  const workflowStats = createEmptyStats();

  // Create a workflow-scoped context
  const ctx: AnalyzerContext = {
    ...parentCtx,
    warnings: workflowWarnings,
    stats: workflowStats,
  };

  if (
    !callbackNode ||
    (callbackNode.type !== "arrow_function" &&
      callbackNode.type !== "function_expression")
  ) {
    workflowWarnings.push({
      code: "CALLBACK_NOT_FOUND",
      message: `Could not find callback for workflow ${workflowName}`,
      location: getLocation(callNode, ctx),
    });
    return null;
  }

  // Set current workflow to detect self-references
  const prevWorkflow = ctx.currentWorkflow;
  ctx.currentWorkflow = workflowName;

  // Extract the step parameter name from the callback signature
  // e.g., `async (step, deps) => {...}` -> "step"
  const stepParamName = extractStepParameterName(callbackNode, ctx);
  const prevStepParamName = ctx.stepParameterName;
  ctx.stepParameterName = stepParamName;

  // Analyze the callback body
  const children = analyzeCallback(callbackNode, ctx);

  // Restore previous workflow and step parameter name
  ctx.currentWorkflow = prevWorkflow;
  ctx.stepParameterName = prevStepParamName;

  // Create the root workflow node
  const rootNode: StaticWorkflowNode = {
    id: generateId(),
    type: "workflow",
    workflowName,
    dependencies: [], // Not implemented in POC
    errorTypes: [],
    children: wrapInSequence(children),
  };

  // Create metadata with workflow-specific stats and warnings
  const metadata: StaticAnalysisMetadata = {
    analyzedAt: Date.now(),
    filePath: ctx.filePath,
    warnings: workflowWarnings,
    stats: workflowStats,
  };

  return {
    root: rootNode,
    metadata,
    references: new Map(),
  };
}

/**
 * Extract the workflow name from parent variable declaration.
 */
function extractWorkflowName(
  callNode: SyntaxNode,
  ctx: AnalyzerContext
): string | null {
  // Walk up to find variable_declarator
  let current: SyntaxNode | null = callNode;
  while (current) {
    if (current.type === "variable_declarator") {
      const nameNode = current.childForFieldName("name");
      if (nameNode) {
        return getText(nameNode, ctx);
      }
    }
    current = current.parent;
  }
  return null;
}

/**
 * Extract the step parameter name from a workflow callback.
 * e.g., `async (step, deps) => {...}` -> "step"
 * e.g., `async (s, dependencies) => {...}` -> "s"
 * e.g., `async ({ step: runStep }, deps) => {...}` -> "runStep"
 */
function extractStepParameterName(
  callbackNode: SyntaxNode,
  ctx: AnalyzerContext
): string | undefined {
  const params = callbackNode.childForFieldName("parameters");
  if (!params) return undefined;

  // Get the first parameter (which is the step function)
  const firstParam = params.namedChildren[0];
  if (!firstParam) return undefined;

  // Handle simple identifier: `(step, deps) => ...`
  if (firstParam.type === "identifier") {
    return getText(firstParam, ctx);
  }

  // Handle typed parameter: `(step: StepFn, deps: Deps) => ...`
  if (firstParam.type === "required_parameter") {
    const patternNode = firstParam.childForFieldName("pattern");
    if (patternNode) {
      // Check if the pattern is a destructuring pattern
      if (patternNode.type === "object_pattern") {
        return extractStepFromObjectPattern(patternNode, ctx);
      }
      return getText(patternNode, ctx);
    }
  }

  // Handle destructuring without type annotation: `({ step: runStep }, deps) => ...`
  if (firstParam.type === "object_pattern") {
    return extractStepFromObjectPattern(firstParam, ctx);
  }

  return undefined;
}

/**
 * Extract the step parameter name from a destructuring pattern.
 * e.g., `{ step: runStep }` -> "runStep"
 * e.g., `{ step }` -> "step" (shorthand)
 * e.g., `{ step = defaultStep }` -> "step" (shorthand with default)
 */
function extractStepFromObjectPattern(
  objectPattern: SyntaxNode,
  ctx: AnalyzerContext
): string | undefined {
  // Look for a property that maps "step" to an alias
  for (const child of objectPattern.namedChildren) {
    // Handle pair_pattern: `step: runStep` or `step: runStep = fallback`
    if (child.type === "pair_pattern") {
      const keyNode = child.childForFieldName("key");
      const valueNode = child.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);
        // If the key is "step", return the alias (value)
        if (key === "step") {
          // Handle assignment_pattern: `step: runStep = fallback`
          // Extract just the identifier, not the default value
          if (valueNode.type === "assignment_pattern") {
            const left = valueNode.childForFieldName("left");
            if (left) {
              return getText(left, ctx);
            }
          }
          return getText(valueNode, ctx);
        }
      }
    }

    // Handle shorthand_property_identifier_pattern: `{ step }` (no alias)
    if (child.type === "shorthand_property_identifier_pattern") {
      const name = getText(child, ctx);
      if (name === "step") {
        return "step";
      }
    }

    // Handle assignment_pattern: `{ step = defaultStep }` (shorthand with default)
    // Tree-sitter may parse this as assignment_pattern directly in object_pattern
    if (child.type === "assignment_pattern") {
      const left = child.childForFieldName("left");
      if (left) {
        const name = getText(left, ctx);
        if (name === "step") {
          return "step";
        }
      }
    }
  }

  return undefined;
}

// =============================================================================
// Callback Analysis
// =============================================================================

/**
 * Analyze a workflow callback function body.
 */
function analyzeCallback(
  callbackNode: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const body = callbackNode.childForFieldName("body");
  if (!body) return [];

  // If body is a block statement, analyze its statements
  if (body.type === "statement_block") {
    return analyzeStatements(body.namedChildren, ctx);
  }

  // If body is a single expression (implicit return), analyze it
  return analyzeExpression(body, ctx);
}

/**
 * Analyze a list of statements.
 */
function analyzeStatements(
  statements: SyntaxNode[],
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const results: StaticFlowNode[] = [];

  for (const stmt of statements) {
    const nodes = analyzeStatement(stmt, ctx);
    results.push(...nodes);
  }

  return results;
}

/**
 * Analyze a single statement.
 */
function analyzeStatement(
  stmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  switch (stmt.type) {
    case "expression_statement": {
      // Unwrap expression statement
      const expr = stmt.namedChildren[0];
      if (expr) {
        return analyzeExpression(expr, ctx);
      }
      return [];
    }

    case "variable_declaration":
    case "lexical_declaration":
      // Check for step calls in variable declarations
      // lexical_declaration is used for const/let, variable_declaration for var
      return analyzeVariableDeclaration(stmt, ctx);

    case "return_statement": {
      // Analyze return expression
      const returnExpr = stmt.childForFieldName("value");
      if (returnExpr) {
        return analyzeExpression(returnExpr, ctx);
      }
      return [];
    }

    case "if_statement":
      return analyzeIfStatement(stmt, ctx);

    case "for_statement":
      return analyzeForStatement(stmt, ctx);

    case "for_in_statement":
      return analyzeForInStatement(stmt, ctx);

    case "while_statement":
      return analyzeWhileStatement(stmt, ctx);

    default:
      return [];
  }
}

/**
 * Analyze an expression for step calls.
 */
function analyzeExpression(
  expr: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  // Handle await expressions
  if (expr.type === "await_expression") {
    const inner = expr.namedChildren[0];
    if (inner) {
      return analyzeExpression(inner, ctx);
    }
    return [];
  }

  // Handle parenthesized expressions - unwrap and recurse
  // e.g., `await (step(...))` or `return (await step(...))`
  if (expr.type === "parenthesized_expression") {
    const inner = expr.namedChildren[0];
    if (inner) {
      return analyzeExpression(inner, ctx);
    }
    return [];
  }

  // Handle call expressions
  if (expr.type === "call_expression") {
    return analyzeCallExpression(expr, ctx);
  }

  return [];
}

/**
 * Analyze a variable declaration for step calls.
 */
function analyzeVariableDeclaration(
  decl: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const results: StaticFlowNode[] = [];

  // Find all declarators
  for (const child of decl.namedChildren) {
    if (child.type === "variable_declarator") {
      const value = child.childForFieldName("value");
      if (value) {
        results.push(...analyzeExpression(value, ctx));
      }
    }
  }

  return results;
}

/**
 * Analyze a call expression for step invocations.
 */
function analyzeCallExpression(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const funcNode = call.childForFieldName("function");
  if (!funcNode) return [];

  const funcText = getText(funcNode, ctx);

  // Check for step() calls - only match the actual step parameter, not any object with a .step method
  // e.g., `step(...)` matches, but `tracker.step(...)` does not
  const stepParam = ctx.stepParameterName || "step";
  if (funcText === stepParam) {
    return [analyzeStepCall(call, ctx)];
  }

  // Check for step.retry() - only match <stepParam>.retry, not arbitrary .retry()
  if (funcText === `${stepParam}.retry`) {
    return [analyzeStepRetryCall(call, ctx)];
  }

  // Check for step.withTimeout() - only match <stepParam>.withTimeout, not arbitrary .withTimeout()
  if (funcText === `${stepParam}.withTimeout`) {
    return [analyzeStepTimeoutCall(call, ctx)];
  }

  // Check for step.parallel - only match <stepParam>.parallel, not arbitrary .parallel()
  if (funcText === `${stepParam}.parallel`) {
    return analyzeParallelCall(call, ctx);
  }

  // Check for step.race - only match <stepParam>.race, not arbitrary .race()
  if (funcText === `${stepParam}.race`) {
    return analyzeRaceCall(call, ctx);
  }

  // Check for conditional helpers: when(), unless(), whenOr(), unlessOr()
  if (["when", "unless", "whenOr", "unlessOr"].includes(funcText)) {
    return analyzeConditionalHelper(
      call,
      funcText as "when" | "unless" | "whenOr" | "unlessOr",
      ctx
    );
  }

  // Check for parallel helpers: allAsync(), allSettledAsync()
  if (funcText === "allAsync" || funcText === "allSettledAsync") {
    return analyzeAllAsyncCall(
      call,
      funcText === "allAsync" ? "all" : "allSettled",
      ctx
    );
  }

  // Check for race helper: anyAsync()
  if (funcText === "anyAsync") {
    return analyzeAnyAsyncCall(call, ctx);
  }

  // Check for workflow references (calls to other workflows)
  if (isLikelyWorkflowCall(call, funcText, ctx)) {
    return analyzeWorkflowRefCall(call, funcText, ctx);
  }

  return [];
}

/**
 * Check if a call expression is likely a workflow call.
 * A workflow call has a callback as the first argument.
 */
function isLikelyWorkflowCall(
  call: SyntaxNode,
  funcText: string,
  ctx: AnalyzerContext
): boolean {
  // Don't count the current workflow as a reference to itself
  if (funcText === ctx.currentWorkflow) {
    return false;
  }

  // Check if the first argument is a callback
  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  if (!firstArg) return false;

  // Workflow calls take a callback as first argument
  if (
    firstArg.type === "arrow_function" ||
    firstArg.type === "function_expression"
  ) {
    // Check if it's a known workflow name
    if (ctx.workflowNames.has(funcText)) {
      return true;
    }

    // Heuristic: if it looks like a workflow call (has step, deps params)
    // This helps with cross-file references
    const params = firstArg.childForFieldName("parameters");
    if (params) {
      const paramText = getText(params, ctx);
      if (paramText.includes("step") || paramText.includes("deps")) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Analyze a workflow reference call.
 */
function analyzeWorkflowRefCall(
  call: SyntaxNode,
  workflowName: string,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.workflowRefCount++;

  const refNode: StaticWorkflowRefNode = {
    id: generateId(),
    type: "workflow-ref",
    workflowName,
    resolved: false, // Tree-sitter doesn't resolve cross-file references
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };

  return [refNode];
}

// =============================================================================
// Step Analysis
// =============================================================================

/**
 * Extract the callee from a function body (arrow function or function expression).
 * Handles both expression bodies: () => deps.fn()
 * And block bodies: () => { return deps.fn(); }
 */
function extractCalleeFromFunctionBody(
  body: SyntaxNode,
  ctx: AnalyzerContext
): string {
  // Expression body: () => deps.fetchUser() or () => someCall()
  if (body.type === "call_expression") {
    const funcNode = body.childForFieldName("function");
    if (funcNode) {
      return getText(funcNode, ctx);
    }
  }

  // Block body: () => { return deps.fetchUser(); }
  if (body.type === "statement_block") {
    // Look for a return statement
    for (const child of body.namedChildren) {
      if (child.type === "return_statement") {
        // Get the expression being returned
        const returnExpr = child.namedChildren[0];
        if (returnExpr?.type === "call_expression") {
          const funcNode = returnExpr.childForFieldName("function");
          if (funcNode) {
            return getText(funcNode, ctx);
          }
        } else if (returnExpr) {
          return getText(returnExpr, ctx);
        }
      }
    }
  }

  // Fallback: return the body text
  return getText(body, ctx);
}

/**
 * Analyze a step() call.
 */
function analyzeStepCall(call: SyntaxNode, ctx: AnalyzerContext): StaticStepNode {
  ctx.stats.totalSteps++;

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];
  const secondArg = args?.namedChildren[1];

  // Extract the callee (what the step executes)
  let callee = "<unknown>";
  if (firstArg) {
    if (
      firstArg.type === "arrow_function" ||
      firstArg.type === "function_expression"
    ) {
      const body = firstArg.childForFieldName("body");
      if (body) {
        callee = extractCalleeFromFunctionBody(body, ctx);
      }
    } else {
      callee = getText(firstArg, ctx);
    }
  }

  // Extract options (key, name, retry, timeout, etc.)
  const options = secondArg ? extractStepOptions(secondArg, ctx) : {};

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    callee,
    key: options.key,
    name: options.name,
    retry: options.retry,
    timeout: options.timeout,
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };

  return stepNode;
}

/**
 * Analyze a step.retry() call.
 * Actual API: step.retry(() => deps.fn(), { key, attempts, backoff, ... })
 * First argument is the operation, second is combined options with retry config.
 */
function analyzeStepRetryCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticStepNode {
  ctx.stats.totalSteps++;

  const args = call.childForFieldName("arguments");
  const argList = args?.namedChildren || [];

  // First argument is the function to execute
  const funcArg = argList[0];
  let callee = "<unknown>";
  if (funcArg) {
    if (
      funcArg.type === "arrow_function" ||
      funcArg.type === "function_expression"
    ) {
      const body = funcArg.childForFieldName("body");
      if (body) {
        callee = extractCalleeFromFunctionBody(body, ctx);
      }
    } else {
      callee = getText(funcArg, ctx);
    }
  }

  // Second argument is combined options (key, name, attempts, backoff, etc.)
  const optionsArg = argList[1];
  const options = optionsArg ? extractStepOptions(optionsArg, ctx) : {};

  // Extract retry config directly from combined options
  const retry = optionsArg ? extractRetryConfig(optionsArg, ctx) : undefined;

  return {
    id: generateId(),
    type: "step",
    callee,
    key: options.key,
    name: options.name,
    retry,
    timeout: options.timeout,
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };
}

/**
 * Analyze a step.withTimeout() call.
 * Actual API: step.withTimeout(() => deps.fn(), { key, ms, ... })
 * First argument is the operation, second is combined options with timeout config.
 */
function analyzeStepTimeoutCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticStepNode {
  ctx.stats.totalSteps++;

  const args = call.childForFieldName("arguments");
  const argList = args?.namedChildren || [];

  // First argument is the function to execute
  const funcArg = argList[0];
  let callee = "<unknown>";
  if (funcArg) {
    if (
      funcArg.type === "arrow_function" ||
      funcArg.type === "function_expression"
    ) {
      const body = funcArg.childForFieldName("body");
      if (body) {
        callee = extractCalleeFromFunctionBody(body, ctx);
      }
    } else {
      callee = getText(funcArg, ctx);
    }
  }

  // Second argument is combined options (key, name, ms, etc.)
  const optionsArg = argList[1];
  const options = optionsArg ? extractStepOptions(optionsArg, ctx) : {};

  // Extract timeout config directly from combined options
  const timeout = optionsArg ? extractTimeoutConfig(optionsArg, ctx) : undefined;

  return {
    id: generateId(),
    type: "step",
    callee,
    key: options.key,
    name: options.name,
    retry: options.retry,
    timeout,
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };
}

/**
 * Step options extracted from an object literal.
 */
interface StepOptions {
  key?: string;
  name?: string;
  retry?: StaticRetryConfig;
  timeout?: StaticTimeoutConfig;
}

/**
 * Extract step options from an object literal.
 */
function extractStepOptions(
  optionsNode: SyntaxNode,
  ctx: AnalyzerContext
): StepOptions {
  const result: StepOptions = {};

  if (optionsNode.type !== "object") {
    return result;
  }

  for (const prop of optionsNode.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);

        if (key === "key") {
          const value = extractStringValue(valueNode, ctx);
          if (value) result.key = value;
        } else if (key === "name") {
          const value = extractStringValue(valueNode, ctx);
          if (value) result.name = value;
        } else if (key === "retry") {
          result.retry = extractRetryConfig(valueNode, ctx);
        } else if (key === "timeout") {
          result.timeout = extractTimeoutConfig(valueNode, ctx);
        }
      }
    }
  }

  return result;
}

/**
 * Extract retry configuration from an object literal.
 */
function extractRetryConfig(
  node: SyntaxNode,
  ctx: AnalyzerContext
): StaticRetryConfig {
  const config: StaticRetryConfig = {};

  if (node.type !== "object") {
    return config;
  }

  for (const prop of node.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);

        if (key === "attempts") {
          const value = extractNumberValue(valueNode, ctx);
          config.attempts = value;
        } else if (key === "backoff") {
          const value = extractStringValue(valueNode, ctx);
          if (value === "fixed" || value === "linear" || value === "exponential") {
            config.backoff = value;
          } else {
            config.backoff = "<dynamic>";
          }
        } else if (key === "baseDelay") {
          const value = extractNumberValue(valueNode, ctx);
          config.baseDelay = value;
        } else if (key === "retryOn") {
          config.retryOn = getText(valueNode, ctx);
        }
      }
    }
  }

  return config;
}

/**
 * Extract timeout configuration from an object literal.
 */
function extractTimeoutConfig(
  node: SyntaxNode,
  ctx: AnalyzerContext
): StaticTimeoutConfig {
  const config: StaticTimeoutConfig = {};

  if (node.type !== "object") {
    return config;
  }

  for (const prop of node.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);

        if (key === "ms") {
          const value = extractNumberValue(valueNode, ctx);
          config.ms = value;
        }
      }
    }
  }

  return config;
}

/**
 * Extract a number value from a node.
 */
function extractNumberValue(
  node: SyntaxNode,
  ctx: AnalyzerContext
): number | "<dynamic>" {
  const text = getText(node, ctx);

  if (node.type === "number") {
    const num = parseFloat(text);
    return isNaN(num) ? "<dynamic>" : num;
  }

  return "<dynamic>";
}

// =============================================================================
// Parallel/Race Analysis
// =============================================================================

/**
 * Analyze a step.parallel() call.
 * Handles both object form: step.parallel({ key: () => ... })
 * And array form: step.parallel("name", () => allAsync([...]))
 */
function analyzeParallelCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  if (!firstArg) {
    return [];
  }

  // Array form: step.parallel("name", () => allAsync([...]))
  // or step.parallel(ParallelOps.fetchAll, () => allAsync([...]))
  // First arg is string/name/identifier, second arg is callback
  if (firstArg.type === "string" || firstArg.type === "identifier" || firstArg.type === "member_expression") {
    // Extract the name from the first argument
    // Use extractStringValue for string literals, getText for identifiers/member expressions
    const parallelName = firstArg.type === "string"
      ? extractStringValue(firstArg, ctx)
      : getText(firstArg, ctx);

    const secondArg = args?.namedChildren[1];
    if (secondArg && (secondArg.type === "arrow_function" || secondArg.type === "function_expression")) {
      // Analyze the callback body - it likely contains allAsync() or similar
      // Don't increment parallelCount here - allAsync/allSettledAsync will do it
      const analyzed = analyzeCallbackBody(secondArg, ctx);
      // The callback body analysis will produce the parallel node from allAsync()
      // Apply the name from step.parallel() to the parallel nodes
      if (analyzed.length > 0) {
        for (const node of analyzed) {
          if (node.type === "parallel" && parallelName) {
            (node as StaticParallelNode).name = parallelName;
          }
        }
        return analyzed;
      }
    }
    return [];
  }

  // Object form: step.parallel({ key: () => ... }, { name: ... })
  if (firstArg.type !== "object") {
    return [];
  }

  // Count parallel only for object form (array form counts via allAsync)
  ctx.stats.parallelCount++;

  // Extract children from the object
  const children: StaticFlowNode[] = [];

  for (const prop of firstArg.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const stepNode = analyzeParallelItem(keyNode, valueNode, ctx);
        if (stepNode) {
          children.push(stepNode);
        }
      }
    }
  }

  // Extract options from second argument (e.g., { name: 'Fetch all' })
  const secondArg = args?.namedChildren[1];
  const options = secondArg ? extractStepOptions(secondArg, ctx) : {};

  return [
    {
      id: generateId(),
      type: "parallel",
      mode: "all",
      name: options.name,
      children,
      callee: "step.parallel",
      location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
    },
  ];
}

/**
 * Analyze a single item in a parallel object.
 */
function analyzeParallelItem(
  keyNode: SyntaxNode,
  valueNode: SyntaxNode,
  ctx: AnalyzerContext
): StaticStepNode | null {
  ctx.stats.totalSteps++;

  const name = getText(keyNode, ctx);

  // Extract callee from the value (usually an arrow function)
  let callee = "<unknown>";
  if (
    valueNode.type === "arrow_function" ||
    valueNode.type === "function_expression"
  ) {
    const body = valueNode.childForFieldName("body");
    if (body?.type === "call_expression") {
      const funcNode = body.childForFieldName("function");
      if (funcNode) {
        callee = getText(funcNode, ctx);
      }
    }
  }

  return {
    id: generateId(),
    type: "step",
    callee,
    name,
    location: ctx.opts.includeLocations ? getLocation(valueNode, ctx) : undefined,
  };
}

/**
 * Analyze a step.race() call.
 */
function analyzeRaceCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.raceCount++;

  // Similar structure to parallel, but with race semantics
  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  if (!firstArg || firstArg.type !== "object") {
    return [];
  }

  const children: StaticFlowNode[] = [];

  for (const prop of firstArg.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const stepNode = analyzeParallelItem(keyNode, valueNode, ctx);
        if (stepNode) {
          children.push(stepNode);
        }
      }
    }
  }

  return [
    {
      id: generateId(),
      type: "race",
      children,
      callee: "step.race",
      location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
    },
  ];
}

// =============================================================================
// Conditional Analysis
// =============================================================================

/**
 * Analyze an if statement.
 */
function analyzeIfStatement(
  ifStmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.conditionalCount++;

  const conditionNode = ifStmt.childForFieldName("condition");
  const consequentNode = ifStmt.childForFieldName("consequence");
  const alternateNode = ifStmt.childForFieldName("alternative");

  const condition = conditionNode
    ? getText(conditionNode, ctx).replace(/^\(|\)$/g, "")
    : "<unknown>";

  const consequent = consequentNode
    ? analyzeBlock(consequentNode, ctx)
    : [];

  // Handle else clause - tree-sitter wraps else in an "else_clause" node
  let alternate: StaticFlowNode[] | undefined;
  if (alternateNode) {
    if (alternateNode.type === "else_clause") {
      // The actual content is the first named child (statement_block or another if_statement)
      const elseContent = alternateNode.namedChildren[0];
      if (elseContent) {
        alternate = analyzeBlock(elseContent, ctx);
      }
    } else {
      alternate = analyzeBlock(alternateNode, ctx);
    }
  }

  return [
    {
      id: generateId(),
      type: "conditional",
      condition,
      helper: null,
      consequent,
      alternate: alternate?.length ? alternate : undefined,
      location: ctx.opts.includeLocations ? getLocation(ifStmt, ctx) : undefined,
    },
  ];
}

/**
 * Analyze a block (statement_block or single statement).
 */
function analyzeBlock(
  node: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  if (node.type === "statement_block") {
    return analyzeStatements(node.namedChildren, ctx);
  }
  // Single statement (no braces)
  return analyzeStatement(node, ctx);
}

/**
 * Analyze a conditional helper call: when(), unless(), whenOr(), unlessOr()
 */
function analyzeConditionalHelper(
  call: SyntaxNode,
  helper: "when" | "unless" | "whenOr" | "unlessOr",
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.conditionalCount++;

  const args = call.childForFieldName("arguments");
  const argList = args?.namedChildren || [];

  // First argument is the condition
  const conditionNode = argList[0];
  const condition = conditionNode ? getText(conditionNode, ctx) : "<unknown>";

  // Second argument is the callback
  const callbackNode = argList[1];
  const consequent = callbackNode
    ? analyzeCallbackBody(callbackNode, ctx)
    : [];

  // For whenOr/unlessOr, third argument is the default value
  let defaultValue: string | undefined;
  if ((helper === "whenOr" || helper === "unlessOr") && argList[2]) {
    defaultValue = getText(argList[2], ctx);
  }

  const conditionalNode: StaticConditionalNode = {
    id: generateId(),
    type: "conditional",
    condition,
    helper,
    consequent,
    defaultValue,
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };

  return [conditionalNode];
}

/**
 * Analyze a callback body (arrow function or function expression).
 */
function analyzeCallbackBody(
  node: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  if (node.type === "arrow_function" || node.type === "function_expression") {
    const body = node.childForFieldName("body");
    if (body) {
      if (body.type === "statement_block") {
        return analyzeStatements(body.namedChildren, ctx);
      }
      // Implicit return (arrow function with expression body)
      return analyzeExpression(body, ctx);
    }
  }
  // Fallback: try to analyze as an expression
  return analyzeExpression(node, ctx);
}

/**
 * Analyze allAsync() or allSettledAsync() call.
 */
function analyzeAllAsyncCall(
  call: SyntaxNode,
  mode: "all" | "allSettled",
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.parallelCount++;

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  // allAsync expects an array of callbacks
  if (!firstArg || firstArg.type !== "array") {
    return [];
  }

  const children: StaticFlowNode[] = [];

  for (const element of firstArg.namedChildren) {
    if (element.type === "call_expression") {
      // First try to analyze as a known call (step, step.parallel, etc.)
      // This preserves metadata for step() calls
      const analyzed = analyzeCallExpression(element, ctx);
      if (analyzed.length > 0) {
        children.push(...wrapInSequence(analyzed));
      } else {
        // Fall back to implicit step for direct calls like deps.fetch()
        const implicitStep = createImplicitStepFromCall(element, ctx);
        if (implicitStep) {
          children.push(implicitStep);
        }
      }
    } else {
      // Handle callbacks: allAsync([() => step(...), () => step(...)])
      const analyzed = analyzeCallbackBody(element, ctx);
      // Wrap each branch - multiple steps become a sequence, single step stays as-is
      children.push(...wrapInSequence(analyzed));
    }
  }

  return [
    {
      id: generateId(),
      type: "parallel",
      mode,
      children,
      callee: mode === "all" ? "allAsync" : "allSettledAsync",
      location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
    },
  ];
}

/**
 * Analyze anyAsync() call.
 */
function analyzeAnyAsyncCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.raceCount++;

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  // anyAsync expects an array of callbacks
  if (!firstArg || firstArg.type !== "array") {
    return [];
  }

  const children: StaticFlowNode[] = [];

  for (const element of firstArg.namedChildren) {
    if (element.type === "call_expression") {
      // First try to analyze as a known call (step, step.parallel, etc.)
      // This preserves metadata for step() calls
      const analyzed = analyzeCallExpression(element, ctx);
      if (analyzed.length > 0) {
        children.push(...wrapInSequence(analyzed));
      } else {
        // Fall back to implicit step for direct calls like deps.fetch()
        const implicitStep = createImplicitStepFromCall(element, ctx);
        if (implicitStep) {
          children.push(implicitStep);
        }
      }
    } else {
      // Handle callbacks: anyAsync([() => step(...), () => step(...)])
      const analyzed = analyzeCallbackBody(element, ctx);
      // Wrap each branch - multiple steps become a sequence, single step stays as-is
      children.push(...wrapInSequence(analyzed));
    }
  }

  const raceNode: StaticRaceNode = {
    id: generateId(),
    type: "race",
    children,
    callee: "anyAsync",
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };

  return [raceNode];
}

/**
 * Create an implicit step node from a direct call expression.
 * Used for allAsync([deps.fetch(), deps.load()]) where calls are not wrapped in callbacks.
 */
function createImplicitStepFromCall(
  callNode: SyntaxNode,
  ctx: AnalyzerContext
): StaticStepNode | null {
  ctx.stats.totalSteps++;

  const funcNode = callNode.childForFieldName("function");
  const callee = funcNode ? getText(funcNode, ctx) : "<unknown>";

  // Try to derive a name from the callee (e.g., "deps.fetchPosts" -> "fetchPosts")
  const name = callee.includes(".") ? callee.split(".").pop() : callee;

  return {
    id: generateId(),
    type: "step",
    name,
    callee,
    location: ctx.opts.includeLocations ? getLocation(callNode, ctx) : undefined,
  };
}

// =============================================================================
// Loop Analysis
// =============================================================================

/**
 * Analyze a for statement.
 */
function analyzeForStatement(
  forStmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const bodyNode = forStmt.childForFieldName("body");
  if (!bodyNode) return [];

  const bodyChildren = analyzeBlock(bodyNode, ctx);
  if (bodyChildren.length === 0) return [];

  ctx.stats.loopCount++;

  const loopNode: StaticLoopNode = {
    id: generateId(),
    type: "loop",
    loopType: "for",
    body: bodyChildren,
    boundKnown: false,
    location: ctx.opts.includeLocations ? getLocation(forStmt, ctx) : undefined,
  };

  return [loopNode];
}

/**
 * Analyze a for-in or for-of statement.
 * Tree-sitter uses "for_in_statement" for both, distinguished by the "of" or "in" token.
 */
function analyzeForInStatement(
  forStmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const bodyNode = forStmt.childForFieldName("body");
  if (!bodyNode) return [];

  const bodyChildren = analyzeBlock(bodyNode, ctx);
  if (bodyChildren.length === 0) return [];

  ctx.stats.loopCount++;

  // Determine if it's for-of or for-in by checking for "of" keyword
  const stmtText = getText(forStmt, ctx);
  const isForOf = stmtText.includes(" of ");

  // Extract the iteration source (the thing being iterated)
  const rightNode = forStmt.childForFieldName("right");
  const iterSource = rightNode ? getText(rightNode, ctx) : undefined;

  const loopNode: StaticLoopNode = {
    id: generateId(),
    type: "loop",
    loopType: isForOf ? "for-of" : "for-in",
    iterSource,
    body: bodyChildren,
    boundKnown: false,
    location: ctx.opts.includeLocations ? getLocation(forStmt, ctx) : undefined,
  };

  return [loopNode];
}

/**
 * Analyze a while statement.
 */
function analyzeWhileStatement(
  whileStmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const bodyNode = whileStmt.childForFieldName("body");
  if (!bodyNode) return [];

  const bodyChildren = analyzeBlock(bodyNode, ctx);
  if (bodyChildren.length === 0) return [];

  ctx.stats.loopCount++;

  const loopNode: StaticLoopNode = {
    id: generateId(),
    type: "loop",
    loopType: "while",
    body: bodyChildren,
    boundKnown: false,
    location: ctx.opts.includeLocations ? getLocation(whileStmt, ctx) : undefined,
  };

  return [loopNode];
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get the text content of a node.
 */
function getText(node: SyntaxNode, ctx: AnalyzerContext): string {
  return ctx.sourceCode.slice(node.startIndex, node.endIndex);
}

/**
 * Extract a string value from a node (handling quotes).
 */
function extractStringValue(
  node: SyntaxNode,
  ctx: AnalyzerContext
): string | undefined {
  const text = getText(node, ctx);

  // Handle string literals
  if (node.type === "string") {
    // Remove quotes
    return text.slice(1, -1);
  }

  // Handle template literals
  if (node.type === "template_string") {
    return "<dynamic>";
  }

  return text;
}

/**
 * Get source location for a node.
 */
function getLocation(node: SyntaxNode, ctx: AnalyzerContext): SourceLocation {
  return {
    filePath: ctx.filePath,
    line: node.startPosition.row + 1, // 0-indexed to 1-indexed
    column: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
}

/**
 * Traverse all nodes in the AST.
 */
function traverseNode(
  node: SyntaxNode,
  callback: (node: SyntaxNode) => void
): void {
  callback(node);
  for (const child of node.namedChildren) {
    traverseNode(child, callback);
  }
}

/**
 * Wrap nodes in a sequence if there are multiple.
 */
function wrapInSequence(nodes: StaticFlowNode[]): StaticFlowNode[] {
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

/**
 * Create empty stats object.
 */
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

/**
 * Generate a unique ID.
 */
let idCounter = 0;
function generateId(): string {
  return `ts-${++idCounter}`;
}

/**
 * Reset the ID counter (for testing).
 */
export function resetIdCounter(): void {
  idCounter = 0;
}
