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
  StaticStreamNode,
  StaticSagaStepNode,
  StaticSwitchNode,
  StaticSwitchCase,
  SourceLocation,
  DependencyInfo,
  AnalysisWarning,
  AnalysisStats,
  StaticRetryConfig,
  StaticTimeoutConfig,
} from "./types";

/**
 * Options for the static analyzer.
 */
export interface AnalyzerOptions {
  /** Path to tsconfig.json (optional, will use default if not provided) */
  tsConfigPath?: string;
  /** Whether to resolve and inline referenced workflows */
  resolveReferences?: boolean;
  /** Maximum depth for reference resolution (default: 5) */
  maxReferenceDepth?: number;
  /** Whether to include source locations in output */
  includeLocations?: boolean;
  /** Assume imports are present (for code snippets without imports) */
  assumeImported?: boolean;
  /** Filter which patterns to detect: 'run', 'createWorkflow', 'createSagaWorkflow', or 'all' */
  detect?: "run" | "createWorkflow" | "createSagaWorkflow" | "all";
}

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
// Workflow Discovery
// =============================================================================

interface WorkflowCallInfo {
  name: string;
  callExpression: Node;
  depsObject: Node | undefined;
  optionsObject: Node | undefined;
  callbackFunction: Node | undefined;
  variableDeclaration: Node | undefined;
  source: "createWorkflow" | "createSagaWorkflow" | "runSaga" | "run";
}

/**
 * Info about saga parameter destructuring.
 * e.g., `async (saga) => {...}` -> { name: "saga", isDestructured: false }
 * e.g., `async ({ step, tryStep }) => {...}` -> { isDestructured: true, stepAlias: "step", tryStepAlias: "tryStep" }
 */
interface SagaParameterInfo {
  name?: string;
  isDestructured: boolean;
  stepAlias?: string;
  tryStepAlias?: string;
}

/**
 * Context for saga analysis.
 */
interface SagaContext {
  isSagaWorkflow: boolean;
  sagaParamInfo?: SagaParameterInfo;
}

function findWorkflowCalls(sourceFile: SourceFile, opts: Required<AnalyzerOptions>): WorkflowCallInfo[] {
  const { Node } = loadTsMorph();
  const workflows: WorkflowCallInfo[] = [];

  // Track imports from awaitly
  const awaitlyImports = findAwaitlyImports(sourceFile, opts);

  // Track local declarations that shadow imports
  const localDeclarations = findLocalDeclarations(sourceFile);

  // Find all call expressions
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expression = node.getExpression();
    const text = expression.getText();

    // Check for createWorkflow calls
    if (text === "createWorkflow" && (opts.detect === "all" || opts.detect === "createWorkflow")) {
      // Only count if imported from awaitly or assumeImported
      if (awaitlyImports.has("createWorkflow") || opts.assumeImported) {
        const args = node.getArguments();
        const parent = node.getParent();

        let name = "anonymous";
        let variableDeclaration: Node | undefined;
        let depsObject: Node | undefined;
        let optionsObject: Node | undefined;

        // Try to get the name from variable declaration
        if (Node.isVariableDeclaration(parent)) {
          name = parent.getName();
          variableDeclaration = parent;
        } else if (Node.isPropertyAssignment(parent)) {
          name = parent.getName();
        }

        // createWorkflow can have (deps) or (deps, options)
        if (args[0]) {
          depsObject = args[0];
        }
        if (args[1] && Node.isObjectLiteralExpression(args[1])) {
          optionsObject = args[1];
        }

        workflows.push({
          name,
          callExpression: node,
          depsObject,
          optionsObject,
          callbackFunction: undefined,
          variableDeclaration,
          source: "createWorkflow",
        });
      }
    }

    // Check for createSagaWorkflow calls
    if (text === "createSagaWorkflow" && (opts.detect === "all" || opts.detect === "createSagaWorkflow")) {
      if (awaitlyImports.has("createSagaWorkflow") || opts.assumeImported) {
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
          optionsObject: args[1],
          callbackFunction: undefined,
          variableDeclaration,
          source: "createSagaWorkflow",
        });
      }
    }

    // Check for runSaga() calls
    if (text === "runSaga" && (opts.detect === "all" || opts.detect === "createSagaWorkflow")) {
      if (awaitlyImports.has("runSaga") || opts.assumeImported) {
        const args = node.getArguments();
        const line = node.getStartLineNumber();
        const filePath = sourceFile.getFilePath();
        const fileName = filePath.includes("/")
          ? filePath.split("/").pop() || filePath
          : filePath;

        workflows.push({
          name: `runSaga@${fileName}:${line}`,
          callExpression: node,
          depsObject: undefined,
          optionsObject: undefined,
          callbackFunction: args[0], // First argument is the callback
          variableDeclaration: undefined,
          source: "runSaga",
        });
      }
    }

    // Check for run() calls
    if (text === "run" && (opts.detect === "all" || opts.detect === "run")) {
      // Check if run is imported from awaitly (or assumeImported) and not shadowed
      const isImported = awaitlyImports.has("run") || opts.assumeImported;
      const isShadowed = isIdentifierShadowed("run", node, localDeclarations);

      // Don't match obj.run() - only bare run() calls
      if (isImported && !isShadowed && !Node.isPropertyAccessExpression(expression)) {
        const args = node.getArguments();
        const line = node.getStartLineNumber();
        const filePath = sourceFile.getFilePath();
        const fileName = filePath.includes("/")
          ? filePath.split("/").pop() || filePath
          : filePath;

        workflows.push({
          name: `run@${fileName}:${line}`,
          callExpression: node,
          depsObject: undefined,
          optionsObject: undefined,
          callbackFunction: args[0], // First argument is the callback
          variableDeclaration: undefined,
          source: "run",
        });
      }
    }
  });

  return workflows;
}

/**
 * Find awaitly imports in the source file.
 */
function findAwaitlyImports(sourceFile: SourceFile, _opts: Required<AnalyzerOptions>): Set<string> {
  const imports = new Set<string>();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // Check if importing from awaitly or awaitly/*
    if (moduleSpecifier === "awaitly" || moduleSpecifier.startsWith("awaitly/")) {
      // Check if this is a type-only import
      if (importDecl.isTypeOnly()) {
        continue; // Skip type-only imports
      }

      const namedImports = importDecl.getNamedImports();
      for (const namedImport of namedImports) {
        // Skip type-only import specifiers
        if (namedImport.isTypeOnly()) {
          continue;
        }
        const name = namedImport.getName();
        imports.add(name);
      }

      // Check default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        imports.add(defaultImport.getText());
      }
    }
  }

  return imports;
}

/**
 * Find local declarations (variables, functions, parameters) that might shadow imports.
 */
function findLocalDeclarations(sourceFile: SourceFile): Map<string, Node[]> {
  const { Node } = loadTsMorph();
  const declarations = new Map<string, Node[]>();

  sourceFile.forEachDescendant((node) => {
    let name: string | undefined;

    if (Node.isVariableDeclaration(node)) {
      name = node.getName();
    } else if (Node.isFunctionDeclaration(node)) {
      name = node.getName();
    } else if (Node.isParameterDeclaration(node)) {
      const nameNode = node.getNameNode();
      if (Node.isIdentifier(nameNode)) {
        name = nameNode.getText();
      }
    }

    if (name) {
      const existing = declarations.get(name) || [];
      existing.push(node);
      declarations.set(name, existing);
    }
  });

  return declarations;
}

/**
 * Check if an identifier is shadowed at a given call site.
 */
function isIdentifierShadowed(
  name: string,
  callSite: Node,
  localDeclarations: Map<string, Node[]>
): boolean {
  const { Node } = loadTsMorph();
  const decls = localDeclarations.get(name);
  if (!decls || decls.length === 0) return false;

  const callStart = callSite.getStart();

  for (const decl of decls) {
    // Get the scope of the declaration
    const declParent = decl.getParent();
    if (!declParent) continue;

    // Check if the call site is within the scope of this declaration
    const scopeParent = findContainingScope(decl);

    // For var declarations, they are hoisted to function scope
    // ts-morph returns string values: "var", "let", "const"
    const declKind = Node.isVariableDeclaration(decl)
      ? decl.getVariableStatement()?.getDeclarationKind()
      : undefined;
    const isVar = declKind === "var";

    if (isVar) {
      // var declarations are hoisted to function scope
      const declFunctionScope = findFunctionScope(decl);
      const callFunctionScope = findFunctionScope(callSite);
      if (declFunctionScope === callFunctionScope) {
        return true; // Shadowed by hoisted var
      }
    } else {
      // let/const are block-scoped
      if (scopeParent && isAncestorOf(scopeParent, callSite)) {
        // Check if the declaration comes before the call (for let/const)
        const declEnd = decl.getEnd();
        if (declEnd <= callStart) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Find the containing scope (block or function) of a node.
 */
function findContainingScope(node: Node): Node | undefined {
  const { Node } = loadTsMorph();
  let current = node.getParent();

  while (current) {
    if (Node.isBlock(current) ||
        Node.isFunctionDeclaration(current) ||
        Node.isArrowFunction(current) ||
        Node.isFunctionExpression(current) ||
        Node.isSourceFile(current)) {
      return current;
    }
    current = current.getParent();
  }

  return undefined;
}

/**
 * Find the function scope containing a node.
 */
function findFunctionScope(node: Node): Node | undefined {
  const { Node } = loadTsMorph();
  let current = node.getParent();

  while (current) {
    if (Node.isFunctionDeclaration(current) ||
        Node.isArrowFunction(current) ||
        Node.isFunctionExpression(current) ||
        Node.isSourceFile(current)) {
      return current;
    }
    current = current.getParent();
  }

  return undefined;
}

/**
 * Check if a node is an ancestor of another node.
 */
function isAncestorOf(ancestor: Node, descendant: Node): boolean {
  let current = descendant.getParent();

  while (current) {
    if (current === ancestor) return true;
    current = current.getParent();
  }

  return false;
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

  // Determine saga context for proper step detection
  const isSagaWorkflow = source === "createSagaWorkflow" || source === "runSaga";
  const sagaContext: SagaContext = { isSagaWorkflow };

  // For run() and runSaga(), the callback is already in callbackFunction
  const children: StaticFlowNode[] = [];

  if (source === "run" || source === "runSaga") {
    // run() and runSaga() have the callback as the first argument
    if (workflowInfo.callbackFunction) {
      // Extract saga parameter info for runSaga
      if (source === "runSaga") {
        sagaContext.sagaParamInfo = extractSagaParameterInfo(workflowInfo.callbackFunction);
      }
      // Extract step parameter info for proper step detection
      const stepParamInfo = extractStepParameterInfo(workflowInfo.callbackFunction);
      const analyzed = analyzeCallback(
        workflowInfo.callbackFunction,
        opts,
        warnings,
        stats,
        sagaContext,
        stepParamInfo
      );
      children.push(...analyzed);
    }
  } else {
    // For createWorkflow and createSagaWorkflow, find invocations
    const invocations = findWorkflowInvocations(workflowInfo, sourceFile);

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

  return {
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
  };
}

/**
 * Extract step parameter info from a workflow callback.
 * Handles: (step), ({ step }), ({ step: s }), ({ step = default }), ({ step: s = default })
 */
interface StepParameterInfo {
  name?: string;
  isDestructured: boolean;
  stepAlias?: string;
}

function extractStepParameterInfo(callback: Node): StepParameterInfo | undefined {
  const { Node } = loadTsMorph();

  let params: Node[] = [];
  if (Node.isArrowFunction(callback)) {
    params = callback.getParameters();
  } else if (Node.isFunctionExpression(callback)) {
    params = callback.getParameters();
  }

  if (params.length === 0) return undefined;

  const firstParam = params[0];
  if (!Node.isParameterDeclaration(firstParam)) return undefined;

  const nameNode = firstParam.getNameNode();

  // Check if it's destructured: ({ step }) or ({ step: s })
  if (Node.isObjectBindingPattern(nameNode)) {
    const result: StepParameterInfo = { isDestructured: true };

    for (const element of nameNode.getElements()) {
      const propName = element.getPropertyNameNode()?.getText() || element.getName();
      const bindingName = element.getName();

      if (propName === "step") {
        result.stepAlias = bindingName;
      }
    }

    return result;
  }

  // Not destructured: (step) or (s)
  return {
    name: nameNode.getText(),
    isDestructured: false,
  };
}

/**
 * Extract description and markdown from workflow options.
 * Can be in either the deps object or a separate options object.
 */
function extractWorkflowDocumentation(optionsNode: Node): {
  description?: string;
  markdown?: string;
} {
  const { Node } = loadTsMorph();
  const result: { description?: string; markdown?: string } = {};

  if (!Node.isObjectLiteralExpression(optionsNode)) {
    return result;
  }

  for (const prop of optionsNode.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "description" && init) {
      result.description = extractStringValue(init);
    } else if (propName === "markdown" && init) {
      result.markdown = extractStringValue(init);
    }
  }

  return result;
}

/**
 * Extract saga parameter info from a callback.
 * e.g., `async (saga) => {...}` -> { name: "saga", isDestructured: false }
 * e.g., `async ({ step, tryStep }) => {...}` -> { isDestructured: true, stepAlias: "step", tryStepAlias: "tryStep" }
 */
function extractSagaParameterInfo(callback: Node): SagaParameterInfo | undefined {
  const { Node } = loadTsMorph();

  let params: Node[] = [];
  if (Node.isArrowFunction(callback)) {
    params = callback.getParameters();
  } else if (Node.isFunctionExpression(callback)) {
    params = callback.getParameters();
  }

  if (params.length === 0) return undefined;

  const firstParam = params[0];
  if (!Node.isParameterDeclaration(firstParam)) return undefined;

  const nameNode = firstParam.getNameNode();

  // Check if it's destructured: ({ step, tryStep })
  if (Node.isObjectBindingPattern(nameNode)) {
    const result: SagaParameterInfo = { isDestructured: true };

    for (const element of nameNode.getElements()) {
      const propName = element.getPropertyNameNode()?.getText() || element.getName();
      const bindingName = element.getName();

      if (propName === "step") {
        result.stepAlias = bindingName;
      } else if (propName === "tryStep") {
        result.tryStepAlias = bindingName;
      }
    }

    return result;
  }

  // Not destructured: (saga)
  return {
    name: nameNode.getText(),
    isDestructured: false,
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

/**
 * Context for step detection within a workflow callback.
 */
interface StepContext {
  /** Names that refer to the step function (e.g., "step", "s", "runStep") */
  stepNames: Set<string>;
}

function analyzeCallback(
  callback: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepParamInfo?: StepParameterInfo
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

  // Build step context from step parameter info
  const stepContext: StepContext = { stepNames: new Set() };
  if (stepParamInfo) {
    if (stepParamInfo.isDestructured && stepParamInfo.stepAlias) {
      stepContext.stepNames.add(stepParamInfo.stepAlias);
    } else if (stepParamInfo.name) {
      stepContext.stepNames.add(stepParamInfo.name);
    }
  }
  // Default to "step" if no explicit parameter info
  if (stepContext.stepNames.size === 0) {
    stepContext.stepNames.add("step");
  }

  // Analyze the body
  return analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);
}

function analyzeNode(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  const results: StaticFlowNode[] = [];

  // Handle block statement
  if (Node.isBlock(node)) {
    for (const statement of node.getStatements()) {
      results.push(...analyzeNode(statement, opts, warnings, stats, sagaContext, stepContext));
    }
    return wrapInSequence(results, opts);
  }

  // Handle expression statement (e.g., await step(...))
  if (Node.isExpressionStatement(node)) {
    return analyzeNode(node.getExpression(), opts, warnings, stats, sagaContext, stepContext);
  }

  // Handle await expression
  if (Node.isAwaitExpression(node)) {
    return analyzeNode(node.getExpression(), opts, warnings, stats, sagaContext, stepContext);
  }

  // Handle parenthesized expression (e.g., (step(...)))
  if (Node.isParenthesizedExpression(node)) {
    return analyzeNode(node.getExpression(), opts, warnings, stats, sagaContext, stepContext);
  }

  // Handle variable declaration (const result = await step(...))
  if (Node.isVariableStatement(node)) {
    for (const decl of node.getDeclarationList().getDeclarations()) {
      const initializer = decl.getInitializer();
      if (initializer) {
        results.push(...analyzeNode(initializer, opts, warnings, stats, sagaContext, stepContext));
      }
    }
    return results;
  }

  // Handle call expression
  if (Node.isCallExpression(node)) {
    const analyzed = analyzeCallExpression(node, opts, warnings, stats, sagaContext, stepContext);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle if statement
  if (Node.isIfStatement(node)) {
    const analyzed = analyzeIfStatement(node, opts, warnings, stats, sagaContext, stepContext);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle switch statement
  if (Node.isSwitchStatement(node)) {
    const analyzed = analyzeSwitchStatement(node, opts, warnings, stats, sagaContext, stepContext);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for statement
  if (Node.isForStatement(node)) {
    const analyzed = analyzeForStatement(node, opts, warnings, stats, sagaContext, stepContext);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for-of statement
  if (Node.isForOfStatement(node)) {
    const analyzed = analyzeForOfStatement(node, opts, warnings, stats, sagaContext, stepContext);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle for-in statement
  if (Node.isForInStatement(node)) {
    const analyzed = analyzeForInStatement(node, opts, warnings, stats, sagaContext, stepContext);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle while statement
  if (Node.isWhileStatement(node)) {
    const analyzed = analyzeWhileStatement(node, opts, warnings, stats, sagaContext, stepContext);
    if (analyzed) {
      results.push(analyzed);
    }
    return results;
  }

  // Handle try statement
  if (Node.isTryStatement(node)) {
    const analyzed = analyzeTryStatement(node, opts, warnings, stats, sagaContext, stepContext);
    results.push(...analyzed);
    return results;
  }

  // Handle return statement
  if (Node.isReturnStatement(node)) {
    const expr = node.getExpression();
    if (expr) {
      return analyzeNode(expr, opts, warnings, stats, sagaContext, stepContext);
    }
    return results;
  }

  // Handle ternary/conditional expression
  if (Node.isConditionalExpression(node)) {
    const whenTrue = analyzeNode(node.getWhenTrue(), opts, warnings, stats, sagaContext, stepContext);
    const whenFalse = analyzeNode(node.getWhenFalse(), opts, warnings, stats, sagaContext, stepContext);
    results.push(...whenTrue, ...whenFalse);
    return results;
  }

  // Handle array literal (for Promise.all etc.)
  if (Node.isArrayLiteralExpression(node)) {
    for (const element of node.getElements()) {
      results.push(...analyzeNode(element, opts, warnings, stats, sagaContext, stepContext));
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
            results.push(...analyzeNode(body, opts, warnings, stats, sagaContext, stepContext));
          } else if (Node.isObjectLiteralExpression(init)) {
            // Recursively analyze nested objects
            results.push(...analyzeNode(init, opts, warnings, stats, sagaContext, stepContext));
          } else if (Node.isCallExpression(init)) {
            // Handle call expressions like tool({...}) - analyze their arguments
            for (const arg of init.getArguments()) {
              results.push(...analyzeNode(arg, opts, warnings, stats, sagaContext, stepContext));
            }
          }
        }
      }
    }
    return results;
  }

  // Handle arrow functions and function expressions (nested functions with step calls)
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    return analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);
  }

  if (Node.isFunctionExpression(node)) {
    const body = node.getBody();
    return analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);
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
  stepContext: StepContext
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  if (!Node.isTryStatement(node)) return [];

  const results: StaticFlowNode[] = [];

  // Analyze try block
  const tryBlock = node.getTryBlock();
  results.push(...analyzeNode(tryBlock, opts, warnings, stats, sagaContext, stepContext));

  // Analyze catch clause
  const catchClause = node.getCatchClause();
  if (catchClause) {
    results.push(...analyzeNode(catchClause.getBlock(), opts, warnings, stats, sagaContext, stepContext));
  }

  // Analyze finally block
  const finallyBlock = node.getFinallyBlock();
  if (finallyBlock) {
    results.push(...analyzeNode(finallyBlock, opts, warnings, stats, sagaContext, stepContext));
  }

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
  stepContext: StepContext = { stepNames: new Set(["step"]) }
): StaticFlowNode[] {
  const { Node } = loadTsMorph();
  // Handle arrow function (e.g., () => step(...))
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    return analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);
  }

  // Handle function expression (e.g., function() { step(...) })
  if (Node.isFunctionExpression(node)) {
    const body = node.getBody();
    return analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);
  }

  // Fallback: try analyzing as a regular node (e.g., a direct call expression)
  return analyzeNode(node, opts, warnings, stats, sagaContext, stepContext);
}

// =============================================================================
// Call Expression Analysis
// =============================================================================

function analyzeCallExpression(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
): StaticFlowNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isCallExpression(node)) return undefined;

  const expression = node.getExpression();
  const callee = expression.getText();
  const args = node.getArguments();

  // Handle saga workflow step detection
  if (sagaContext.isSagaWorkflow && sagaContext.sagaParamInfo) {
    const sagaParam = sagaContext.sagaParamInfo;

    // Destructured form: step() or tryStep()
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

  // Check for step calls using custom step parameter names
  const isStepCall = isStepFunctionCall(callee, stepContext);

  // step() call (regular workflow) - use stepContext to match custom parameter names
  if (isStepCall) {
    return analyzeStepCall(node, args, opts, warnings, stats);
  }

  // step.sleep() call
  if (isStepMethodCall(callee, "sleep", stepContext)) {
    return analyzeStepSleepCall(node, args, opts, stats);
  }

  // step.retry() call
  if (isStepMethodCall(callee, "retry", stepContext)) {
    return analyzeStepRetryCall(node, args, opts, warnings, stats);
  }

  // step.withTimeout() call
  if (isStepMethodCall(callee, "withTimeout", stepContext)) {
    return analyzeStepTimeoutCall(node, args, opts, warnings, stats);
  }

  // step.parallel() call
  if (isStepMethodCall(callee, "parallel", stepContext)) {
    return analyzeParallelCall(node, args, "all", opts, warnings, stats, sagaContext, stepContext);
  }

  // step.race() call
  if (isStepMethodCall(callee, "race", stepContext)) {
    return analyzeRaceCall(node, args, opts, warnings, stats, sagaContext, stepContext);
  }

  // Streaming operations
  if (isStepMethodCall(callee, "getWritable", stepContext)) {
    return analyzeStreamCall(node, "write", opts, stats);
  }
  if (isStepMethodCall(callee, "getReadable", stepContext)) {
    return analyzeStreamCall(node, "read", opts, stats);
  }
  if (isStepMethodCall(callee, "streamForEach", stepContext)) {
    return analyzeStreamCall(node, "forEach", opts, stats);
  }

  // allAsync() call
  if (callee === "allAsync") {
    return analyzeAllAsyncCall(node, args, "all", opts, warnings, stats, sagaContext, stepContext);
  }

  // allSettledAsync() call
  if (callee === "allSettledAsync") {
    return analyzeAllAsyncCall(node, args, "allSettled", opts, warnings, stats, sagaContext, stepContext);
  }

  // anyAsync() call
  if (callee === "anyAsync") {
    return analyzeAnyAsyncCall(node, args, opts, warnings, stats, sagaContext, stepContext);
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
      stepContext
    );
  }

  // Promise.all() - treat like allAsync for step detection
  if (callee === "Promise.all") {
    return analyzePromiseAllCall(node, args, opts, warnings, stats, sagaContext, stepContext);
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
        const callbackResults = analyzeCallbackArgument(args[0], opts, warnings, stats, sagaContext, stepContext);
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
 * Check if a callee represents a step function call.
 * Matches: step, s (custom param), runStep (alias), etc.
 * Does NOT match: obj.step (property access on non-step object)
 */
function isStepFunctionCall(callee: string, stepContext: StepContext): boolean {
  // Direct step call without property access
  if (stepContext.stepNames.has(callee)) {
    return true;
  }

  return false;
}

/**
 * Check if a callee represents a step method call.
 * Matches: step.sleep, s.sleep, runStep.retry, etc.
 */
function isStepMethodCall(callee: string, method: string, stepContext: StepContext): boolean {
  for (const stepName of stepContext.stepNames) {
    if (callee === `${stepName}.${method}`) {
      return true;
    }
  }

  return false;
}

/**
 * Analyze step.sleep() call.
 */
function analyzeStepSleepCall(
  node: Node,
  args: Node[],
  opts: Required<AnalyzerOptions>,
  stats: AnalysisStats
): StaticStepNode {
  const { Node } = loadTsMorph();
  stats.totalSteps++;

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    callee: "step.sleep",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract duration from first argument
  let durationText = "";
  if (args[0]) {
    if (Node.isStringLiteral(args[0])) {
      durationText = args[0].getLiteralValue();
    } else {
      durationText = args[0].getText();
    }
  }

  // Extract options from second argument
  if (args[1] && Node.isObjectLiteralExpression(args[1])) {
    const options = extractStepOptions(args[1]);
    if (options.key) stepNode.key = options.key;
    if (options.name) stepNode.name = options.name;
    // Extract description if present
    for (const prop of args[1].getProperties()) {
      if (Node.isPropertyAssignment(prop) && prop.getName() === "description") {
        const init = prop.getInitializer();
        if (init) {
          stepNode.description = extractStringValue(init);
        }
      }
    }
  }

  // Set default name if not provided
  if (!stepNode.name) {
    stepNode.name = durationText ? `sleep ${durationText}` : "sleep";
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
  stepContext: StepContext
): StaticFlowNode | undefined {
  const { Node } = loadTsMorph();

  if (!args[0]) return undefined;

  // Handle array literal: Promise.all([...])
  if (Node.isArrayLiteralExpression(args[0])) {
    const results: StaticFlowNode[] = [];
    for (const element of args[0].getElements()) {
      results.push(...analyzeNode(element, opts, warnings, stats, sagaContext, stepContext));
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
          return analyzeCallbackArgument(callbackArgs[0], opts, warnings, stats, sagaContext, stepContext)[0];
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
      // step(() => fetchUser(id)) or step(() => { return fetchUser(id); })
      const body = firstArg.getBody();
      if (Node.isCallExpression(body)) {
        // Arrow function with expression body: () => deps.fetchUser(id)
        stepNode.callee = body.getExpression().getText();
      } else if (Node.isBlock(body)) {
        // Block body: () => { return deps.fetchUser(id); }
        // Look for a return statement with a call expression
        const statements = body.getStatements();
        for (const stmt of statements) {
          if (Node.isReturnStatement(stmt)) {
            const returnExpr = stmt.getExpression();
            if (returnExpr && Node.isCallExpression(returnExpr)) {
              stepNode.callee = returnExpr.getExpression().getText();
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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
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

  // Check for step.parallel("name", callback) form
  if (args[0] && Node.isStringLiteral(args[0])) {
    parallelNode.name = args[0].getLiteralValue();
    // Analyze the callback in args[1]
    if (args[1]) {
      const children = analyzeCallbackArgument(args[1], opts, warnings, stats, sagaContext, stepContext);
      // If callback contains allAsync, extract its children
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

  // Check for step.parallel(NamedConstant, callback) form
  if (args[0] && !Node.isObjectLiteralExpression(args[0]) && !Node.isArrayLiteralExpression(args[0]) && args[1]) {
    // First arg is a name expression (like ParallelOps.fetchAll)
    parallelNode.name = args[0].getText();
    const children = analyzeCallbackArgument(args[1], opts, warnings, stats, sagaContext, stepContext);
    if (children.length === 1 && children[0].type === "parallel") {
      const inner = children[0] as StaticParallelNode;
      parallelNode.children = inner.children;
      parallelNode.mode = inner.mode;
      return parallelNode;
    }
    parallelNode.children.push(...children);
    return parallelNode;
  }

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
            const children = analyzeCallbackArgument(init, opts, warnings, stats, sagaContext, stepContext);
            if (children.length > 0) {
              const child = children[0];
              child.name = name;
              parallelNode.children.push(child);
            }
          }
        }
      }
    }
    // Check for options in second argument
    if (args[1] && Node.isObjectLiteralExpression(args[1])) {
      for (const prop of args[1].getProperties()) {
        if (Node.isPropertyAssignment(prop) && prop.getName() === "name") {
          const init = prop.getInitializer();
          if (init) {
            parallelNode.name = extractStringValue(init);
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
        const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, stepContext);
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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
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
      const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, stepContext);

      // If analyzeCallbackArgument found known patterns (step, etc.), use those
      if (children.length > 0) {
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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
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
    for (const element of args[0].getElements()) {
      // Try to extract implicit step first (arrow function with direct call)
      const implicitStep = tryExtractImplicitStep(element, opts, stats);
      if (implicitStep) {
        raceNode.children.push(implicitStep);
      } else {
        const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, stepContext);
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
          const implicitStep = tryExtractImplicitStep(init, opts, stats);
          if (implicitStep) {
            implicitStep.name = name;
            raceNode.children.push(implicitStep);
          } else {
            const children = analyzeCallbackArgument(init, opts, warnings, stats, sagaContext, stepContext);
            if (children.length > 0) {
              const child = children[0];
              child.name = name;
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
  stepContext: StepContext = { stepNames: new Set(["step"]) }
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
      const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, stepContext);
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

  // Extract the operation from first argument
  if (args[0]) {
    sagaNode.callee = extractCallee(args[0]);
    sagaNode.name = sagaNode.callee;
  }

  // Check for options object in second argument (saga.step(() => ..., { name, compensate }))
  if (args[1] && Node.isObjectLiteralExpression(args[1])) {
    const sagaOptions = extractSagaStepOptions(args[1]);
    if (sagaOptions.name) {
      sagaNode.name = sagaOptions.name;
    }
    if (sagaOptions.hasCompensation) {
      sagaNode.hasCompensation = true;
      sagaNode.compensationCallee = sagaOptions.compensationCallee;
      stats.compensatedStepCount = (stats.compensatedStepCount || 0) + 1;
    }
  }

  return sagaNode;
}

/**
 * Extract options from a saga step options object.
 * e.g., { name: 'Create Order', compensate: () => deps.cancelOrder() }
 */
function extractSagaStepOptions(optionsNode: Node): {
  name?: string;
  hasCompensation: boolean;
  compensationCallee?: string;
} {
  const { Node } = loadTsMorph();
  const result = {
    name: undefined as string | undefined,
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

    if (propName === "name" && init) {
      result.name = extractStringValue(init);
    } else if (propName === "compensate" && init) {
      result.hasCompensation = true;
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        const body = init.getBody();
        if (Node.isCallExpression(body)) {
          result.compensationCallee = body.getExpression().getText();
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
  stepContext: StepContext = { stepNames: new Set(["step"]) }
): StaticConditionalNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isIfStatement(node)) return undefined;

  const condition = node.getExpression().getText();
  const thenStatement = node.getThenStatement();
  const elseStatement = node.getElseStatement();

  const consequent = analyzeNode(thenStatement, opts, warnings, stats, sagaContext, stepContext);
  const alternate = elseStatement
    ? analyzeNode(elseStatement, opts, warnings, stats, sagaContext, stepContext)
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

function analyzeSwitchStatement(
  node: Node,
  opts: Required<AnalyzerOptions>,
  warnings: AnalysisWarning[],
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
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
      const analyzed = analyzeNode(statement, opts, warnings, stats, sagaContext, stepContext);
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

  if (!hasSteps) {
    return undefined;
  }

  stats.conditionalCount++;

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
  stepContext: StepContext = { stepNames: new Set(["step"]) }
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
    conditionalNode.consequent = analyzeCallbackArgument(args[1], opts, warnings, stats, sagaContext, stepContext);
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
  stepContext: StepContext = { stepNames: new Set(["step"]) }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);

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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForOfStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);

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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isForInStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);

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
  stats: AnalysisStats,
  sagaContext: SagaContext = { isSagaWorkflow: false },
  stepContext: StepContext = { stepNames: new Set(["step"]) }
): StaticLoopNode | undefined {
  const { Node } = loadTsMorph();
  if (!Node.isWhileStatement(node)) return undefined;

  const body = node.getStatement();
  const bodyChildren = analyzeNode(body, opts, warnings, stats, sagaContext, stepContext);

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
    streamCount: 0,
    workflowRefCount: 0,
    unknownCount: 0,
    sagaWorkflowCount: 0,
    compensatedStepCount: 0,
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
