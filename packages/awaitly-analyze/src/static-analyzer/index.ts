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
import { loadTsMorph } from "../ts-morph-loader";

import type {
  StaticWorkflowIR,
  StaticWorkflowNode,
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticConditionalNode,
  StaticDecisionNode,
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
} from "../types";

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

/**
 * Get the callee text, unwrapping ParenthesizedExpression so that (run)(cb)
 * is recognized as "run".
 */
function getCalleeText(expression: Node): string {
  const { Node } = loadTsMorph();
  let current: Node = expression;
  while (Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current.getText();
}

/**
 * Get the effective callee node (unwrap parentheses) for checks like
 * isPropertyAccessExpression.
 */
function getCalleeExpression(expression: Node): Node {
  const { Node } = loadTsMorph();
  let current: Node = expression;
  while (Node.isParenthesizedExpression(current)) {
    current = current.getExpression();
  }
  return current;
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
    const callee = getCalleeExpression(expression);
    const text = getCalleeText(expression);

    // Check for createWorkflow calls (direct, aliased, or via namespace/default import)
    const calleeExprText = Node.isPropertyAccessExpression(callee) ? callee.getExpression().getText() : "";
    const isNamespaceOrDefaultImport = awaitlyImports.namespaceImports.has(calleeExprText) || awaitlyImports.defaultImports.has(calleeExprText);
    const isCreateWorkflowCall =
      text === "createWorkflow" ||
      awaitlyImports.namedImportAliases.get(text) === "createWorkflow" ||
      (Node.isPropertyAccessExpression(callee) &&
        callee.getName() === "createWorkflow" &&
        isNamespaceOrDefaultImport);

    if (isCreateWorkflowCall && (opts.detect === "all" || opts.detect === "createWorkflow")) {
      // Only count if imported from awaitly or assumeImported
      if (awaitlyImports.namedImports.has("createWorkflow") || awaitlyImports.namespaceImports.size > 0 || awaitlyImports.defaultImports.size > 0 || opts.assumeImported) {
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

    // Check for createSagaWorkflow calls (direct, aliased, or via namespace/default import)
    const isCreateSagaWorkflowCall =
      text === "createSagaWorkflow" ||
      awaitlyImports.namedImportAliases.get(text) === "createSagaWorkflow" ||
      (Node.isPropertyAccessExpression(callee) &&
        callee.getName() === "createSagaWorkflow" &&
        isNamespaceOrDefaultImport);

    if (isCreateSagaWorkflowCall && (opts.detect === "all" || opts.detect === "createSagaWorkflow")) {
      if (awaitlyImports.namedImports.has("createSagaWorkflow") || awaitlyImports.namespaceImports.size > 0 || awaitlyImports.defaultImports.size > 0 || opts.assumeImported) {
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

    // Check for runSaga() calls (direct, aliased, or via namespace/default import)
    const isRunSagaCall =
      text === "runSaga" ||
      awaitlyImports.namedImportAliases.get(text) === "runSaga" ||
      (Node.isPropertyAccessExpression(callee) &&
        callee.getName() === "runSaga" &&
        isNamespaceOrDefaultImport);

    if (isRunSagaCall && (opts.detect === "all" || opts.detect === "createSagaWorkflow")) {
      if (awaitlyImports.namedImports.has("runSaga") || awaitlyImports.namespaceImports.size > 0 || awaitlyImports.defaultImports.size > 0 || opts.assumeImported) {
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

    // Check for run() calls (direct, aliased, or via namespace/default import)
    const isRunCall =
      text === "run" ||
      awaitlyImports.namedImportAliases.get(text) === "run" ||
      (Node.isPropertyAccessExpression(callee) &&
        callee.getName() === "run" &&
        isNamespaceOrDefaultImport);

    if (isRunCall && (opts.detect === "all" || opts.detect === "run")) {
      // Check if run is imported from awaitly (or assumeImported) and not shadowed
      const isImported = awaitlyImports.namedImports.has("run") || awaitlyImports.namedImportAliases.get(text) === "run" || awaitlyImports.namespaceImports.size > 0 || awaitlyImports.defaultImports.size > 0 || opts.assumeImported;
      const isShadowed = isIdentifierShadowed("run", node, localDeclarations);

      // For namespace/default calls (Awaitly.run()), we allow PropertyAccessExpression
      // For direct calls, we don't match obj.run() - only bare run() calls
      const isNamespaceCall = Node.isPropertyAccessExpression(callee) && isNamespaceOrDefaultImport;
      if (isImported && !isShadowed && (isNamespaceCall || !Node.isPropertyAccessExpression(callee))) {
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

interface AwaitlyImports {
  /** Named imports like { createWorkflow } - stores original names */
  namedImports: Set<string>;
  /** Maps local name (alias or original) to original name for named imports */
  namedImportAliases: Map<string, string>;
  /** Namespace imports like * as Awaitly */
  namespaceImports: Set<string>;
  /** Default imports like import Awaitly from 'awaitly' */
  defaultImports: Set<string>;
}

/**
 * Find awaitly imports in the source file.
 */
function findAwaitlyImports(sourceFile: SourceFile, _opts: Required<AnalyzerOptions>): AwaitlyImports {
  const result: AwaitlyImports = {
    namedImports: new Set<string>(),
    namedImportAliases: new Map<string, string>(),
    namespaceImports: new Set<string>(),
    defaultImports: new Set<string>(),
  };

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
        const originalName = namedImport.getName();
        const aliasNode = namedImport.getAliasNode();
        const localName = aliasNode ? aliasNode.getText() : originalName;
        result.namedImports.add(originalName);
        result.namedImportAliases.set(localName, originalName);
      }

      // Check default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        result.defaultImports.add(defaultImport.getText());
      }

      // Check namespace import (import * as X from 'awaitly')
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        result.namespaceImports.add(namespaceImport.getText());
      }
    }
  }

  return result;
}

/**
 * Find local declarations (variables, functions, parameters) that might shadow imports.
 */
function findLocalDeclarations(sourceFile: SourceFile): Map<string, Node[]> {
  const { Node } = loadTsMorph();
  const declarations = new Map<string, Node[]>();

  const addDeclaration = (name: string, node: Node) => {
    const existing = declarations.get(name) || [];
    existing.push(node);
    declarations.set(name, existing);
  };

  // Helper to extract names from binding patterns (destructuring)
  const extractBindingNames = (node: Node, containerNode: Node) => {
    if (Node.isIdentifier(node)) {
      addDeclaration(node.getText(), containerNode);
    } else if (Node.isObjectBindingPattern(node)) {
      for (const element of node.getElements()) {
        const nameNode = element.getNameNode();
        extractBindingNames(nameNode, containerNode);
      }
    } else if (Node.isArrayBindingPattern(node)) {
      for (const element of node.getElements()) {
        if (Node.isBindingElement(element)) {
          const nameNode = element.getNameNode();
          extractBindingNames(nameNode, containerNode);
        }
      }
    }
  };

  sourceFile.forEachDescendant((node) => {
    if (Node.isVariableDeclaration(node)) {
      const nameNode = node.getNameNode();
      extractBindingNames(nameNode, node);
    } else if (Node.isFunctionDeclaration(node)) {
      const name = node.getName();
      if (name) {
        addDeclaration(name, node);
      }
    } else if (Node.isParameterDeclaration(node)) {
      const nameNode = node.getNameNode();
      extractBindingNames(nameNode, node);
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
    }
  }

  return root;
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
 * Extract strict mode options from workflow options.
 */
function extractWorkflowStrictOptions(optionsNode: Node): {
  strict?: boolean;
  declaredErrors?: string[];
} {
  const { Node } = loadTsMorph();
  const result: { strict?: boolean; declaredErrors?: string[] } = {};

  if (!Node.isObjectLiteralExpression(optionsNode)) {
    return result;
  }

  for (const prop of optionsNode.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const propName = prop.getName();
    const init = prop.getInitializer();

    if (propName === "strict" && init) {
      if (Node.isTrueLiteral(init)) {
        result.strict = true;
      } else if (Node.isFalseLiteral(init)) {
        result.strict = false;
      }
    } else if (propName === "errors" && init) {
      result.declaredErrors = extractErrorsArray(init);
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

/**
 * Check if a node is contained within another node (is a descendant).
 */
function isDescendantOf(node: Node, potentialAncestor: Node): boolean {
  let current = node.getParent();
  while (current) {
    if (current === potentialAncestor) return true;
    current = current.getParent();
  }
  return false;
}

function findWorkflowInvocations(
  workflowInfo: WorkflowCallInfo,
  sourceFile: SourceFile
): WorkflowInvocation[] {
  const { Node } = loadTsMorph();
  const invocations: WorkflowInvocation[] = [];
  const workflowName = workflowInfo.name;

  // Get the position of the workflow definition to limit search
  const workflowDefinitionNode =
    workflowInfo.variableDeclaration || workflowInfo.callExpression;
  const workflowDefinitionPos = workflowDefinitionNode.getStart();

  // Scope in which this workflow's binding is visible. We only count invocations inside this scope.
  // For var declarations use function scope (var hoists); for const/let use containing block/function.
  let workflowContainingScope: Node | undefined;
  if (workflowInfo.variableDeclaration && Node.isVariableDeclaration(workflowInfo.variableDeclaration)) {
    const list = workflowInfo.variableDeclaration.getVariableStatement()?.getDeclarationKind();
    if (list === "var") {
      workflowContainingScope = findFunctionScope(workflowDefinitionNode);
    }
  }
  workflowContainingScope ??= findContainingScope(workflowDefinitionNode);

  // First pass: find all scopes where the workflow name is shadowed
  // This includes variable declarations AND function parameters
  const shadowingScopes: Node[] = [];

  /**
   * Extract all bound names from a name node.
   * Handles simple identifiers, object destructuring, and array destructuring.
   */
  function extractBoundNames(nameNode: Node): string[] {
    const names: string[] = [];

    if (Node.isIdentifier(nameNode)) {
      names.push(nameNode.getText());
    } else if (Node.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        const elementName = element.getNameNode();
        names.push(...extractBoundNames(elementName));
      }
    } else if (Node.isArrayBindingPattern(nameNode)) {
      for (const element of nameNode.getElements()) {
        if (Node.isBindingElement(element)) {
          const elementName = element.getNameNode();
          names.push(...extractBoundNames(elementName));
        }
      }
    }

    return names;
  }

  sourceFile.forEachDescendant((node) => {
    // Check for variable declarations that shadow the workflow name
    // Handles both simple identifiers and destructuring patterns
    if (Node.isVariableDeclaration(node)) {
      if (node.getStart() <= workflowDefinitionPos) return;

      const nameNode = node.getNameNode();
      const boundNames = extractBoundNames(nameNode);

      if (boundNames.includes(workflowName)) {
        // Check if this is a var declaration (function-scoped) vs const/let (block-scoped)
        const declarationList = node.getParent();
        const isVar =
          declarationList &&
          Node.isVariableDeclarationList(declarationList) &&
          declarationList.getDeclarationKind() === "var";

        // Find the containing scope based on declaration type
        let scope: Node | undefined = node.getParent();

        if (isVar) {
          // var hoists to function scope - find containing function
          while (
            scope &&
            !Node.isFunctionDeclaration(scope) &&
            !Node.isFunctionExpression(scope) &&
            !Node.isArrowFunction(scope) &&
            !Node.isSourceFile(scope)
          ) {
            scope = scope.getParent();
          }
        } else {
          // const/let are block-scoped - find containing block or function
          while (
            scope &&
            !Node.isFunctionDeclaration(scope) &&
            !Node.isFunctionExpression(scope) &&
            !Node.isArrowFunction(scope) &&
            !Node.isBlock(scope) &&
            !Node.isSourceFile(scope)
          ) {
            scope = scope.getParent();
          }
        }

        if (scope && !Node.isSourceFile(scope)) {
          shadowingScopes.push(scope);
        }
      }
      return;
    }

    // Check for function declarations that shadow the workflow name
    // Function declarations hoist to their containing block/function scope
    if (Node.isFunctionDeclaration(node)) {
      if (node.getStart() <= workflowDefinitionPos) return;

      const fnName = node.getName();
      if (fnName === workflowName) {
        // Find the containing scope (block or function)
        let scope: Node | undefined = node.getParent();
        while (
          scope &&
          !Node.isFunctionDeclaration(scope) &&
          !Node.isFunctionExpression(scope) &&
          !Node.isArrowFunction(scope) &&
          !Node.isBlock(scope) &&
          !Node.isSourceFile(scope)
        ) {
          scope = scope.getParent();
        }
        if (scope && !Node.isSourceFile(scope)) {
          shadowingScopes.push(scope);
        }
      }
    }

    // Check for function/method parameters that shadow the workflow name
    // Parameters shadow for the entire function body
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node)
    ) {
      if (node.getStart() <= workflowDefinitionPos) return;

      const parameters = node.getParameters();
      for (const param of parameters) {
        const paramNameNode = param.getNameNode();

        // Check if any bound name in the parameter matches the workflow name
        const boundNames = extractBoundNames(paramNameNode);
        if (boundNames.includes(workflowName)) {
          // The function itself is the shadowing scope
          shadowingScopes.push(node);
          break;
        }
      }
    }
  });

  // Second pass: find invocations, excluding those in shadowed scopes
  sourceFile.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;

    const expression = node.getExpression();
    const text = getCalleeText(expression);

    // Check if this is an invocation of our workflow
    // Handle: workflow(...), await workflow(...), (await workflow)(...)
    if (
      text === workflowName ||
      text === `await ${workflowName}` ||
      text === `(await ${workflowName})`
    ) {
      // Only count invocations that are inside this workflow's containing scope
      // (so inner workflow doesn't pick up outer invocations with the same name).
      const isInWorkflowScope =
        !workflowContainingScope || isDescendantOf(node, workflowContainingScope);
      // Check if this invocation is inside a scope that shadows the workflow name
      const isInShadowedScope = shadowingScopes.some((scope) =>
        isDescendantOf(node, scope)
      );

      if (isInWorkflowScope && !isInShadowedScope) {
        const args = node.getArguments();
        invocations.push({
          callExpression: node,
          callbackArg: args[0],
        });
      }
    }
  });

  return invocations;
}

// =============================================================================
// Callback Analysis
// =============================================================================

/**
 * Extended context for analyzing workflow structure.
 * Tracks whether we're inside the workflow callback to properly count
 * control structures regardless of whether they contain step calls.
 */
interface AnalysisContext {
  /** Names that refer to the step function */
  stepNames: Set<string>;
  /** Whether we're currently inside the workflow callback body */
  isInWorkflowCallback: boolean;
  /** Nesting depth for tracking nested functions */
  depth: number;
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

  // Build analysis context from step parameter info
  const context: AnalysisContext = { stepNames: new Set(), isInWorkflowCallback: true, depth: 0 };
  if (stepParamInfo) {
    if (stepParamInfo.isDestructured && stepParamInfo.stepAlias) {
      context.stepNames.add(stepParamInfo.stepAlias);
    } else if (stepParamInfo.name) {
      context.stepNames.add(stepParamInfo.name);
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
  const isStepCall = isStepFunctionCall(callee, context);

  // step() call (regular workflow) - use context to match custom parameter names
  if (isStepCall) {
    return analyzeStepCall(node, args, opts, warnings, stats);
  }

  // step.sleep() call
  if (isStepMethodCall(callee, "sleep", context)) {
    return analyzeStepSleepCall(node, args, opts, stats);
  }

  // step.retry() call
  if (isStepMethodCall(callee, "retry", context)) {
    return analyzeStepRetryCall(node, args, opts, warnings, stats);
  }

  // step.withTimeout() call
  if (isStepMethodCall(callee, "withTimeout", context)) {
    return analyzeStepTimeoutCall(node, args, opts, warnings, stats);
  }

  // step.parallel() call
  if (isStepMethodCall(callee, "parallel", context)) {
    return analyzeParallelCall(node, args, "all", opts, warnings, stats, sagaContext, context);
  }

  // step.race() call
  if (isStepMethodCall(callee, "race", context)) {
    return analyzeRaceCall(node, args, opts, warnings, stats, sagaContext, context);
  }

  // step.forEach() call
  if (isStepMethodCall(callee, "forEach", context)) {
    return analyzeStepForEachCall(node, args, opts, warnings, stats, sagaContext, context);
  }

  // step.branch() call - explicit conditional with metadata
  if (isStepMethodCall(callee, "branch", context)) {
    return analyzeStepBranchCall(node, args, opts, warnings, stats, sagaContext, context);
  }

  // Streaming operations
  if (isStepMethodCall(callee, "getWritable", context)) {
    return analyzeStreamCall(node, "write", opts, stats);
  }
  if (isStepMethodCall(callee, "getReadable", context)) {
    return analyzeStreamCall(node, "read", opts, stats);
  }
  if (isStepMethodCall(callee, "streamForEach", context)) {
    return analyzeStreamCall(node, "forEach", opts, stats);
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
 * Check if a callee represents a step method call.
 * Matches: step.sleep, s.sleep, runStep.retry, etc.
 */
function isStepMethodCall(callee: string, method: string, context: AnalysisContext): boolean {
  for (const stepName of context.stepNames) {
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
    if (options.description) stepNode.description = options.description;
    if (options.markdown) stepNode.markdown = options.markdown;
  }

  // Set default name if not provided
  if (!stepNode.name) {
    stepNode.name = durationText ? `sleep ${durationText}` : "sleep";
  }

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
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

  // Detect which form is being used:
  // New form: step('id', fn, opts) or step(dynamicId, fn, opts)
  // Legacy form: step(fn, opts?) or step(result, opts?)
  //
  // Detection heuristics:
  // 1. Three arguments → new form (legacy never has 3 args)
  // 2. First arg is string literal → new form
  // 3. First arg is template literal → new form (dynamic stepId)
  // 4. First arg is identifier AND second arg is function-like → new form (dynamic stepId)
  const firstArg = args[0];
  const secondArg = args[1];

  const isStringLiteralId = firstArg && Node.isStringLiteral(firstArg);
  const isTemplateLiteralId = firstArg && Node.isTemplateExpression(firstArg);
  const isNoSubstitutionTemplateLiteral = firstArg && Node.isNoSubstitutionTemplateLiteral(firstArg);
  const hasThreeArgs = args.length >= 3;
  const secondArgIsFunctionLike = secondArg && (
    Node.isArrowFunction(secondArg) ||
    Node.isFunctionExpression(secondArg) ||
    Node.isCallExpression(secondArg)
  );
  const firstArgIsIdentifier = firstArg && Node.isIdentifier(firstArg);

  const isNewForm = isStringLiteralId ||
                    isTemplateLiteralId ||
                    isNoSubstitutionTemplateLiteral ||
                    hasThreeArgs ||
                    (firstArgIsIdentifier && secondArgIsFunctionLike);

  let operationArg: Node | undefined;
  let optionsArg: Node | undefined;

  if (isNewForm) {
    // New form: step('id', fn, opts) or step(dynamicId, fn, opts)
    if (isStringLiteralId && Node.isStringLiteral(firstArg)) {
      stepNode.stepId = firstArg.getLiteralValue();
    } else if (isNoSubstitutionTemplateLiteral && Node.isNoSubstitutionTemplateLiteral(firstArg)) {
      stepNode.stepId = firstArg.getLiteralValue();
    } else {
      // Dynamic stepId (template literal, identifier, or other expression)
      stepNode.stepId = "<dynamic>";
    }
    operationArg = args[1];
    optionsArg = args[2];
  } else {
    // Legacy form: step(fn, opts?) or step(result, opts?)
    operationArg = args[0];
    optionsArg = args[1];
  }

  // Extract the operation being called and detect ctx.ref() reads
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

      // Extract ctx.ref() reads from the function body
      stepNode.reads = extractCtxRefReads(operationArg);

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
    } else {
      // step(someResult) - passing a result directly
      stepNode.callee = operationArg.getText();
    }
  }

  // Extract options
  if (optionsArg && Node.isObjectLiteralExpression(optionsArg)) {
    const options = extractStepOptions(optionsArg);
    if (options.key) stepNode.key = options.key;
    if (options.description) stepNode.description = options.description;
    if (options.markdown) stepNode.markdown = options.markdown;
    if (options.retry) stepNode.retry = options.retry;
    if (options.timeout) stepNode.timeout = options.timeout;
    // New API fields
    if (options.errors) stepNode.errors = options.errors;
    if (options.out) stepNode.out = options.out;
    if (options.dep) stepNode.depSource = options.dep;
    // Merge explicit reads with auto-detected ctx.ref() reads
    if (options.reads) {
      const existing = stepNode.reads ?? [];
      const merged = new Set([...existing, ...options.reads]);
      stepNode.reads = Array.from(merged);
    }
  }

  // Use stepId as name if no name specified (new API)
  if (!stepNode.name && stepNode.stepId) {
    stepNode.name = stepNode.stepId;
  }

  // Use callee as name if still no name specified (legacy fallback)
  if (!stepNode.name && stepNode.callee) {
    stepNode.name = stepNode.callee;
  }

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
  }

  return stepNode;
}

/**
 * Extract ctx.ref() reads from a function body.
 * Looks for patterns like ctx.ref('key') and extracts the key.
 */
function extractCtxRefReads(fnNode: Node): string[] | undefined {
  const { Node } = loadTsMorph();
  const reads: string[] = [];

  // Walk all descendants looking for ctx.ref() calls
  fnNode.forEachDescendant((descendant) => {
    if (Node.isCallExpression(descendant)) {
      const callee = descendant.getExpression();
      // Match ctx.ref('key') pattern
      if (Node.isPropertyAccessExpression(callee)) {
        const propName = callee.getName();
        const obj = callee.getExpression();
        if (propName === "ref" && obj.getText() === "ctx") {
          const args = descendant.getArguments();
          if (args[0] && Node.isStringLiteral(args[0])) {
            reads.push(args[0].getLiteralValue());
          }
        }
      }
    }
  });

  return reads.length > 0 ? reads : undefined;
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

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
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

  const statement = getContainingStatement(node);
  if (statement) {
    const jsdoc = getJSDocDescriptionFromNode(statement);
    if (jsdoc) stepNode.jsdocDescription = jsdoc;
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
    callee: "step.parallel",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Check for step.parallel("name", callback) form
  if (args[0] && Node.isStringLiteral(args[0])) {
    parallelNode.name = args[0].getLiteralValue();
    // Analyze the callback in args[1]
    if (args[1]) {
      const children = analyzeCallbackArgument(args[1], opts, warnings, stats, sagaContext, context);
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

  // Extract operations from arguments
  if (args[0] && Node.isObjectLiteralExpression(args[0])) {
    // Named parallel: step.parallel({ a: () => ..., b: () => ... })
    // Or strict form: step.parallel({ a: { fn: () => ..., errors: [...] }, ... })
    for (const prop of args[0].getProperties()) {
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName();
        const init = prop.getInitializer();
        if (init) {
          // Check for strict form: { fn: () => ..., errors: [...] }
          if (Node.isObjectLiteralExpression(init)) {
            const fnProp = init.getProperty("fn");
            const errorsProp = init.getProperty("errors");

            if (fnProp && Node.isPropertyAssignment(fnProp)) {
              const fnInit = fnProp.getInitializer();
              if (fnInit) {
                const implicitStep = tryExtractImplicitStep(fnInit, opts, stats);
                if (implicitStep) {
                  implicitStep.name = name;
                  // Extract errors if present
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

          // Standard form: property value is a function
          const implicitStep = tryExtractImplicitStep(init, opts, stats);
          if (implicitStep) {
            implicitStep.name = name;
            parallelNode.children.push(implicitStep);
          } else {
            const children = analyzeCallbackArgument(init, opts, warnings, stats, sagaContext, context);
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
        const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, context);
        parallelNode.children.push(...children);
      }
    }
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
        // Simple form: run: (item) => processItem(item)
        const bodyNodes = analyzeNode(init.getBody(), opts, warnings, stats, sagaContext, context);
        loopNode.body = bodyNodes;
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

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract callee for naming
  if (Node.isCallExpression(node)) {
    stepNode.callee = node.getExpression().getText();
    // Try to detect dep source from callee pattern: deps.xxx() or ctx.deps.xxx()
    const depMatch = stepNode.callee.match(/^(?:deps|ctx\.deps)\.([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (depMatch) {
      stepNode.depSource = depMatch[1];
      stepNode.name = depMatch[1];
    } else {
      stepNode.name = stepNode.callee;
    }
  } else {
    stepNode.callee = node.getText();
    stepNode.name = stepNode.callee;
  }

  return [stepNode];
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
    for (const element of args[0].getElements()) {
      // Use analyzeCallbackArgument for arrow functions/function expressions
      const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, context);

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
    for (const element of args[0].getElements()) {
      // Try to extract implicit step first (arrow function with direct call)
      const implicitStep = tryExtractImplicitStep(element, opts, stats);
      if (implicitStep) {
        raceNode.children.push(implicitStep);
      } else {
        const children = analyzeCallbackArgument(element, opts, warnings, stats, sagaContext, context);
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
            const children = analyzeCallbackArgument(init, opts, warnings, stats, sagaContext, context);
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
  }

  return sagaNode;
}

/**
 * Extract options from a saga step options object.
 * e.g., { name: 'Create Order', compensate: () => deps.cancelOrder() }
 */
function extractSagaStepOptions(optionsNode: Node): {
  name?: string;
  description?: string;
  markdown?: string;
  hasCompensation: boolean;
  compensationCallee?: string;
} {
  const { Node } = loadTsMorph();
  const result = {
    name: undefined as string | undefined,
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

    if (propName === "name" && init) {
      result.name = extractStringValue(init);
    } else if (propName === "description" && init) {
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
    let name: string;
    let typeSignature: string | undefined;

    if (Node.isPropertyAssignment(prop)) {
      name = prop.getName();
      const init = prop.getInitializer();
      if (init && typeof (init as { getType?: () => { getText: () => string } }).getType === "function") {
        try {
          const type = (init as { getType: () => { getText: () => string } }).getType();
          typeSignature = type.getText();
        } catch {
          // Type checker may be unavailable (e.g. no tsconfig); leave typeSignature undefined
        }
      }
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      name = prop.getName();
      const ident = prop.getNameNode();
      if (ident && typeof (ident as { getType?: () => { getText: () => string } }).getType === "function") {
        try {
          const type = (ident as { getType: () => { getText: () => string } }).getType();
          typeSignature = type.getText();
        } catch {
          // Type checker may be unavailable; leave typeSignature undefined
        }
      }
    } else {
      continue;
    }

    dependencies.push({
      name,
      typeSignature,
      errorTypes: [],
    });
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
  description?: string;
  markdown?: string;
  retry?: StaticRetryConfig;
  timeout?: StaticTimeoutConfig;
  // New API fields
  errors?: string[];
  out?: string;
  dep?: string;
  reads?: string[];
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
    } else if (propName === "description" && init) {
      options.description = extractStringValue(init);
    } else if (propName === "markdown" && init) {
      options.markdown = extractStringValue(init);
    } else if (propName === "retry" && init && Node.isObjectLiteralExpression(init)) {
      options.retry = extractRetryConfig(init);
    } else if (propName === "timeout" && init && Node.isObjectLiteralExpression(init)) {
      options.timeout = extractTimeoutConfig(init);
    } else if (propName === "errors" && init) {
      // Extract errors array: errors: ['A', 'B'] or errors: tags('A', 'B') or errors: someConst
      options.errors = extractErrorsArray(init);
    } else if (propName === "out" && init) {
      options.out = extractStringValue(init);
    } else if (propName === "dep" && init) {
      options.dep = extractStringValue(init);
    } else if (propName === "reads" && init) {
      // Extract reads array: reads: ['a', 'b']
      options.reads = extractStringArrayValue(init);
    }
  }

  return options;
}

/**
 * Extract a string array from an array literal: ['a', 'b']
 */
function extractStringArrayValue(node: Node): string[] | undefined {
  const { Node } = loadTsMorph();

  if (Node.isArrayLiteralExpression(node)) {
    const values: string[] = [];
    for (const element of node.getElements()) {
      const val = extractStringValue(element);
      if (val && val !== "<dynamic>") {
        values.push(val);
      }
    }
    return values.length > 0 ? values : undefined;
  }

  // Identifier - try to resolve const in same file
  if (Node.isIdentifier(node)) {
    const resolved = resolveConstValue(node);
    if (resolved) {
      return extractStringArrayValue(resolved);
    }
  }

  return undefined;
}

/**
 * Extract errors array from various forms:
 * - Array literal: ['A', 'B']
 * - tags() call: tags('A', 'B')
 * - err() call: err('A', 'B')
 * - Identifier (const reference): someErrors
 */
function extractErrorsArray(node: Node): string[] | undefined {
  const { Node } = loadTsMorph();

  // Array literal: ['A', 'B'] or []
  // Return empty array for explicit [], not undefined (distinguishes from "not declared")
  if (Node.isArrayLiteralExpression(node)) {
    const errors: string[] = [];
    for (const element of node.getElements()) {
      const val = extractStringValue(element);
      if (val && val !== "<dynamic>") {
        errors.push(val);
      }
    }
    return errors;
  }

  // tags() or err() call: tags('A', 'B') or tags()
  // Return empty array for explicit tags(), not undefined
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    const calleeName = callee.getText();
    if (calleeName === "tags" || calleeName === "err") {
      const errors: string[] = [];
      for (const arg of node.getArguments()) {
        const val = extractStringValue(arg);
        if (val && val !== "<dynamic>") {
          errors.push(val);
        }
      }
      return errors;
    }
  }

  // Identifier - try to resolve const in same file
  if (Node.isIdentifier(node)) {
    const resolved = resolveConstValue(node);
    if (resolved) {
      return extractErrorsArray(resolved);
    }
  }

  return undefined;
}

/**
 * Try to resolve a const identifier to its initializer value.
 * Only works for same-file const declarations.
 */
function resolveConstValue(identifier: Node): Node | undefined {
  const { Node } = loadTsMorph();

  if (!Node.isIdentifier(identifier)) {
    return undefined;
  }

  const sourceFile = identifier.getSourceFile();
  const name = identifier.getText();

  // Look for const declaration in the same file
  for (const stmt of sourceFile.getStatements()) {
    if (Node.isVariableStatement(stmt)) {
      const declList = stmt.getDeclarationList();
      // Only resolve const declarations
      if (declList.getDeclarationKind() !== "const") {
        continue;
      }
      for (const decl of declList.getDeclarations()) {
        if (decl.getName() === name) {
          return decl.getInitializer();
        }
      }
    }
  }

  return undefined;
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

/**
 * Get the statement that contains the given node (e.g. ExpressionStatement for `await step(...)`).
 */
function getContainingStatement(node: Node): Node | undefined {
  const { Node } = loadTsMorph();
  let current: Node | undefined = node;
  while (current) {
    const parent = current.getParent();
    if (!parent) return current;
    if (Node.isExpressionStatement(parent) || Node.isVariableStatement(parent)) return parent;
    if (Node.isBlock(parent)) return current;
    current = parent;
  }
  return undefined;
}

/**
 * Parse JSDoc comment text to extract description (text before first @tag).
 */
function parseJSDocCommentText(text: string): string | undefined {
  const inner = text
    .replace(/^\s*\/\*\*?\s*/, "")
    .replace(/\s*\*\/\s*$/, "")
    .replace(/^\s*\*\s?/gm, "\n")
    .trim();
  const beforeAt = inner.split(/\s*@/)[0].trim();
  return beforeAt || undefined;
}

/**
 * Extract JSDoc description from a node that may have getJsDocs() (e.g. VariableStatement)
 * or from leading comment ranges (e.g. ExpressionStatement).
 * Returns the main description text (text before first @tag).
 */
function getJSDocDescriptionFromNode(node: Node): string | undefined {

  // Try getJsDocs() first (VariableStatement, FunctionDeclaration, etc.)
  const n = node as { getJsDocs?: () => { getDescription: () => string; getInnerText?: () => string }[] };
  if (typeof n.getJsDocs === "function") {
    try {
      const docs = n.getJsDocs();
      if (docs && docs.length > 0) {
        const first = docs[0];
        const desc = first.getDescription?.();
        if (desc && desc.trim()) return desc.trim();
        const inner = first.getInnerText?.();
        if (inner) {
          const beforeAt = inner.split(/\s*@/)[0].trim();
          if (beforeAt) return beforeAt;
        }
      }
    } catch {
      // ignore
    }
  }

  // Fallback: leading comment ranges (for ExpressionStatement, VariableStatement, etc.)
  if (typeof node.getLeadingCommentRanges === "function") {
    const ranges = node.getLeadingCommentRanges();
    if (ranges && ranges.length > 0) {
      for (let i = ranges.length - 1; i >= 0; i--) {
        const range = ranges[i];
        const text = range.getText();
        if (text.startsWith("/**")) {
          const parsed = parseJSDocCommentText(text);
          if (parsed) return parsed;
          break;
        }
      }
    }
  }

  // Fallback: scan source text. Node may start with JSDoc (e.g. VariableStatement) or have JSDoc immediately before it.
  const sourceFile = node.getSourceFile();
  const fullText = sourceFile.getFullText();
  const start = node.getStart();

  // If node starts with /** then JSDoc is the first token (e.g. VariableStatement in TS AST)
  if (fullText.slice(start, start + 3) === "/**") {
    const afterStart = fullText.slice(start);
    const endMatch = afterStart.match(/\*\/\s*/);
    if (endMatch && endMatch.index != null) {
      const commentText = afterStart.slice(0, endMatch.index + 2);
      const parsed = parseJSDocCommentText(commentText);
      if (parsed) return parsed;
    }
  }

  // Otherwise look for /** ... */ that ends immediately before the node (only whitespace between)
  const textBefore = fullText.slice(0, start);
  const re = /\/\*\*([\s\S]*?)\*\//g;
  let match: RegExpExecArray | null;
  let lastMatch: RegExpExecArray | null = null;
  while ((match = re.exec(textBefore)) !== null) {
    lastMatch = match;
  }
  if (lastMatch) {
    const afterComment = lastMatch.index + lastMatch[0].length;
    const between = textBefore.slice(afterComment);
    if (/^\s*$/.test(between)) {
      const parsed = parseJSDocCommentText(lastMatch[0]);
      if (parsed) return parsed;
    }
  }
  return undefined;
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
