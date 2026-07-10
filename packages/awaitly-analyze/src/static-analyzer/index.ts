/**
 * Static Workflow Analyzer
 *
 * Uses ts-morph to walk the TypeScript AST and extract workflow structure
 * without executing the code. This enables:
 * - Understanding all possible execution paths
 * - Generating test coverage matrices
 * - Creating documentation
 * - Calculating complexity metrics
 * - Extracting type information (input types, result types, error types)
 */

import { existsSync } from "fs";
import { extname } from "path";

// Type-only imports - erased at compile time, no runtime dependency
// These provide type checking without creating a runtime dependency on ts-morph
import type { SourceFile, Project, Node } from "ts-morph";
import type * as ts from "typescript";
import { loadTsMorph } from "../ts-morph-loader";

import {
  extractFunctionName,
  type StaticWorkflowIR,
  type StaticWorkflowNode,
  type StaticFlowNode,
  type StaticStepNode,
  type StaticSequenceNode,
  type StaticParallelNode,
  type StaticRaceNode,
  type StaticConditionalNode,
  type StaticDecisionNode,
  type StaticLoopNode,
  type StaticWorkflowRefNode,
  type StaticStreamNode,
  type StaticSagaStepNode,
  type StaticSwitchNode,
  type StaticSwitchCase,
  type AnalysisWarning,
  type AnalysisStats,
} from "../types";

import { generateId, getLocation, type AnalyzerOptions } from "./shared";
import {
  findWorkflowCalls,
  findWorkflowInvocations,
  type WorkflowCallInfo,
} from "./discovery";
import {
  extractBoundStepsInfo,
  extractSagaParameterInfo,
  extractStepParameterInfo,
  type AnalysisContext,
  type BoundStepsInfo,
  type SagaContext,
  type StepParameterInfo,
} from "./bindings";
import {
  attachStepDocsAndDepLocation,
  extractErrorsArray,
  extractRetryConfig,
  extractStepOptions,
  extractStringValue,
  extractTimeoutConfig,
  extractWorkflowDocumentation,
  extractWorkflowStrictOptions,
  getContainingStatement,
  getDefinitionLocationForCallee,
  getJSDocDescriptionFromNode,
  getJSDocTagsFromNode,
} from "./step-options";
import {
  enrichStepDepSource,
  enrichStepOutputTypes,
  enrichStepReadTypes,
  extractDependencies,
  extractErrorTypes,
  inferErrorsFromErrorTypeInfo,
  inferStepIOFromInnerCall,
} from "./deps-types";

// Re-exported so everything previously importable from this module keeps working.
export type { AnalyzerOptions } from "./shared";
export { resetIdCounter } from "./shared";

// =============================================================================
// Default Options
// =============================================================================

const DEFAULT_OPTIONS: Required<AnalyzerOptions> = {
  tsConfigPath: "./tsconfig.json",
  resolveReferences: true,
  maxReferenceDepth: 5,
  includeLocations: true,
  assumeImported: false,
  detect: "all",
};

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Validate file path before analysis.
 */
function validateFilePath(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(
      `File not found: ${filePath}\n\n` +
        `Ensure the path is correct and the file exists.`
    );
  }

  const ext = extname(filePath).toLowerCase();
  if (ext !== ".ts" && ext !== ".tsx") {
    throw new Error(
      `Invalid file type: ${ext}\n\n` +
        `awaitly-analyze only supports TypeScript files (.ts, .tsx).`
    );
  }
}

/**
 * Validate analyzer options.
 */
function validateOptions(options: AnalyzerOptions): void {
  if (options.maxReferenceDepth !== undefined && options.maxReferenceDepth < 1) {
    throw new Error(
      `Invalid maxReferenceDepth: ${options.maxReferenceDepth}\n\n` +
        `maxReferenceDepth must be at least 1.`
    );
  }

  if (options.tsConfigPath && !existsSync(options.tsConfigPath)) {
    throw new Error(
      `tsconfig not found: ${options.tsConfigPath}\n\n` +
        `Check the path or omit tsConfigPath to use default.`
    );
  }
}

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
  // Validate inputs before processing
  validateFilePath(filePath);
  validateOptions(options);

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { ts } = loadTsMorph();

  // Create ts-morph project
  const project = createProject(opts);
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Find workflow calls
  const workflows = findWorkflowCalls(sourceFile, opts);

  if (workflows.length === 0) {
    throw new Error(`No workflow calls found in ${filePath}`);
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

/**
 * Analyze all workflows in a file and return them as an array.
 * This matches the old tree-sitter API signature.
 *
 * @param filePath - Path to the TypeScript file containing the workflow(s)
 * @param options - Analysis options
 * @returns Array of Static workflow IRs
 */
export function analyzeWorkflowFile(
  filePath: string,
  options: AnalyzerOptions = {}
): StaticWorkflowIR[] {
  // Validate inputs before processing
  validateFilePath(filePath);
  validateOptions(options);

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { ts } = loadTsMorph();

  // Create ts-morph project
  const project = createProject(opts);
  const sourceFile = project.addSourceFileAtPath(filePath);

  // Find workflow calls
  const workflows = findWorkflowCalls(sourceFile, opts);

  if (workflows.length === 0) {
    return [];
  }

  const results: StaticWorkflowIR[] = [];

  for (const workflow of workflows) {
    const warnings: AnalysisWarning[] = [];
    const stats = createEmptyStats();

    const rootNode = analyzeWorkflowCall(
      workflow,
      sourceFile,
      opts,
      warnings,
      stats
    );

    results.push({
      root: rootNode,
      metadata: {
        analyzedAt: Date.now(),
        filePath,
        tsVersion: ts.version,
        warnings,
        stats,
      },
      references: new Map(),
    });
  }

  return results;
}

/**
 * Analyze workflow source code directly (for testing).
 *
 * @param sourceCode - TypeScript source code
 * @param workflowName - Optional name of specific workflow to analyze
 * @param options - Analysis options
 * @returns Array of Static workflow IRs
 */
export function analyzeWorkflowSource(
  sourceCode: string,
  workflowName?: string,
  options: AnalyzerOptions = {}
): StaticWorkflowIR[] {
  // Default to assumeImported: true for source analysis (testing scenarios)
  const opts = { ...DEFAULT_OPTIONS, assumeImported: true, ...options };
  const { ts, Project: TsMorphProject } = loadTsMorph();

  // Create ts-morph project with in-memory source
  const project = new TsMorphProject({
    useInMemoryFileSystem: true,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      esModuleInterop: true,
    },
  });

  const sourceFile = project.createSourceFile("workflow.ts", sourceCode);

  // Find workflow calls
  const workflows = findWorkflowCalls(sourceFile, opts);

  if (workflows.length === 0) {
    return [];
  }

  // Filter by name if specified
  const targetWorkflows = workflowName
    ? workflows.filter((w) => w.name === workflowName)
    : workflows;

  const results: StaticWorkflowIR[] = [];

  for (const workflow of targetWorkflows) {
    const warnings: AnalysisWarning[] = [];
    const stats = createEmptyStats();

    const rootNode = analyzeWorkflowCall(
      workflow,
      sourceFile,
      opts,
      warnings,
      stats
    );

    results.push({
      root: rootNode,
      metadata: {
        analyzedAt: Date.now(),
        filePath: "<source>",
        tsVersion: ts.version,
        warnings,
        stats,
      },
      references: new Map(),
    });
  }

  return results;
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
// Workflow Analysis
// =============================================================================

function analyzeWorkflowCall(
  workflowInfo: WorkflowCallInfo,
  sourceFile: SourceFile,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticWorkflowNode {
  const { name, callExpression, depsObject, optionsObject, source } = workflowInfo;

  // Track saga workflows
  if (source === "createSagaWorkflow" || source === "runSaga") {
    stats.sagaWorkflowCount = (stats.sagaWorkflowCount || 0) + 1;
  }

  // Extract dependencies
  const dependencies = depsObject
    ? extractDependencies(depsObject, warnings)
    : [];

  // Extract error types from dependencies
  const errorTypes = extractErrorTypes(dependencies);

  // Extract workflow documentation from options or deps object
  // (description and markdown can be in either place)
  const optionsDocs = optionsObject
    ? extractWorkflowDocumentation(optionsObject)
    : { description: undefined, markdown: undefined };
  const depsDocs = depsObject
    ? extractWorkflowDocumentation(depsObject)
    : { description: undefined, markdown: undefined };

  // Merge docs - prefer options, fall back to deps
  const workflowDocs = {
    description: optionsDocs.description || depsDocs.description,
    markdown: optionsDocs.markdown || depsDocs.markdown,
  };

  // Extract strict mode and declared errors from options or deps
  const workflowStrict = optionsObject
    ? extractWorkflowStrictOptions(optionsObject)
    : depsObject
      ? extractWorkflowStrictOptions(depsObject)
      : { strict: undefined, declaredErrors: undefined };

  // Determine saga context for proper step detection
  const isSagaWorkflow = source === "createSagaWorkflow" || source === "runSaga";
  const sagaContext: SagaContext = { isSagaWorkflow };

  // For run() and runSaga(), the callback is already in callbackFunction
  const children: StaticFlowNode[] = [];
  let callbackForReturnType: Node | undefined;

  if (source === "run" || source === "runSaga") {
    callbackForReturnType = workflowInfo.callbackFunction;
    // run() and runSaga() have the callback as the first argument
    if (workflowInfo.callbackFunction) {
      // Extract saga parameter info for runSaga
      if (source === "runSaga") {
        sagaContext.sagaParamInfo = extractSagaParameterInfo(workflowInfo.callbackFunction);
      }
      // Deps-first form run(deps, fn): the first callback param is the
      // bound-steps object, not { step } — use bound-steps detection.
      const boundStepsInfo =
        source === "run" && depsObject
          ? extractBoundStepsInfo(workflowInfo.callbackFunction)
          : undefined;
      // Extract step parameter info for proper step detection
      const stepParamInfo = boundStepsInfo
        ? undefined
        : extractStepParameterInfo(workflowInfo.callbackFunction);
      const analyzed = analyzeCallback(
        workflowInfo.callbackFunction,
        opts,
        warnings,
        stats,
        sagaContext,
        stepParamInfo,
        boundStepsInfo
      );
      children.push(...analyzed);
    }
  } else {
    // For createWorkflow and createSagaWorkflow, find invocations
    const invocations = findWorkflowInvocations(workflowInfo, sourceFile);
    if (invocations.length > 0 && invocations[0].callbackArg) {
      callbackForReturnType = invocations[0].callbackArg;
    }
    for (const invocation of invocations) {
      const callback = invocation.callbackArg;
      if (callback) {
        // Extract saga parameter info for saga workflows
        if (isSagaWorkflow) {
          sagaContext.sagaParamInfo = extractSagaParameterInfo(callback);
        }
        // Extract step parameter info for all workflows
        const stepParamInfo = extractStepParameterInfo(callback);
        const analyzed = analyzeCallback(callback, opts, warnings, stats, sagaContext, stepParamInfo);
        children.push(...analyzed);
      }
    }
  }

  const root: StaticWorkflowNode = {
    id: generateId(),
    type: "workflow",
    workflowName: name,
    source,
    dependencies,
    errorTypes,
    children,
    description: workflowDocs.description,
    markdown: workflowDocs.markdown,
    location: opts.includeLocations ? getLocation(callExpression) : undefined,
    strict: workflowStrict.strict,
    declaredErrors: workflowStrict.declaredErrors,
  };

  // Best-effort: workflow callback return type (inline callback or callback-by-identifier).
  // Prefer type checker so we get User, Enriched etc. instead of any.
  try {
    const inferred =
      callbackForReturnType &&
      getWorkflowCallbackReturnTypeFromChecker(callbackForReturnType, sourceFile);
    if (inferred) {
      root.workflowReturnType = inferred;
    } else if (callbackForReturnType) {
      const fallback = getWorkflowCallbackReturnType(callbackForReturnType);
      if (fallback) root.workflowReturnType = fallback;
    }
  } catch {
    // ignore
  }

  enrichStepReadTypes(root);
  enrichStepOutputTypes(root);
  inferErrorsFromErrorTypeInfo(root);
  enrichStepDepSource(root);

  if (workflowInfo.variableDeclaration) {
    const decl = workflowInfo.variableDeclaration as { getVariableStatement?: () => Node };
    const statement =
      typeof decl.getVariableStatement === "function"
        ? decl.getVariableStatement()
        : (() => {
            const { Node } = loadTsMorph();
            const parent = workflowInfo.variableDeclaration.getParent();
            return Node.isVariableStatement(parent) ? parent : workflowInfo.variableDeclaration;
          })();
    if (statement) {
      const jsdoc = getJSDocDescriptionFromNode(statement);
      if (jsdoc) root.jsdocDescription = jsdoc;
      const tags = getJSDocTagsFromNode(statement);
      if (tags) {
        if (tags.params?.length) root.jsdocParams = tags.params;
        if (tags.returns) root.jsdocReturns = tags.returns;
        if (tags.throws?.length) root.jsdocThrows = tags.throws;
        if (tags.example) root.jsdocExample = tags.example;
      }
    }
  }

  return root;
}

/**
 * Infer workflow callback return type using the TypeScript type checker.
 * Preserves type aliases (e.g. User, Enriched) instead of expanding to object shapes with any.
 */
function getWorkflowCallbackReturnTypeFromChecker(
  cb: Node,
  sourceFile: SourceFile
): string | undefined {
  const { Node } = loadTsMorph();
  let node: Node = cb;
  while (Node.isParenthesizedExpression(node)) {
    node = node.getExpression();
  }
  try {
    const project = sourceFile.getProject();
    const typeChecker = project.getTypeChecker();
    const tc = typeChecker.compilerObject as ts.TypeChecker;
    const tsNode = (node as unknown as { compilerNode: ts.Node }).compilerNode;
    const type = tc.getTypeAtLocation(tsNode);
    const callSigs = type.getCallSignatures?.() ?? [];
    const sig = callSigs[0];
    if (!sig) return undefined;
    const returnType = sig.getReturnType();
    return tc.typeToString(returnType);
  } catch {
    return undefined;
  }
}

/**
 * Infer workflow callback return type from the callback node (inline function or identifier).
 * When the callback is passed by identifier (e.g. workflow(callback)), resolves to the
 * declaration and gets return type from the initializer or function declaration.
 * Uses type node text (may expand to any); prefer getWorkflowCallbackReturnTypeFromChecker when
 * type checker is available to preserve type aliases.
 */
function getWorkflowCallbackReturnType(cb: Node | undefined): string | undefined {
  if (!cb) return undefined;
  const { Node } = loadTsMorph();
  let node: Node = cb;
  while (Node.isParenthesizedExpression(node)) {
    node = node.getExpression();
  }
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const ret = (node as { getReturnType?: () => { getText: () => string } }).getReturnType?.();
    return ret?.getText();
  }
  if (Node.isIdentifier(node)) {
    const ident = node as { getDefinitionNodes?: () => Node[] };
    const defNodes = ident.getDefinitionNodes?.();
    if (!defNodes?.length) return undefined;
    for (const def of defNodes) {
      if (Node.isVariableDeclaration(def)) {
        const init = def.getInitializer();
        if (!init) break;
        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          const ret = (init as { getReturnType?: () => { getText: () => string } }).getReturnType?.();
          if (ret) return ret.getText();
        } else if (Node.isIdentifier(init)) {
          // One alias hop: const callback = handler -> resolve handler to get return type
          return getWorkflowCallbackReturnType(init);
        }
        break;
      }
      if (Node.isFunctionDeclaration(def)) {
        const ret = (def as { getReturnType?: () => { getText: () => string } }).getReturnType?.();
        if (ret) return ret.getText();
        break;
      }
    }
  }
  return undefined;
}

// =============================================================================
// Callback Analysis
// =============================================================================

function analyzeCallback(
  callback: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepParamInfo?: StepParameterInfo,
  boundStepsInfo?: BoundStepsInfo
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

  // Build analysis context from step parameter info
  const context: AnalysisContext = { stepNames: new Set(), isInWorkflowCallback: true, depth: 0 };
  if (boundStepsInfo) {
    // Deps-first form: first param is the bound-steps object; the classic
    // step (escape hatch) comes from the second param's destructuring.
    context.boundSteps = boundStepsInfo;
    if (boundStepsInfo.stepAlias) {
      context.stepNames.add(boundStepsInfo.stepAlias);
    }
  } else if (stepParamInfo) {
    if (stepParamInfo.isDestructured && stepParamInfo.stepAlias) {
      context.stepNames.add(stepParamInfo.stepAlias);
    } else if (stepParamInfo.name) {
      context.stepNames.add(stepParamInfo.name);
    }
    // Workflow bound steps: ({ steps }) or ({ steps: { getUser } })
    if (stepParamInfo.stepsAlias || stepParamInfo.stepsBareAliases) {
      context.boundSteps = {
        objectNames: stepParamInfo.stepsAlias
          ? new Set([stepParamInfo.stepsAlias])
          : new Set(),
        bareAliases: stepParamInfo.stepsBareAliases ?? new Map(),
      };
    }
  }
  // Default to "step" if no explicit parameter info
  if (context.stepNames.size === 0) {
    context.stepNames.add("step");
  }

  // Analyze the body with workflow callback context
  return analyzeNode(body, opts, warnings, stats, sagaContext, context);
}

function analyzeNode(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  const results: StaticFlowNode[] = [];

  // Handle block statement
  if (Node.isBlock(node)) {
    for (const statement of node.getStatements()) {
      results.push(...analyzeNode(statement, opts, warnings, stats, sagaContext, context));
    }
    return wrapInSequence(results, opts);
  }

  // Handle expression statement (e.g., await step(...))
  if (Node.isExpressionStatement(node)) {
    return analyzeNode(node.getExpression(), opts, warnings, stats, sagaContext, context);
  }

  // Handle await expression
  if (Node.isAwaitExpression(node)) {
    return analyzeNode(node.getExpression(), opts, warnings, stats, sagaContext, context);
  }

  // Handle parenthesized expression (e.g., (step(...)))
  if (Node.isParenthesizedExpression(node)) {
    return analyzeNode(node.getExpression(), opts, warnings, stats, sagaContext, context);
  }

  // Handle variable declaration (const result = await step(...))
  if (Node.isVariableStatement(node)) {
    for (const decl of node.getDeclarationList().getDeclarations()) {
      const initializer = decl.getInitializer();
      if (initializer) {
        results.push(...analyzeNode(initializer, opts, warnings, stats, sagaContext, context));
      }
    }
    return results;
  }

  // Handle individual variable declaration (for nested function expressions)
  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (initializer) {
      // If initializer is a function expression, traverse into its body
      // Keep isInWorkflowCallback if already in callback (for tree-sitter parity)
      if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
        const body = initializer.getBody();
        const nestedContext: AnalysisContext = { 
          ...context, 
          isInWorkflowCallback: context.isInWorkflowCallback, 
          depth: context.depth + 1 
        };
        results.push(...analyzeNode(body, opts, warnings, stats, sagaContext, nestedContext));
      } else {
        // Otherwise analyze the initializer normally
        results.push(...analyzeNode(initializer, opts, warnings, stats, sagaContext, context));
      }
    }
    return results;
  }

  // Handle call expression
  if (Node.isCallExpression(node)) {
    const analyzed = analyzeCallExpression(node, opts, warnings, stats, sagaContext, context);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle if statement
  if (Node.isIfStatement(node)) {
    const analyzed = analyzeIfStatement(node, opts, warnings, stats, sagaContext, context);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle switch statement
  if (Node.isSwitchStatement(node)) {
    const analyzed = analyzeSwitchStatement(node, opts, warnings, stats, sagaContext, context);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for statement
  if (Node.isForStatement(node)) {
    const analyzed = analyzeForStatement(node, opts, warnings, stats, sagaContext, context);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for-of statement
  if (Node.isForOfStatement(node)) {
    const analyzed = analyzeForOfStatement(node, opts, warnings, stats, sagaContext, context);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for-in statement
  if (Node.isForInStatement(node)) {
    const analyzed = analyzeForInStatement(node, opts, warnings, stats, sagaContext, context);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle while statement
  if (Node.isWhileStatement(node)) {
    const analyzed = analyzeWhileStatement(node, opts, warnings, stats, sagaContext, context);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle try statement
  if (Node.isTryStatement(node)) {
    const analyzed = analyzeTryStatement(node, opts, warnings, stats, sagaContext, context);
    results.push(...analyzed);
    return results;
  }

  // Handle return statement
  if (Node.isReturnStatement(node)) {
    const expr = node.getExpression();
    if (expr) {
      return analyzeNode(expr, opts, warnings, stats, sagaContext, context);
    }
    return results;
  }

  // Handle ternary/conditional expression
  if (Node.isConditionalExpression(node)) {
    const whenTrue = analyzeNode(node.getWhenTrue(), opts, warnings, stats, sagaContext, context);
    const whenFalse = analyzeNode(node.getWhenFalse(), opts, warnings, stats, sagaContext, context);
    results.push(...whenTrue, ...whenFalse);
    return results;
  }

  // Handle array literal (for Promise.all etc.)
  if (Node.isArrayLiteralExpression(node)) {
    for (const element of node.getElements()) {
      results.push(...analyzeNode(element, opts, warnings, stats, sagaContext, context));
    }
    return results;
  }

  // Handle object literal (for step definitions in objects) - recursively handle nested objects
  if (Node.isObjectLiteralExpression(node)) {
    for (const prop of node.getProperties()) {
      if (Node.isPropertyAssignment(prop)) {
        const init = prop.getInitializer();
        if (init) {
          // Check if the initializer is a function that contains steps
          if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
            const body = init.getBody();
            // Keep isInWorkflowCallback if already in callback (for tree-sitter parity)
            const nestedContext: AnalysisContext = { 
              ...context, 
              isInWorkflowCallback: context.isInWorkflowCallback, 
              depth: context.depth + 1 
            };
            results.push(...analyzeNode(body, opts, warnings, stats, sagaContext, nestedContext));
          } else if (Node.isObjectLiteralExpression(init)) {
            // Recursively analyze nested objects
            results.push(...analyzeNode(init, opts, warnings, stats, sagaContext, context));
          } else if (Node.isCallExpression(init)) {
            // Handle call expressions like tool({...}) - analyze their arguments
            for (const arg of init.getArguments()) {
              results.push(...analyzeNode(arg, opts, warnings, stats, sagaContext, context));
            }
          }
        }
      } else if (Node.isMethodDeclaration(prop)) {
        // Handle object methods like { async foo() { ... } }
        const body = prop.getBody();
        if (body) {
          // Keep isInWorkflowCallback if already in callback (for tree-sitter parity)
          const nestedContext: AnalysisContext = { 
            ...context, 
            isInWorkflowCallback: context.isInWorkflowCallback, 
            depth: context.depth + 1 
          };
          results.push(...analyzeNode(body, opts, warnings, stats, sagaContext, nestedContext));
        }
      }
    }
    return results;
  }

  // Handle arrow functions and function expressions (nested functions with step calls)
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    // Keep isInWorkflowCallback if already in callback (for tree-sitter parity)
    // Only reset if at top level (depth 0)
    const nestedContext: AnalysisContext = { 
      ...context, 
      isInWorkflowCallback: context.isInWorkflowCallback, 
      depth: context.depth + 1 
    };
    return analyzeNode(body, opts, warnings, stats, sagaContext, nestedContext);
  }

  if (Node.isFunctionExpression(node)) {
    const body = node.getBody();
    // Keep isInWorkflowCallback if already in callback (for tree-sitter parity)
    // Only reset if at top level (depth 0)
    const nestedContext: AnalysisContext = { 
      ...context, 
      isInWorkflowCallback: context.isInWorkflowCallback, 
      depth: context.depth + 1 
    };
    return analyzeNode(body, opts, warnings, stats, sagaContext, nestedContext);
  }

  return results;
}

/**
 * Analyze try-catch-finally statements.
 */
function analyzeTryStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext,
  context: AnalysisContext
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  if (!Node.isTryStatement(node)) return [];

  const results: StaticFlowNode[] = [];

  // Analyze try block
  const tryBlock = node.getTryBlock();
  results.push(...analyzeNode(tryBlock, opts, warnings, stats, sagaContext, context));

  // Analyze catch clause
  const catchClause = node.getCatchClause();
  if (catchClause) {
    results.push(...analyzeNode(catchClause.getBlock(), opts, warnings, stats, sagaContext, context));
  }

  // Analyze finally block
  const finallyBlock = node.getFinallyBlock();
  if (finallyBlock) {
    results.push(...analyzeNode(finallyBlock, opts, warnings, stats, sagaContext, context));
  }

  // Note: tree-sitter does NOT count try-catch as a conditional
  // It only counts the statements inside (like if statements)

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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: true, depth: 0 }
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  // Handle arrow function (e.g., () => step(...))
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    return analyzeNode(body, opts, warnings, stats, sagaContext, context);
  }

  // Handle function expression (e.g., function() { step(...) })
  if (Node.isFunctionExpression(node)) {
    const body = node.getBody();
    return analyzeNode(body, opts, warnings, stats, sagaContext, context);
  }

  // Fallback: try analyzing as a regular node (e.g., a direct call expression)
  return analyzeNode(node, opts, warnings, stats, sagaContext, context);
}

// =============================================================================
// Call Expression Analysis
// =============================================================================

/** Everything a step-method handler may need, bundled once at dispatch. */
interface StepMethodHandlerArgs {
  node: Node;
  args: Node[];
  opts: Required<AnalyzerOptions>;
  warnings: AnalysisWarning[];
  stats: AnalysisStats;
  sagaContext: SagaContext;
  context: AnalysisContext;
}

/** step.withResource(): step node plus acquire/use/release extraction. */
function analyzeStepWithResourceCall(h: StepMethodHandlerArgs): StaticStepNode {
  const { Node } = loadTsMorph();
  const stepNode = analyzeStepCall(h.node, h.args, h.opts, h.warnings, h.stats, {
    displayCallee: "step.withResource",
  });
  stepNode.stepKind = "withResource";
  // Parse options object for acquire/use/release and attach resourceOps
  if (h.args[1] && Node.isObjectLiteralExpression(h.args[1])) {
    const resourceOps: { acquire?: string; use?: string; release?: string } = {};
    for (const prop of h.args[1].getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;
      const key = prop.getName();
      if (key !== "acquire" && key !== "use" && key !== "release") continue;
      const init = prop.getInitializer();
      if (init) {
        const calleeStr = extractCalleeFromResourceCallback(init);
        if (calleeStr) resourceOps[key as "acquire" | "use" | "release"] = calleeStr;
      }
    }
    if (Object.keys(resourceOps).length > 0) stepNode.resourceOps = resourceOps;
  }
  return stepNode;
}

/** step.workflow(): step node, sequenced with any getter-callback results. */
function analyzeStepWorkflowCall(h: StepMethodHandlerArgs): StaticFlowNode {
  const getterResults = h.args[1]
    ? analyzeCallbackArgument(h.args[1], h.opts, h.warnings, h.stats, h.sagaContext, h.context)
    : [];
  const stepNode = analyzeStepCall(h.node, h.args, h.opts, h.warnings, h.stats, {
    displayCallee: "step.workflow",
  });
  if (getterResults.length === 0) return stepNode;
  return {
    id: generateId(),
    type: "sequence",
    children: [stepNode, ...getterResults],
  } as StaticSequenceNode;
}

/**
 * Dispatch table for `step.<method>()` calls. Adding a step method to the
 * analyzer is one table row here — not another branch in
 * analyzeCallExpression.
 */
const STEP_METHOD_HANDLERS: Record<
  string,
  (h: StepMethodHandlerArgs) => StaticFlowNode | undefined
> = {
  sleep: (h) => analyzeStepSleepCall(h.node, h.args, h.opts, h.stats),
  retry: (h) => analyzeStepRetryCall(h.node, h.args, h.opts, h.warnings, h.stats),
  withTimeout: (h) => analyzeStepTimeoutCall(h.node, h.args, h.opts, h.warnings, h.stats),
  try: (h) => analyzeStepTryCall(h.node, h.args, h.opts, h.warnings, h.stats),
  fromResult: (h) => analyzeStepFromResultCall(h.node, h.args, h.opts, h.warnings, h.stats),
  withFallback: (h) =>
    analyzeStepCall(h.node, h.args, h.opts, h.warnings, h.stats, { displayCallee: "step.withFallback" }),
  withResource: analyzeStepWithResourceCall,
  workflow: analyzeStepWorkflowCall,
  // Effect-style ergonomics methods
  run: (h) => analyzeStepCall(h.node, h.args, h.opts, h.warnings, h.stats, { displayCallee: "step.run" }),
  andThen: (h) =>
    analyzeStepCall(h.node, h.args, h.opts, h.warnings, h.stats, { displayCallee: "step.andThen" }),
  match: (h) =>
    analyzeStepCall(h.node, h.args, h.opts, h.warnings, h.stats, { displayCallee: "step.match" }),
  map: (h) => analyzeStepCall(h.node, h.args, h.opts, h.warnings, h.stats, { displayCallee: "step.map" }),
  // Parallel / race / iteration
  all: (h) => analyzeParallelCall(h.node, h.args, "all", h.opts, h.warnings, h.stats, h.sagaContext, h.context),
  allSettled: (h) =>
    analyzeParallelCall(h.node, h.args, "allSettled", h.opts, h.warnings, h.stats, h.sagaContext, h.context),
  parallel: (h) =>
    analyzeParallelCall(h.node, h.args, "all", h.opts, h.warnings, h.stats, h.sagaContext, h.context),
  race: (h) => analyzeRaceCall(h.node, h.args, h.opts, h.warnings, h.stats, h.sagaContext, h.context),
  forEach: (h) =>
    analyzeStepForEachCall(h.node, h.args, h.opts, h.warnings, h.stats, h.sagaContext, h.context),
  branch: (h) =>
    analyzeStepBranchCall(h.node, h.args, h.opts, h.warnings, h.stats, h.sagaContext, h.context),
  // Streaming operations
  getWritable: (h) => analyzeStreamCall(h.node, "write", h.opts, h.stats),
  getReadable: (h) => analyzeStreamCall(h.node, "read", h.opts, h.stats),
  streamForEach: (h) => analyzeStreamCall(h.node, "forEach", h.opts, h.stats),
};

function analyzeCallExpression(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticFlowNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isCallExpression(node)) return undefined;

  const expression = node.getExpression();
  const callee = expression.getText();
  const args = node.getArguments();

  // Handle saga workflow step detection
          if (sagaContext.isSagaWorkflow && sagaContext.sagaParamInfo) {
    const sagaParam = sagaContext.sagaParamInfo;

    if (sagaParam.isDestructured && sagaParam.sagaAlias) {
      if (callee === `${sagaParam.sagaAlias}.step`) {
        return analyzeSagaStepCall(node, args, false, opts, warnings, stats);
      }
      if (callee === `${sagaParam.sagaAlias}.tryStep`) {
        return analyzeSagaStepCall(node, args, true, opts, warnings, stats);
      }
    }
    if (sagaParam.isDestructured) {
      if (sagaParam.stepAlias && callee === sagaParam.stepAlias) {
        return analyzeSagaStepCall(node, args, false, opts, warnings, stats);
      }
      if (sagaParam.tryStepAlias && callee === sagaParam.tryStepAlias) {
        return analyzeSagaStepCall(node, args, true, opts, warnings, stats);
      }
    } else if (sagaParam.name) {
      // Non-destructured form: saga.step() or saga.tryStep()
      if (callee === `${sagaParam.name}.step`) {
        return analyzeSagaStepCall(node, args, false, opts, warnings, stats);
      }
      if (callee === `${sagaParam.name}.tryStep`) {
        return analyzeSagaStepCall(node, args, true, opts, warnings, stats);
      }
    }
  }

  // Deps-first bound step calls from run(deps, fn):
  //   s.getOrder(id)          — property access on the steps object
  //   getOrder(id)            — destructured binding ({ getOrder }) => ...
  // Step ID = the dep key. Checked before classic step handling so a steps
  // object named like the step param can't be misread; the classic escape
  // hatch (s, { step }) still routes through stepNames below.
  if (context.boundSteps) {
    if (Node.isPropertyAccessExpression(expression)) {
      const objText = expression.getExpression().getText();
      if (context.boundSteps.objectNames.has(objText)) {
        return analyzeBoundStepCall(node, expression.getName(), opts, stats);
      }
    } else if (Node.isIdentifier(expression)) {
      const depKey = context.boundSteps.bareAliases.get(callee);
      if (depKey) {
        return analyzeBoundStepCall(node, depKey, opts, stats);
      }
    }
  }

  // Check for step calls using custom step parameter names
  const isStepCall = isStepFunctionCall(callee, context);

  // step() call (regular workflow) - use context to match custom parameter names
  if (isStepCall) {
    return analyzeStepCall(node, args, opts, warnings, stats);
  }

  // step.<method>() calls — dispatched via STEP_METHOD_HANDLERS. Matches the
  // property access structurally: the object must be a known step name and
  // the method a registered handler.
  if (Node.isPropertyAccessExpression(expression)) {
    const objectName = expression.getExpression().getText();
    if (context.stepNames.has(objectName)) {
      const handler = STEP_METHOD_HANDLERS[expression.getName()];
      if (handler) {
        return handler({ node, args, opts, warnings, stats, sagaContext, context });
      }
    }
  }

  // allAsync() call
  if (callee === "allAsync") {
    return analyzeAllAsyncCall(node, args, "all", opts, warnings, stats, sagaContext, context);
  }

  // allSettledAsync() call
  if (callee === "allSettledAsync") {
    return analyzeAllAsyncCall(node, args, "allSettled", opts, warnings, stats, sagaContext, context);
  }

  // anyAsync() call
  if (callee === "anyAsync") {
    return analyzeAnyAsyncCall(node, args, opts, warnings, stats, sagaContext, context);
  }

  // when() / unless() / whenOr() / unlessOr() calls
  if (["when", "unless", "whenOr", "unlessOr"].includes(callee)) {
    return analyzeConditionalHelper(
      node,
      callee as "when" | "unless" | "whenOr" | "unlessOr",
      args,
      opts,
      warnings,
      stats,
      sagaContext,
      context
    );
  }

  // Promise.all() - treat like allAsync for step detection
  if (callee === "Promise.all") {
    return analyzePromiseAllCall(node, args, opts, warnings, stats, sagaContext, context);
  }

  // Handle method calls with callbacks (e.g., .map(), .forEach(), .filter(), etc.)
  // These might contain step calls in their callback arguments
  // NOTE: This must come BEFORE isLikelyWorkflowCall check, since methods with callbacks also match that pattern
  if (Node.isPropertyAccessExpression(expression)) {
    const methodName = expression.getName();
    const callbackMethods = ["map", "forEach", "filter", "reduce", "some", "every", "find", "flatMap"];

    if (callbackMethods.includes(methodName)) {
      // Analyze the callback argument for step calls
      if (args[0]) {
        const callbackResults = analyzeCallbackArgument(args[0], opts, warnings, stats, sagaContext, context);
        if (callbackResults.length > 0) {
          // Return the first result (or wrap in sequence if multiple)
          return callbackResults.length === 1 ? callbackResults[0] : {
            id: generateId(),
            type: "sequence",
            children: callbackResults,
          } as StaticSequenceNode;
        }
      }
    }
  }

  // Check if this might be a workflow call
  if (isLikelyWorkflowCall(node)) {
    return analyzeWorkflowRefCall(node, callee, opts, warnings, stats);
  }

  return undefined;
}

/**
 * Analyze a bound step call from the deps-first form run(deps, fn):
 * `s.getOrder(id)` or destructured `getOrder(id)`. The step ID is the dep
 * key, and the call itself is the inner call — no string ID, no thunk.
 * Error/output types resolve via the deps object (depSource matching),
 * with the type checker on the call as a secondary source.
 */
function analyzeBoundStepCall(
  node: Node,
  depKey: string,
  opts: Required<AnalyzerOptions>,
  stats: AnalysisStats
): StaticStepNode {
  stats.totalSteps++;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId: depKey,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // The dep key doubles as callee and depSource so dependency enrichment
  // (error types, output types) matches by name against the deps object.
  stepNode.callee = depKey;
  stepNode.depSource = depKey;

  // The call expression itself is the inner call (there is no thunk).
  inferStepIOFromInnerCall(node, node, stepNode);

  if (!stepNode.name) {
    stepNode.name = depKey;
  }

  attachStepDocsAndDepLocation(stepNode, node, node, opts);

  return stepNode;
}

/**
 * Check if a callee represents a step function call.
 * Matches: step, s (custom param), runStep (alias), etc.
 * Does NOT match: obj.step (property access on non-step object)
 */
function isStepFunctionCall(callee: string, context: AnalysisContext): boolean {
  // Direct step call - check if callee is in the stepNames set from context
  if (context.stepNames.has(callee)) {
    return true;
  }

  return false;
}

/**
 * Analyze step.sleep() call.
 * New signature: step.sleep(id, duration, options?)
 */
function analyzeStepSleepCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  // New signature: step.sleep(id, duration, options?)
  // First argument is the step ID
  let stepId = "<missing>";
  if (args[0]) {
    if (Node.isStringLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else if (Node.isNoSubstitutionTemplateLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else {
      stepId = "<dynamic>";
    }
  }

  // Extract duration from second argument (e.g. "5s", "1h", seconds(5))
  let sleepDuration: string | undefined;
  if (args[1]) {
    if (Node.isStringLiteral(args[1])) {
      sleepDuration = args[1].getLiteralValue();
    } else if (Node.isNoSubstitutionTemplateLiteral(args[1])) {
      sleepDuration = args[1].getLiteralValue();
    } else {
      // Helper calls or other expressions: use source text (e.g. seconds(5))
      sleepDuration = args[1].getText();
    }
  }

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId,
    callee: "step.sleep",
    stepKind: "sleep",
    sleepDuration,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract options from third argument
  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    const options = extractStepOptions(args[2]);
    if (options.key) stepNode.key = options.key;
    if (options.description) stepNode.description = options.description;
    if (options.markdown) stepNode.markdown = options.markdown;
    if (options.intent) stepNode.intent = options.intent;
    if (options.domain) stepNode.domain = options.domain;
    if (options.owner) stepNode.owner = options.owner;
    if (options.tags) stepNode.tags = options.tags;
  }

  // Step name is always the first argument in awaitly (step.sleep('id', ...)), not from options.
  if (!stepNode.name) {
    stepNode.name = stepId;
  }

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
    const tags = getJSDocTagsFromNode(statement);
    if (tags) {
      if (tags.params?.length) stepNode.jsdocParams = tags.params;
      if (tags.returns) stepNode.jsdocReturns = tags.returns;
      if (tags.throws?.length) stepNode.jsdocThrows = tags.throws;
      if (tags.example) stepNode.jsdocExample = tags.example;
    }
  }

  return stepNode;
}

/**
 * Analyze Promise.all() call - detect steps inside array.
 */
function analyzePromiseAllCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext,
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticFlowNode | undefined {
  const { Node } = loadTsMorph();

  if (!args[0]) return undefined;

  // Handle array literal: Promise.all([...])
  if (Node.isArrayLiteralExpression(args[0])) {
    const results: StaticFlowNode[] = [];
    for (const element of args[0].getElements()) {
      results.push(...analyzeNode(element, opts, warnings, stats, sagaContext, context));
    }
    if (results.length > 0) {
      return wrapInSequence(results, opts)[0];
    }
  }

  // Handle method calls like: Promise.all(items.map(...))
  if (Node.isCallExpression(args[0])) {
    const callExpr = args[0];
    const calleeExpr = callExpr.getExpression();

    // Check if it's a method call like items.map()
    if (Node.isPropertyAccessExpression(calleeExpr)) {
      const methodName = calleeExpr.getName();
      const callbackMethods = ["map", "flatMap", "filter"];

      if (callbackMethods.includes(methodName)) {
        const callbackArgs = callExpr.getArguments();
        if (callbackArgs[0]) {
          return analyzeCallbackArgument(callbackArgs[0], opts, warnings, stats, sagaContext, context)[0];
        }
      }
    }
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
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  stepCallOptions?: { displayCallee: string }
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  const firstArg = args[0];

  // step() now requires explicit string ID as first argument: step('id', fn, opts)
  const isStringLiteralId = firstArg && Node.isStringLiteral(firstArg);
  const isNoSubstitutionTemplateLiteral = firstArg && Node.isNoSubstitutionTemplateLiteral(firstArg);
  const isTemplateLiteralId = firstArg && Node.isTemplateExpression(firstArg);
  const firstArgIsIdentifier = firstArg && Node.isIdentifier(firstArg);

  let stepId: string;

  if (isStringLiteralId && Node.isStringLiteral(firstArg)) {
    stepId = firstArg.getLiteralValue();
  } else if (isNoSubstitutionTemplateLiteral && Node.isNoSubstitutionTemplateLiteral(firstArg)) {
    stepId = firstArg.getLiteralValue();
  } else if (isTemplateLiteralId || firstArgIsIdentifier) {
    // Dynamic stepId (template literal or identifier)
    stepId = "<dynamic>";
  } else {
    // Legacy step(fn, opts) or invalid - first arg is not a string ID
    stepId = "<missing>";
    warnings.push({
      code: "STEP_MISSING_ID",
      message: `step() requires an explicit string ID as the first argument. Example: step("fetchUser", () => fetchUser(id))`,
      location: opts.includeLocations ? getLocation(node) : undefined,
    });
  }

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // step('id', fn, opts) -> operation is args[1], options is args[2]
  // Legacy step(fn, opts) -> operation is args[0], options is args[1]
  const isNewSignature = stepId !== "<missing>";
  let operationArg: Node | undefined = isNewSignature ? args[1] : args[0];
  const optionsArg = isNewSignature ? args[2] : args[1];

  // Extract the operation being called and detect ctx.ref() reads
  let innerCallNode: Node | undefined;
  if (operationArg) {
    // Check for step.dep('name', fn) wrapper first
    if (Node.isCallExpression(operationArg)) {
      const calleeExpr = operationArg.getExpression();
      // Match step.dep() pattern
      if (Node.isPropertyAccessExpression(calleeExpr) && calleeExpr.getName() === "dep") {
        const depArgs = operationArg.getArguments();
        // step.dep('depName', fn) - extract dep name from first arg
        if (depArgs[0] && Node.isStringLiteral(depArgs[0])) {
          stepNode.depSource = depArgs[0].getLiteralValue();
        }
        // Unwrap to the actual function (second argument)
        if (depArgs[1]) {
          operationArg = depArgs[1];
        }
      }
    }

    if (Node.isArrowFunction(operationArg) || Node.isFunctionExpression(operationArg)) {
      // step(() => fetchUser(id)) or step(() => { return fetchUser(id); })
      let body: Node = operationArg.getBody();

      // Unwrap ParenthesizedExpression: () => (deps.fetchUser(id))
      while (Node.isParenthesizedExpression(body)) {
        body = body.getExpression();
      }

      if (Node.isCallExpression(body)) {
        // Arrow function with expression body: () => deps.fetchUser(id)
        stepNode.callee = body.getExpression().getText();
        innerCallNode = body;
      } else if (Node.isBlock(body)) {
        // Block body: () => { return deps.fetchUser(id); }
        // Look for a return statement with a call expression
        const statements = body.getStatements();
        for (const stmt of statements) {
          if (Node.isReturnStatement(stmt)) {
            const returnExpr = stmt.getExpression();
            if (returnExpr && Node.isCallExpression(returnExpr)) {
              stepNode.callee = returnExpr.getExpression().getText();
              innerCallNode = returnExpr;
              break;
            }
          }
        }
        // Fallback if no call expression found
        if (!stepNode.callee) {
          stepNode.callee = body.getText();
        }
      } else if (body) {
        stepNode.callee = body.getText();
      }

      // Extract ctx.ref() reads from the function body (with param index per ref for correct type mapping)
      const extractedReads = extractCtxRefReads(operationArg);
      if (extractedReads) {
        stepNode.reads = extractedReads.reads;
        stepNode.readParamIndices = extractedReads.paramIndices;
      }

      // Try to detect dep source from callee pattern: deps.xxx() or ctx.deps.xxx()
      if (!stepNode.depSource && stepNode.callee) {
        const depMatch = stepNode.callee.match(/^(?:deps|ctx\.deps)\.([a-zA-Z_$][a-zA-Z0-9_$]*)/);
        if (depMatch) {
          stepNode.depSource = depMatch[1];
        }
      }
    } else if (Node.isCallExpression(operationArg)) {
      // step(fetchUser(id)) - direct call
      stepNode.callee = operationArg.getExpression().getText();
      innerCallNode = operationArg;
    } else {
      // step(someResult) - passing a result directly
      stepNode.callee = operationArg.getText();
    }
  }

  inferStepIOFromInnerCall(node, innerCallNode, stepNode);

  // Extract options
  if (optionsArg && Node.isObjectLiteralExpression(optionsArg)) {
    const options = extractStepOptions(optionsArg);
    if (options.key) stepNode.key = options.key;
    if (options.description) stepNode.description = options.description;
    if (options.markdown) stepNode.markdown = options.markdown;
    if (options.retry) stepNode.retry = options.retry;
    if (options.timeout) stepNode.timeout = options.timeout;
    // New API fields
    if (options.errors) {
      stepNode.errors = options.errors;
      stepNode.errorsSource = "explicit";
    }
    if (options.out) stepNode.out = options.out;
    if (options.dep) stepNode.depSource = options.dep;
    // Merge explicit reads with auto-detected ctx.ref() reads (do not assign param indices for explicit-only reads)
    if (options.reads) {
      const existing = stepNode.reads ?? [];
      const merged = new Set([...existing, ...options.reads]);
      stepNode.reads = Array.from(merged);
      // Only keep readParamIndices for reads that came from ctx.ref(); do not extend with fallback indices
      // so we never guess param index for explicit reads and avoid false type-mismatches.
    }
    if (options.intent) stepNode.intent = options.intent;
    if (options.domain) stepNode.domain = options.domain;
    if (options.owner) stepNode.owner = options.owner;
    if (options.tags) stepNode.tags = options.tags;
    if (options.stateChanges) stepNode.stateChanges = options.stateChanges;
    if (options.emits) stepNode.emits = options.emits;
    if (options.calls) stepNode.calls = options.calls;
    if (options.errorMeta) stepNode.errorMeta = options.errorMeta;
    if (options.ttl != null) stepNode.ttl = options.ttl;

    // Validate errorMeta keys reference declared errors
    if (options.errorMeta && options.errors) {
      for (const key of Object.keys(options.errorMeta)) {
        if (!options.errors.includes(key)) {
          warnings.push({
            code: "errorMeta-unknown-key",
            message: `errorMeta key "${key}" is not declared in errors array`,
            location: stepNode.location,
          });
        }
      }
    }
  }

  // In awaitly, step name is always derived from the first argument (id), not from options.
  if (!stepNode.name) {
    stepNode.name = stepNode.stepId;
  }

  attachStepDocsAndDepLocation(stepNode, node, innerCallNode, opts);

  if (stepCallOptions?.displayCallee) {
    stepNode.callee = stepCallOptions.displayCallee;
  }

  return stepNode;
}

/**
 * Returns true if ancestor is the same node as descendant or an ancestor of descendant.
 */
function nodeContains(ancestor: Node, descendant: Node): boolean {
  let n: Node | undefined = descendant;
  while (n) {
    if (n === ancestor) return true;
    n = n.getParent();
  }
  return false;
}

/**
 * Extract ctx.ref() reads from a function body with the parameter index each ref is passed to.
 * Finds the dep call (deps.xxx or ctx.deps.xxx) that ultimately receives this ref, so that
 * wrapping (e.g. deps.useToken(1, String(ctx.ref("token")))) still maps to the correct param index (1).
 */
function extractCtxRefReads(fnNode: Node): { reads: string[]; paramIndices: number[] } | undefined {
  const { Node } = loadTsMorph();
  const reads: string[] = [];
  const paramIndices: number[] = [];

  fnNode.forEachDescendant((descendant) => {
    if (!Node.isCallExpression(descendant)) return;
    const callee = descendant.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) return;
    const propName = callee.getName();
    const obj = callee.getExpression();
    if (propName !== "ref" || obj.getText() !== "ctx") return;
    const refArgs = descendant.getArguments();
    if (!refArgs[0] || !Node.isStringLiteral(refArgs[0])) return;

    const key = refArgs[0].getLiteralValue();
    let paramIndex = 0;
    let node: Node | undefined = descendant.getParent();
    while (node) {
      if (Node.isCallExpression(node)) {
        const calleeText = node.getExpression().getText();
        if (calleeText.startsWith("deps.") || calleeText.startsWith("ctx.deps.")) {
          const args = node.getArguments();
          const idx = args.findIndex((arg) => nodeContains(arg, descendant));
          if (idx >= 0) paramIndex = idx;
          break;
        }
      }
      node = node.getParent();
    }
    reads.push(key);
    paramIndices.push(paramIndex);
  });

  return reads.length > 0 ? { reads, paramIndices } : undefined;
}

/**
 * Analyze step.retry() call.
 * New signature: step.retry(id, operation, options)
 */
function analyzeStepRetryCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  // New signature: step.retry(id, operation, options)
  // First argument is the step ID
  let stepId = "<missing>";
  if (args[0]) {
    if (Node.isStringLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else if (Node.isNoSubstitutionTemplateLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else {
      stepId = "<dynamic>";
    }
  }

  // Unwrap step.dep('name', fn) so we get callee/depSource from the inner operation
  const { operation: operationArg, depSourceOverride } = unwrapStepDepOperation(args[1]);
  const operationCallee = operationArg ? extractCallee(operationArg) : undefined;
  const innerCallNode = operationArg ? getInnerCallNodeFromOperation(operationArg) : undefined;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId,
    callee: "step.retry",
    stepKind: "retry",
    depSource: depSourceOverride ?? normalizeCalleeToDepSource(operationCallee),
    name: stepId,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  inferStepIOFromInnerCall(node, innerCallNode, stepNode);

  // Extract retry options from third argument
  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    stepNode.retry = extractRetryConfig(args[2]);
    const options = extractStepOptions(args[2]);
    if (options.key) stepNode.key = options.key;
    if (options.dep) stepNode.depSource = options.dep;
    if (options.errors) {
      stepNode.errors = options.errors;
      stepNode.errorsSource = "explicit";
    }
    if (options.out) stepNode.out = options.out;
    if (options.reads) stepNode.reads = options.reads;
    if (options.intent) stepNode.intent = options.intent;
    if (options.domain) stepNode.domain = options.domain;
    if (options.owner) stepNode.owner = options.owner;
    if (options.tags) stepNode.tags = options.tags;
    if (options.stateChanges) stepNode.stateChanges = options.stateChanges;
    if (options.emits) stepNode.emits = options.emits;
    if (options.calls) stepNode.calls = options.calls;
    if (options.errorMeta) stepNode.errorMeta = options.errorMeta;
    if (options.ttl != null) stepNode.ttl = options.ttl;
  }

  if (opts.includeLocations && innerCallNode && Node.isCallExpression(innerCallNode)) {
    const calleeExpr = innerCallNode.getExpression();
    stepNode.depLocation = getDefinitionLocationForCallee(calleeExpr) ?? getLocation(calleeExpr);
  }

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
    const tags = getJSDocTagsFromNode(statement);
    if (tags) {
      if (tags.params?.length) stepNode.jsdocParams = tags.params;
      if (tags.returns) stepNode.jsdocReturns = tags.returns;
      if (tags.throws?.length) stepNode.jsdocThrows = tags.throws;
      if (tags.example) stepNode.jsdocExample = tags.example;
    }
  }

  return stepNode;
}

/**
 * Analyze step.withTimeout() call.
 * New signature: step.withTimeout(id, operation, options)
 */
function analyzeStepTimeoutCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  // New signature: step.withTimeout(id, operation, options)
  // First argument is the step ID
  let stepId = "<missing>";
  if (args[0]) {
    if (Node.isStringLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else if (Node.isNoSubstitutionTemplateLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else {
      stepId = "<dynamic>";
    }
  }

  const { operation: operationArg, depSourceOverride } = unwrapStepDepOperation(args[1]);
  const operationCallee = operationArg ? extractCallee(operationArg) : undefined;
  const innerCallNode = operationArg ? getInnerCallNodeFromOperation(operationArg) : undefined;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId,
    callee: "step.withTimeout",
    stepKind: "withTimeout",
    depSource: depSourceOverride ?? normalizeCalleeToDepSource(operationCallee),
    name: stepId,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  inferStepIOFromInnerCall(node, innerCallNode, stepNode);

  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    stepNode.timeout = extractTimeoutConfig(args[2]);
    const options = extractStepOptions(args[2]);
    if (options.key) stepNode.key = options.key;
    if (options.dep) stepNode.depSource = options.dep;
    if (options.intent) stepNode.intent = options.intent;
    if (options.domain) stepNode.domain = options.domain;
    if (options.owner) stepNode.owner = options.owner;
    if (options.tags) stepNode.tags = options.tags;
  }

  if (opts.includeLocations && innerCallNode && Node.isCallExpression(innerCallNode)) {
    const calleeExpr = innerCallNode.getExpression();
    stepNode.depLocation = getDefinitionLocationForCallee(calleeExpr) ?? getLocation(calleeExpr);
  }

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
    const tags = getJSDocTagsFromNode(statement);
    if (tags) {
      if (tags.params?.length) stepNode.jsdocParams = tags.params;
      if (tags.returns) stepNode.jsdocReturns = tags.returns;
      if (tags.throws?.length) stepNode.jsdocThrows = tags.throws;
      if (tags.example) stepNode.jsdocExample = tags.example;
    }
  }

  return stepNode;
}

/**
 * Analyze step.try() call.
 * Signature: step.try(id, operation, options)
 */
function analyzeStepTryCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  // Signature: step.try(id, operation, options)
  // First argument is the step ID
  let stepId = "<missing>";
  if (args[0]) {
    if (Node.isStringLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else if (Node.isNoSubstitutionTemplateLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else {
      stepId = "<dynamic>";
    }
  }

  const { operation: operationArg, depSourceOverride } = unwrapStepDepOperation(args[1]);
  const operationCallee = operationArg ? extractCallee(operationArg) : undefined;
  const innerCallNode = operationArg ? getInnerCallNodeFromOperation(operationArg) : undefined;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId,
    callee: "step.try",
    stepKind: "try",
    depSource: depSourceOverride ?? normalizeCalleeToDepSource(operationCallee),
    name: stepId,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  inferStepIOFromInnerCall(node, innerCallNode, stepNode);

  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    const options = extractStepOptions(args[2]);
    if (options.key) stepNode.key = options.key;
    if (options.dep) stepNode.depSource = options.dep;
    if (options.intent) stepNode.intent = options.intent;
    if (options.domain) stepNode.domain = options.domain;
    if (options.owner) stepNode.owner = options.owner;
    if (options.tags) stepNode.tags = options.tags;
  }

  if (opts.includeLocations && innerCallNode && Node.isCallExpression(innerCallNode)) {
    const calleeExpr = innerCallNode.getExpression();
    stepNode.depLocation = getDefinitionLocationForCallee(calleeExpr) ?? getLocation(calleeExpr);
  }

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
    const tags = getJSDocTagsFromNode(statement);
    if (tags) {
      if (tags.params?.length) stepNode.jsdocParams = tags.params;
      if (tags.returns) stepNode.jsdocReturns = tags.returns;
      if (tags.throws?.length) stepNode.jsdocThrows = tags.throws;
      if (tags.example) stepNode.jsdocExample = tags.example;
    }
  }

  return stepNode;
}

/**
 * Analyze step.fromResult() call.
 * Signature: step.fromResult(id, operation, options)
 */
function analyzeStepFromResultCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  // Signature: step.fromResult(id, operation, options)
  // First argument is the step ID
  let stepId = "<missing>";
  if (args[0]) {
    if (Node.isStringLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else if (Node.isNoSubstitutionTemplateLiteral(args[0])) {
      stepId = args[0].getLiteralValue();
    } else {
      stepId = "<dynamic>";
    }
  }

  const { operation: operationArg, depSourceOverride } = unwrapStepDepOperation(args[1]);
  const operationCallee = operationArg ? extractCallee(operationArg) : undefined;
  const innerCallNode = operationArg ? getInnerCallNodeFromOperation(operationArg) : undefined;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId,
    callee: "step.fromResult",
    stepKind: "fromResult",
    depSource: depSourceOverride ?? normalizeCalleeToDepSource(operationCallee),
    name: stepId,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  inferStepIOFromInnerCall(node, innerCallNode, stepNode);

  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    const options = extractStepOptions(args[2]);
    if (options.key) stepNode.key = options.key;
    if (options.dep) stepNode.depSource = options.dep;
    if (options.intent) stepNode.intent = options.intent;
    if (options.domain) stepNode.domain = options.domain;
    if (options.owner) stepNode.owner = options.owner;
    if (options.tags) stepNode.tags = options.tags;
  }

  if (opts.includeLocations && innerCallNode && Node.isCallExpression(innerCallNode)) {
    const calleeExpr = innerCallNode.getExpression();
    stepNode.depLocation = getDefinitionLocationForCallee(calleeExpr) ?? getLocation(calleeExpr);
  }

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
    const tags = getJSDocTagsFromNode(statement);
    if (tags) {
      if (tags.params?.length) stepNode.jsdocParams = tags.params;
      if (tags.returns) stepNode.jsdocReturns = tags.returns;
      if (tags.throws?.length) stepNode.jsdocThrows = tags.throws;
      if (tags.example) stepNode.jsdocExample = tags.example;
    }
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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticParallelNode {
  const { Node } = loadTsMorph();
  stats.parallelCount++;

  const parallelNode: StaticParallelNode = {
    id: generateId(),
    type: "parallel",
    mode,
    children: [],
    callee: mode === "allSettled" ? "step.allSettled" : "step.parallel",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Check for step.parallel(name, operations) name-first object form
  if (
    args[0] &&
    args[1] &&
    (Node.isStringLiteral(args[0]) || (!Node.isObjectLiteralExpression(args[0]) && !Node.isArrayLiteralExpression(args[0]))) &&
    Node.isObjectLiteralExpression(args[1])
  ) {
    const nameArg = args[0];
    parallelNode.name = Node.isStringLiteral(nameArg) ? nameArg.getLiteralValue() : nameArg.getText();
    const operationsNode = args[1];
    const props = operationsNode.getProperties();
    for (let branchIndex = 0; branchIndex < props.length; branchIndex++) {
      const prop = props[branchIndex];
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName();
        const init = prop.getInitializer();
        if (init) {
          const scopePrefix = `parallel.${parallelNode.name ?? branchIndex}.`;
          if (Node.isObjectLiteralExpression(init)) {
            const fnProp = init.getProperty("fn");
            const errorsProp = init.getProperty("errors");
            if (fnProp && Node.isPropertyAssignment(fnProp)) {
              const fnInit = fnProp.getInitializer();
              if (fnInit) {
                const implicitStep = tryExtractImplicitStep(fnInit, opts, stats, scopePrefix);
                if (implicitStep) {
                  implicitStep.name = name;
                  implicitStep.depSource = extractFunctionName(implicitStep.callee ?? "");
                  if (errorsProp && Node.isPropertyAssignment(errorsProp)) {
                    const errorsInit = errorsProp.getInitializer();
                    if (errorsInit) {
                      implicitStep.errors = extractErrorsArray(errorsInit);
                    }
                  }
                  parallelNode.children.push(implicitStep);
                  continue;
                }
              }
            }
          }
          const implicitStep = tryExtractImplicitStep(init, opts, stats, scopePrefix);
          if (implicitStep) {
            implicitStep.name = name;
            implicitStep.depSource = extractFunctionName(implicitStep.callee ?? "");
            parallelNode.children.push(implicitStep);
          } else {
            const children = analyzeCallbackArgument(init, opts, warnings, stats, sagaContext, context);
            if (children.length > 0) {
              const child = children[0];
              child.name = name;
              if (child.type === "step") {
                const s = child as StaticStepNode;
                if (s.stepId?.startsWith("implicit:"))
                  s.stepId = scopePrefix + (s.name ?? s.stepId.slice("implicit:".length));
              }
              parallelNode.children.push(child);
            }
          }
        }
      }
    }
    return parallelNode;
  }

  // Check for step.parallel("name", callback) array form
  if (args[0] && Node.isStringLiteral(args[0])) {
    parallelNode.name = args[0].getLiteralValue();
    if (args[1]) {
      const children = analyzeCallbackArgument(args[1], opts, warnings, stats, sagaContext, context);
      if (children.length === 1 && children[0].type === "parallel") {
        const inner = children[0] as StaticParallelNode;
        parallelNode.children = inner.children;
        parallelNode.mode = inner.mode;
        return parallelNode;
      }
      parallelNode.children.push(...children);
    }
    return parallelNode;
  }

  // Check for step.parallel(NamedConstant, callback) array form
  if (args[0] && !Node.isObjectLiteralExpression(args[0]) && !Node.isArrayLiteralExpression(args[0]) && args[1]) {
    parallelNode.name = args[0].getText();
    const children = analyzeCallbackArgument(args[1], opts, warnings, stats, sagaContext, context);
    if (children.length === 1 && children[0].type === "parallel") {
      const inner = children[0] as StaticParallelNode;
      parallelNode.children = inner.children;
      parallelNode.mode = inner.mode;
      return parallelNode;
    }
    parallelNode.children.push(...children);
    return parallelNode;
  }

  return parallelNode;
}

/**
 * Analyze step.forEach() call for structured loops.
 *
 * Supports two forms:
 * 1. step.forEach('id', items, { maxIterations, stepIdPattern, errors, run: (item) => ... })
 * 2. step.forEach('id', items, { maxIterations, stepIdPattern, item: step.item((item, i, step) => { ... }) })
 */
function analyzeStepForEachCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();

  stats.loopCount++;

  const loopNode: StaticLoopNode = {
    id: generateId(),
    type: "loop",
    loopType: "step.forEach",
    body: [],
    boundKnown: false,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // step.forEach('id', items, options)
  // arg[0] = loop ID (string)
  // arg[1] = items to iterate
  // arg[2] = options object

  // Extract loop ID
  if (args[0] && Node.isStringLiteral(args[0])) {
    loopNode.loopId = args[0].getLiteralValue();
    loopNode.name = loopNode.loopId;
  }

  // Extract iteration source
  if (args[1]) {
    loopNode.iterSource = args[1].getText();
  }

  // Extract options
  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    for (const prop of args[2].getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;

      const propName = prop.getName();
      const init = prop.getInitializer();
      if (!init) continue;

      if (propName === "maxIterations" && Node.isNumericLiteral(init)) {
        loopNode.maxIterations = init.getLiteralValue();
        loopNode.boundKnown = true;
        loopNode.boundCount = loopNode.maxIterations;
      } else if (propName === "stepIdPattern") {
        const pattern = extractStringValue(init);
        if (pattern) loopNode.stepIdPattern = pattern;
      } else if (propName === "errors") {
        loopNode.errors = extractErrorsArray(init);
      } else if (propName === "out") {
        // Output key for data flow
        const outKey = extractStringValue(init);
        if (outKey) loopNode.out = outKey;
      } else if (propName === "collect") {
        // Collect mode: 'array' or 'last'
        const collectMode = extractStringValue(init);
        if (collectMode === "array" || collectMode === "last") {
          loopNode.collect = collectMode;
        }
      } else if (propName === "run" && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        // Simple form: run: (item) => deps.processItem(item) — extract implicit step so Mermaid shows a step inside the loop
        const forEachPrefix = `forEach.${loopNode.loopId ?? "forEach"}.`;
        const implicitStep = tryExtractImplicitStep(init, opts, stats, forEachPrefix);
        if (implicitStep) {
          if (!implicitStep.depSource && implicitStep.callee) {
            implicitStep.depSource = extractFunctionName(implicitStep.callee);
          }
          loopNode.body = [implicitStep];
        } else {
          const bodyNodes = analyzeNode(init.getBody(), opts, warnings, stats, sagaContext, context);
          loopNode.body = bodyNodes;
        }
      } else if (propName === "item" && Node.isCallExpression(init)) {
        // Complex form: item: step.item((item, i, step) => { ... })
        const itemArgs = init.getArguments();
        if (itemArgs[0] && (Node.isArrowFunction(itemArgs[0]) || Node.isFunctionExpression(itemArgs[0]))) {
          const bodyNodes = analyzeNode(itemArgs[0].getBody(), opts, warnings, stats, sagaContext, context);
          loopNode.body = bodyNodes;
        }
      }
    }
  }

  return loopNode;
}

/**
 * Analyze step.branch() call for explicit conditional with metadata.
 *
 * Pattern: step.branch('id', {
 *   conditionLabel: 'cart.total > 0',
 *   condition: () => cart.total > 0,
 *   out: 'charge',
 *   then: () => chargeCard(cart.total),
 *   thenErrors: ['CARD_DECLINED'],
 *   else: () => ok({ skipped: true }),
 *   elseErrors: [],
 * })
 *
 * This normalizes to a StaticDecisionNode, same as step.if/step.label.
 */
function analyzeStepBranchCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticDecisionNode | undefined {
  const { Node } = loadTsMorph();

  stats.conditionalCount++;

  // step.branch('id', options)
  // arg[0] = branch ID (string literal)
  // arg[1] = options object

  let decisionId = "<dynamic>";
  let conditionLabel = "<dynamic>";
  let condition = "<dynamic>";
  let thenErrors: string[] | undefined;
  let elseErrors: string[] | undefined;
  let out: string | undefined;
  let consequent: StaticFlowNode[] = [];
  let alternate: StaticFlowNode[] = [];

  // Extract branch ID
  if (args[0] && Node.isStringLiteral(args[0])) {
    decisionId = args[0].getLiteralValue();
  }

  // Extract options
  if (args[1] && Node.isObjectLiteralExpression(args[1])) {
    for (const prop of args[1].getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;

      const propName = prop.getName();
      const init = prop.getInitializer();
      if (!init) continue;

      if (propName === "conditionLabel") {
        const val = extractStringValue(init);
        if (val) conditionLabel = val;
      } else if (propName === "condition") {
        // Extract condition source code
        if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
          condition = init.getBody().getText();
        } else {
          condition = init.getText();
        }
      } else if (propName === "out") {
        out = extractStringValue(init);
      } else if (propName === "then") {
        // then: () => ... or then: step.arm(...)
        const thenBody = extractBranchBody(init, opts, warnings, stats, sagaContext, context);
        if (thenBody) consequent = thenBody;
      } else if (propName === "thenErrors") {
        thenErrors = extractErrorsArray(init);
      } else if (propName === "else") {
        // else: () => ... or else: step.arm(...)
        const elseBody = extractBranchBody(init, opts, warnings, stats, sagaContext, context);
        if (elseBody) alternate = elseBody;
      } else if (propName === "elseErrors") {
        elseErrors = extractErrorsArray(init);
      }
    }
  }

  // Create DecisionNode (same as step.if/step.label)
  const decisionNode: StaticDecisionNode = {
    id: generateId(),
    type: "decision",
    decisionId,
    conditionLabel,
    condition,
    consequent,
    alternate,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Add per-arm errors as step-level annotations if available
  // Note: StaticDecisionNode doesn't have thenErrors/elseErrors fields,
  // but we can add errors to the consequent/alternate step nodes if they're simple steps
  if (thenErrors && consequent.length === 1 && consequent[0].type === "step") {
    (consequent[0] as StaticStepNode).errors = thenErrors;
  }
  if (elseErrors && alternate.length === 1 && alternate[0].type === "step") {
    (alternate[0] as StaticStepNode).errors = elseErrors;
  }

  // Add out to step nodes if available
  if (out) {
    if (consequent.length === 1 && consequent[0].type === "step") {
      (consequent[0] as StaticStepNode).out = out;
    }
    if (alternate.length === 1 && alternate[0].type === "step") {
      (alternate[0] as StaticStepNode).out = out;
    }
  }

  return decisionNode;
}

/**
 * Extract branch body from a then/else value.
 * Handles: arrow functions, step.arm() calls, direct calls.
 *
 * For step.branch(), the then/else functions wrap operations that would
 * normally be inside a step call. If they contain direct calls (not step calls),
 * we create a step node for them to represent the operation.
 */
function extractBranchBody(
  init: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  _sagaContext: SagaContext,
  _context: AnalysisContext
): StaticFlowNode[] {
  const { Node } = loadTsMorph();

  // Check for step.arm() wrapper
  if (Node.isCallExpression(init)) {
    const callee = init.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === "arm") {
      // step.arm({ fn: ..., errors: [...] }) or step.arm(() => ...)
      const armArgs = init.getArguments();
      if (armArgs[0]) {
        if (Node.isObjectLiteralExpression(armArgs[0])) {
          // step.arm({ fn: ..., errors: [...] })
          let fnNode: Node | undefined;
          let armErrors: string[] | undefined;

          for (const prop of armArgs[0].getProperties()) {
            if (!Node.isPropertyAssignment(prop)) continue;
            const propName = prop.getName();
            const propInit = prop.getInitializer();
            if (propName === "fn" && propInit) {
              fnNode = propInit;
            } else if (propName === "errors" && propInit) {
              armErrors = extractErrorsArray(propInit);
            }
          }

          if (fnNode) {
            const nodes = extractBranchFnBody(fnNode, opts, stats);
            // Apply arm-level errors to the resulting step
            if (armErrors && nodes.length === 1 && nodes[0].type === "step") {
              (nodes[0] as StaticStepNode).errors = armErrors;
            }
            return nodes;
          }
        } else if (Node.isArrowFunction(armArgs[0]) || Node.isFunctionExpression(armArgs[0])) {
          // step.arm(() => ...)
          return extractBranchFnBody(armArgs[0], opts, stats);
        }
      }
    }
  }

  // Regular arrow function or function expression: then: () => deps.chargeCard()
  if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
    return extractBranchFnBody(init, opts, stats);
  }

  // Direct expression - try to wrap in a step node
  return wrapInStepNode(init, opts, stats);
}

/**
 * Extract the body of a branch function (arrow function or function expression).
 * Creates a step node for the operation inside.
 */
function extractBranchFnBody(
  fnNode: Node,
  opts: Required<AnalyzerOptions>,
  stats: AnalysisStats
): StaticFlowNode[] {
  const { Node } = loadTsMorph();

  if (Node.isArrowFunction(fnNode) || Node.isFunctionExpression(fnNode)) {
    let body: Node = fnNode.getBody();

    // Unwrap ParenthesizedExpression
    while (Node.isParenthesizedExpression(body)) {
      body = body.getExpression();
    }

    // For expression body (call expression), create a step node
    if (Node.isCallExpression(body)) {
      return wrapInStepNode(body, opts, stats);
    }

    // For block body, look for return statement with call
    if (Node.isBlock(body)) {
      const statements = body.getStatements();
      for (const stmt of statements) {
        if (Node.isReturnStatement(stmt)) {
          const returnExpr = stmt.getExpression();
          if (returnExpr && Node.isCallExpression(returnExpr)) {
            return wrapInStepNode(returnExpr, opts, stats);
          }
        }
      }
    }

    // Fallback: wrap the whole body
    return wrapInStepNode(body, opts, stats);
  }

  return wrapInStepNode(fnNode, opts, stats);
}

/**
 * Wrap a node (typically a call expression) in a step node.
 * This is used for branch bodies that are not explicit step calls.
 */
function wrapInStepNode(
  node: Node,
  opts: Required<AnalyzerOptions>,
  stats: AnalysisStats
): StaticFlowNode[] {
  const { Node } = loadTsMorph();

  stats.totalSteps++;

  // Extract callee first for naming
  let callee: string;
  let name: string;
  let depSource: string | undefined;

  if (Node.isCallExpression(node)) {
    callee = node.getExpression().getText();
    // Try to detect dep source from callee pattern: deps.xxx() or ctx.deps.xxx()
    const depMatch = callee.match(/^(?:deps|ctx\.deps)\.([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (depMatch) {
      depSource = depMatch[1];
      name = depMatch[1];
    } else {
      name = callee;
    }
  } else {
    callee = node.getText();
    name = callee;
  }

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId: `implicit:${name}`,
    callee,
    name,
    depSource,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  return [stepNode];
}

/**
 * Extract callee string from a resource callback (acquire/use/release).
 * e.g. () => deps.acquire() -> "deps.acquire", (r) => deps.useResource(r) -> "deps.useResource", () => {} -> "inline".
 */
function extractCalleeFromResourceCallback(node: Node): string | undefined {
  const { Node } = loadTsMorph();
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    if (Node.isCallExpression(body)) return body.getExpression().getText();
    if (Node.isBlock(body)) {
      const stmts = body.getStatements();
      if (stmts.length === 0) return "inline";
      if (stmts.length === 1 && Node.isReturnStatement(stmts[0])) {
        const expr = stmts[0].getExpression();
        if (expr && Node.isCallExpression(expr)) return expr.getExpression().getText();
      }
      return "inline";
    }
  }
  if (Node.isFunctionExpression(node)) {
    const body = node.getBody();
    if (!Node.isBlock(body)) return undefined;
    const stmts = body.getStatements();
    if (stmts.length === 0) return "inline";
    if (stmts.length === 1 && Node.isReturnStatement(stmts[0])) {
      const expr = stmts[0].getExpression();
      if (expr && Node.isCallExpression(expr)) return expr.getExpression().getText();
    }
    return "inline";
  }
  return undefined;
}

/**
 * Try to extract an implicit step from a callback that wraps a direct call expression.
 * e.g., () => deps.fetchPosts(id) -> implicit step for "fetchPosts"
 * When scopePrefix is provided, stepId is deterministic path-style (e.g. "race.cacheA", "parallel.0.fetchA").
 */
function tryExtractImplicitStep(
  node: Node,
  opts: Required<AnalyzerOptions>,
  stats: AnalysisStats,
  scopePrefix?: string
): StaticStepNode | undefined {
  const { Node } = loadTsMorph();
  const makeStep = (
    name: string,
    callee: string,
    locationNode: Node
  ): StaticStepNode => ({
    id: generateId(),
    type: "step",
    stepId: scopePrefix ? scopePrefix + name : `implicit:${name}`,
    location: opts.includeLocations ? getLocation(locationNode) : undefined,
    callee,
    name,
  });

  // Check if it's an arrow function with a call expression body
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    if (Node.isCallExpression(body)) {
      const callee = body.getExpression().getText();
      const name = extractFunctionName(callee);
      stats.totalSteps++;
      return makeStep(name, callee, body);
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
        const name = extractFunctionName(callee);
        stats.totalSteps++;
        return makeStep(name, callee, expr);
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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
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
    const elements = args[0].getElements();
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      // Use analyzeCallbackArgument for arrow functions/function expressions
      const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, context);

      // If analyzeCallbackArgument found known patterns (step, etc.), use those
      if (children.length > 0) {
        const scopePrefix = `parallel.${i}.`;
        for (const c of children) {
          if (c.type === "step") {
            const s = c as StaticStepNode;
            if (!s.depSource && s.callee) s.depSource = extractFunctionName(s.callee);
            if (s.stepId?.startsWith("implicit:"))
              s.stepId = scopePrefix + (s.name ?? s.stepId.slice("implicit:".length));
          }
        }
        // Group multiple children in a sequence
        if (children.length > 1) {
          parallelNode.children.push({
            id: generateId(),
            type: "sequence",
            children,
          } as StaticSequenceNode);
        } else {
          parallelNode.children.push(...children);
        }
      } else if (Node.isCallExpression(element)) {
        // Treat direct call expressions as implicit steps
        // e.g., allAsync([deps.fetchPosts(id), deps.fetchFriends(id)])
        const callee = element.getExpression().getText();
        const name = extractFunctionName(callee);
        stats.totalSteps++;
        const implicitStep: StaticStepNode = {
          id: generateId(),
          type: "step",
          stepId: `parallel.${i}.${name}`,
          location: opts.includeLocations ? getLocation(element) : undefined,
          callee,
          name,
          depSource: name,
        };
        parallelNode.children.push(implicitStep);
      }
    }
  }

  return parallelNode;
}

function analyzeRaceCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
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

  // Extract operations from array or object
  if (args[0] && Node.isArrayLiteralExpression(args[0])) {
    const elements = args[0].getElements();
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const scopePrefix = `race.${i}.`;
      const implicitStep = tryExtractImplicitStep(element, opts, stats, scopePrefix);
      if (implicitStep) {
        implicitStep.depSource = implicitStep.name ?? extractFunctionName(implicitStep.callee ?? "");
        raceNode.children.push(implicitStep);
      } else {
        const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, context);
        for (const c of children) {
          if (c.type === "step") {
            const s = c as StaticStepNode;
            if (!s.depSource && s.callee) s.depSource = extractFunctionName(s.callee);
            if (s.stepId?.startsWith("implicit:"))
              s.stepId = scopePrefix + (s.name ?? s.stepId.slice("implicit:".length));
          }
        }
        raceNode.children.push(...children);
      }
    }
  } else if (args[0] && Node.isObjectLiteralExpression(args[0])) {
    // Object form: step.race({ cacheA: () => ..., cacheB: () => ... })
    for (const prop of args[0].getProperties()) {
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName();
        const init = prop.getInitializer();
        if (init) {
          const scopePrefix = `race.${name}.`;
          const implicitStep = tryExtractImplicitStep(init, opts, stats, scopePrefix);
          if (implicitStep) {
            implicitStep.name = name;
            implicitStep.depSource = name;
            raceNode.children.push(implicitStep);
          } else {
            const children = analyzeCallbackArgument(init, opts, warnings, stats, sagaContext, context);
            if (children.length > 0) {
              const child = children[0];
              child.name = name;
              if (child.type === "step") {
                const s = child as StaticStepNode;
                s.depSource = s.depSource ?? name;
                if (s.stepId?.startsWith("implicit:"))
                  s.stepId = scopePrefix + (s.name ?? s.stepId.slice("implicit:".length));
              }
              raceNode.children.push(child);
            }
          }
        }
      }
    }
  }

  return raceNode;
}

function analyzeAnyAsyncCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
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
      const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, context);
      raceNode.children.push(...children);
    }
  }

  return raceNode;
}

// =============================================================================
// Streaming Analysis
// =============================================================================

function analyzeStreamCall(
  node: Node,
  streamType: "write" | "read" | "forEach",
  opts: Required<AnalyzerOptions>,
  stats: AnalysisStats
): StaticStreamNode {
  const { Node } = loadTsMorph();

  stats.streamCount = (stats.streamCount || 0) + 1;

  if (!Node.isCallExpression(node)) {
    return {
      id: generateId(),
      type: "stream",
      streamType,
      callee: `step.${streamType === "write" ? "getWritable" : streamType === "read" ? "getReadable" : "streamForEach"}`,
      location: opts.includeLocations ? getLocation(node) : undefined,
    };
  }

  const args = node.getArguments();
  const streamNode: StaticStreamNode = {
    id: generateId(),
    type: "stream",
    streamType,
    callee: node.getExpression().getText(),
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract namespace from first argument (string literal)
  if (args[0] && Node.isStringLiteral(args[0])) {
    streamNode.namespace = args[0].getLiteralValue();
  }

  return streamNode;
}

// =============================================================================
// Saga Analysis
// =============================================================================

function analyzeSagaStepCall(
  node: Node,
  args: Node[],
  isTryStep: boolean,
  opts: Required<AnalyzerOptions>,
  _warnings: AnalysisWarning[],
  stats: AnalysisStats
): StaticSagaStepNode {
  const { Node } = loadTsMorph();

  stats.totalSteps++;

  const sagaNode: StaticSagaStepNode = {
    id: generateId(),
    type: "saga-step",
    hasCompensation: false,
    isTryStep,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // In awaitly, saga.step(name, operation, options?) / saga.tryStep(name, operation, options) — name is first param, not in options.
  const nameArg = args[0];
  const operationArg = args[1];
  const optionsArg = args[2];

  if (nameArg) {
    const nameVal = extractStringValue(nameArg);
    if (nameVal && nameVal !== "<dynamic>") sagaNode.name = nameVal;
  }

  if (operationArg) {
    sagaNode.callee = extractCallee(operationArg);
    if (sagaNode.callee) sagaNode.depSource = extractFunctionName(sagaNode.callee);
    if (!sagaNode.name) sagaNode.name = sagaNode.callee;
  }

  if (optionsArg && Node.isObjectLiteralExpression(optionsArg)) {
    const sagaOptions = extractSagaStepOptions(optionsArg);
    if (sagaOptions.description) {
      sagaNode.description = sagaOptions.description;
    }
    if (sagaOptions.markdown) {
      sagaNode.markdown = sagaOptions.markdown;
    }
    if (sagaOptions.hasCompensation) {
      sagaNode.hasCompensation = true;
      sagaNode.compensationCallee = sagaOptions.compensationCallee;
      stats.compensatedStepCount = (stats.compensatedStepCount || 0) + 1;
    }
  }

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) sagaNode.jsdocDescription = jsdoc;
    const tags = getJSDocTagsFromNode(statement);
    if (tags) {
      if (tags.params?.length) sagaNode.jsdocParams = tags.params;
      if (tags.returns) sagaNode.jsdocReturns = tags.returns;
      if (tags.throws?.length) sagaNode.jsdocThrows = tags.throws;
      if (tags.example) sagaNode.jsdocExample = tags.example;
    }
  }

  return sagaNode;
}

/**
 * Extract options from a saga step options object.
 * Aligns with awaitly: saga.step(name, operation, options?) — name is always the first argument, never in options.
 * e.g., { description: '...', compensate: () => deps.cancelOrder() }
 */
function extractSagaStepOptions(optionsNode: Node): {
  description?: string;
  markdown?: string;
  hasCompensation: boolean;
  compensationCallee?: string;
} {
  const { Node } = loadTsMorph();
  const result = {
    description: undefined as string | undefined,
    markdown: undefined as string | undefined,
    hasCompensation: false,
    compensationCallee: undefined as string | undefined,
  };

  if (!Node.isObjectLiteralExpression(optionsNode)) {
    return result;
  }

  for (const prop of optionsNode.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    // In awaitly, saga step name is always the first argument, not an option.
    if (propName === "name") continue;

    if (propName === "description" && init) {
      result.description = extractStringValue(init);
    } else if (propName === "markdown" && init) {
      result.markdown = extractStringValue(init);
    } else if (propName === "compensate" && init) {
      result.hasCompensation = true;
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        const body = init.getBody();
        if (Node.isCallExpression(body)) {
          // Concise arrow: () => deps.cancelOrder()
          result.compensationCallee = body.getExpression().getText();
        } else if (Node.isBlock(body)) {
          // Block body: () => { return deps.cancelOrder(); }
          // Find return statement and extract call expression
          const returnStmt = body
            .getStatements()
            .find((s) => Node.isReturnStatement(s));
          if (returnStmt && Node.isReturnStatement(returnStmt)) {
            const expr = returnStmt.getExpression();
            if (expr && Node.isCallExpression(expr)) {
              result.compensationCallee = expr.getExpression().getText();
            }
          }
        }
      }
    }
  }

  return result;
}

// =============================================================================
// Conditional Analysis
// =============================================================================

function analyzeIfStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticConditionalNode | StaticDecisionNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isIfStatement(node)) return undefined;

  const conditionExpr = node.getExpression();
  const condition = conditionExpr.getText();
  const thenStatement = node.getThenStatement();
  const elseStatement = node.getElseStatement();

  const consequent = analyzeNode(thenStatement, opts, warnings, stats, sagaContext, context);
  const alternate = elseStatement
    ? analyzeNode(elseStatement, opts, warnings, stats, sagaContext, context)
    : undefined;

  // Always count conditionals when inside workflow callback (for tree-sitter parity)
  // Only return undefined (no node) if no content, but still count it
  if (context.isInWorkflowCallback) {
    stats.conditionalCount++;
  } else if (consequent.length === 0 && (!alternate || alternate.length === 0)) {
    // Outside workflow callback: only skip if no steps
    return undefined;
  } else {
    // Outside workflow callback but has steps: count it
    stats.conditionalCount++;
  }

  // Only create conditional node if there are step calls inside
  if (consequent.length === 0 && (!alternate || alternate.length === 0)) {
    return undefined;
  }

  // Best-effort: condition expression type
  let conditionType: string | undefined;
  try {
    const t = conditionExpr.getType();
    if (t) conditionType = t.getText();
  } catch {
    // ignore
  }

  // Check if condition is a step.if() call - create StaticDecisionNode
  const stepIfInfo = extractStepIfInfo(conditionExpr, context);
  if (stepIfInfo) {
    return {
      id: generateId(),
      type: "decision",
      decisionId: stepIfInfo.decisionId,
      conditionLabel: stepIfInfo.conditionLabel,
      condition: stepIfInfo.condition,
      consequent,
      alternate,
      location: opts.includeLocations ? getLocation(node) : undefined,
      conditionType,
    };
  }

  return {
    id: generateId(),
    type: "conditional",
    condition,
    helper: null,
    consequent,
    alternate,
    location: opts.includeLocations ? getLocation(node) : undefined,
    conditionType,
  };
}

/**
 * Extract step.if() or step.label() info from condition expression.
 * Pattern: step.if('decisionId', 'conditionLabel', () => condition)
 * Pattern: step.label('decisionId', 'conditionLabel', () => condition)
 * Note: step.label is an alias for step.if in the runtime
 */
function extractStepIfInfo(
  conditionExpr: Node,
  context: AnalysisContext
): { decisionId: string; conditionLabel: string; condition: string } | undefined {
  const { Node } = loadTsMorph();

  if (!Node.isCallExpression(conditionExpr)) {
    return undefined;
  }

  const callee = conditionExpr.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) {
    return undefined;
  }

  const propName = callee.getName();
  const obj = callee.getExpression();

  // Check if it's step.if or step.label (or s.if, s.label, etc.)
  // step.label is an alias for step.if - both create DecisionNode
  if ((propName !== "if" && propName !== "label") || !context.stepNames.has(obj.getText())) {
    return undefined;
  }

  const args = conditionExpr.getArguments();
  if (args.length < 3) {
    return undefined;
  }

  // Extract decisionId (first arg - string literal)
  if (!Node.isStringLiteral(args[0])) {
    return undefined;
  }
  const decisionId = args[0].getLiteralValue();

  // Extract conditionLabel (second arg - string literal)
  if (!Node.isStringLiteral(args[1])) {
    return undefined;
  }
  const conditionLabel = args[1].getLiteralValue();

  // Extract condition (third arg - arrow function body)
  let condition = args[2].getText();
  if (Node.isArrowFunction(args[2]) || Node.isFunctionExpression(args[2])) {
    const body = args[2].getBody();
    condition = body.getText();
  }

  return { decisionId, conditionLabel, condition };
}

function analyzeSwitchStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticSwitchNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isSwitchStatement(node)) return undefined;

  const expression = node.getExpression().getText();
  const clauses = node.getClauses();
  const cases: StaticSwitchCase[] = [];
  let hasSteps = false;

  for (const clause of clauses) {
    const isDefault = Node.isDefaultClause(clause);
    let value: string | undefined;

    if (Node.isCaseClause(clause)) {
      value = clause.getExpression().getText();
    }

    const statements = clause.getStatements();
    const body: StaticFlowNode[] = [];

    for (const statement of statements) {
      const analyzed = analyzeNode(statement, opts, warnings, stats, sagaContext, context);
      body.push(...analyzed);
    }

    if (body.length > 0) {
      hasSteps = true;
    }

    cases.push({
      value,
      isDefault,
      body,
    });
  }

  // Always count switch when inside workflow callback (for tree-sitter parity)
  if (context.isInWorkflowCallback) {
    stats.conditionalCount++;
  } else if (!hasSteps) {
    // Outside workflow callback: only skip if no steps
    return undefined;
  } else {
    // Outside workflow callback but has steps: count it
    stats.conditionalCount++;
  }

  // Only create switch node if there are step calls inside
  if (!hasSteps) {
    return undefined;
  }

  return {
    id: generateId(),
    type: "switch",
    expression,
    cases,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };
}

function analyzeConditionalHelper(
  node: Node,
  helper: "when" | "unless" | "whenOr" | "unlessOr",
  args: Node[],
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: true, depth: 0 }
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
    conditionalNode.consequent = analyzeCallbackArgument(args[1], opts, warnings, stats, sagaContext, context);
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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats, sagaContext, context);

  // Always count loops when inside workflow callback (for tree-sitter parity)
  if (context.isInWorkflowCallback) {
    stats.loopCount++;
  } else if (bodyChildren.length === 0) {
    // Outside workflow callback: only skip if no steps
    return undefined;
  } else {
    // Outside workflow callback but has steps: count it
    stats.loopCount++;
  }

  // Only create loop node if there are step calls inside
  if (bodyChildren.length === 0) {
    return undefined;
  }

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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForOfStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats, sagaContext, context);

  // Always count loops when inside workflow callback (for tree-sitter parity)
  if (context.isInWorkflowCallback) {
    stats.loopCount++;
  } else if (bodyChildren.length === 0) {
    // Outside workflow callback: only skip if no steps
    return undefined;
  } else {
    // Outside workflow callback but has steps: count it
    stats.loopCount++;
  }

  // Only create loop node if there are step calls inside
  if (bodyChildren.length === 0) {
    return undefined;
  }

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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForInStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats, sagaContext, context);

  // Always count loops when inside workflow callback (for tree-sitter parity)
  if (context.isInWorkflowCallback) {
    stats.loopCount++;
  } else if (bodyChildren.length === 0) {
    // Outside workflow callback: only skip if no steps
    return undefined;
  } else {
    // Outside workflow callback but has steps: count it
    stats.loopCount++;
  }

  // Only create loop node if there are step calls inside
  if (bodyChildren.length === 0) {
    return undefined;
  }

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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  context: AnalysisContext = { stepNames: new Set(["step"]), isInWorkflowCallback: false, depth: 0 }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isWhileStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats, sagaContext, context);

  // Always count loops when inside workflow callback (for tree-sitter parity)
  if (context.isInWorkflowCallback) {
    stats.loopCount++;
  } else if (bodyChildren.length === 0) {
    // Outside workflow callback: only skip if no steps
    return undefined;
  } else {
    // Outside workflow callback but has steps: count it
    stats.loopCount++;
  }

  // Only create loop node if there are step calls inside
  if (bodyChildren.length === 0) {
    return undefined;
  }

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
  const workflowName = callee
    .replace(/\.runWithState$/, "")
    .replace(/\.run$/, "");

  return {
    id: generateId(),
    type: "workflow-ref",
    workflowName,
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
  
  // Check if first arg is a function (arrow or function expression)
  if (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg)) {
    // Heuristic: check for step/deps in parameters
    // This helps identify factory-generated workflows like createWorkflow(deps)(async (step, deps) => {...})
    const params = firstArg.getParameters();
    const paramText = params.map(p => p.getText()).join(',');
    if (paramText.includes("step") || paramText.includes("deps")) {
      return true;
    }
    // Still return true for any callback, but the heuristic helps with confidence
    return true;
  }
  
  return false;
}

// =============================================================================
// Utility Functions
// =============================================================================

function extractCallee(node: Node): string {
  const { Node } = loadTsMorph();
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const body = node.getBody();
    if (Node.isCallExpression(body)) {
      return body.getExpression().getText();
    }
    if (Node.isBlock(body)) {
      for (const stmt of body.getStatements()) {
        if (Node.isReturnStatement(stmt)) {
          const expr = stmt.getExpression();
          if (expr && Node.isCallExpression(expr)) {
            return expr.getExpression().getText();
          }
          break;
        }
      }
    }
    return body?.getText() ?? "<unknown>";
  }
  if (Node.isCallExpression(node)) {
    return node.getExpression().getText();
  }
  return node.getText();
}

/**
 * Unwrap step.dep('name', fn) so retry/withTimeout/try/fromResult get callee and depSource from the inner operation.
 * Returns the inner operation node and optional depSource from the wrapper's first argument.
 */
function unwrapStepDepOperation(operationArg: Node | undefined): { operation: Node | undefined; depSourceOverride?: string } {
  if (!operationArg) return { operation: undefined };
  const { Node } = loadTsMorph();
  if (!Node.isCallExpression(operationArg)) return { operation: operationArg };
  const calleeExpr = operationArg.getExpression();
  if (!Node.isPropertyAccessExpression(calleeExpr) || calleeExpr.getName() !== "dep") {
    return { operation: operationArg };
  }
  const depArgs = operationArg.getArguments();
  let depSourceOverride: string | undefined;
  if (depArgs[0] && Node.isStringLiteral(depArgs[0])) {
    depSourceOverride = depArgs[0].getLiteralValue();
  }
  const inner = depArgs[1] ?? operationArg;
  return { operation: inner, depSourceOverride };
}

/**
 * Get the inner call expression node from an operation (arrow/fn) used in step('id', fn) or step.retry('id', fn).
 * Returns the call node so we can resolve depLocation and keep callee text.
 */
function getInnerCallNodeFromOperation(operationArg: Node): Node | undefined {
  const { Node } = loadTsMorph();
  if (!operationArg) return undefined;
  let body: Node;
  if (Node.isArrowFunction(operationArg) || Node.isFunctionExpression(operationArg)) {
    body = operationArg.getBody();
    while (Node.isParenthesizedExpression(body)) body = body.getExpression();
    if (Node.isCallExpression(body)) return body;
    if (Node.isBlock(body)) {
      for (const stmt of body.getStatements()) {
        if (Node.isReturnStatement(stmt)) {
          const expr = stmt.getExpression();
          if (expr && Node.isCallExpression(expr)) return expr;
          break;
        }
      }
    }
  } else if (Node.isCallExpression(operationArg)) {
    return operationArg;
  }
  return undefined;
}

/**
 * Normalize callee to depSource (e.g. deps.fetchUser -> fetchUser) for grouping. Keeps callee as full expression.
 */
function normalizeCalleeToDepSource(callee: string | undefined): string | undefined {
  if (!callee) return undefined;
  const m = callee.match(/^(?:deps|ctx\.deps)\.([a-zA-Z_$][a-zA-Z0-9_$]*)/);
  return m ? m[1] : undefined;
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
    streamCount: 0,
    workflowRefCount: 0,
    unknownCount: 0,
    sagaWorkflowCount: 0,
    compensatedStepCount: 0,
  };
}

