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
  type SourceLocation,
  type DependencyInfo,
  type AnalysisWarning,
  type AnalysisStats,
  type StaticRetryConfig,
  type StaticTimeoutConfig,
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
// Workflow Discovery
// =============================================================================

interface WorkflowCallInfo {
  name: string;
  /**
   * Identifier name used to invoke the workflow (e.g. `myWorkflow(...)`).
   * This is usually the variable name the factory call is assigned to.
   *
   * Note: This is distinct from `name`, which is the workflow's canonical name
   * (for createWorkflow/createSagaWorkflow this should come from the explicit first argument).
   */
  bindingName?: string;
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

/**
 * Get the callee as an Identifier if possible (unwrap parentheses and await).
 * Returns undefined for property access (e.g. obj.run) or other non-identifier callees.
 * Handles (await (workflow)) by unwrapping parentheses again after await.
 */
function getCalleeIdentifier(expression: Node): Node | undefined {
  const { Node } = loadTsMorph();
  let current: Node = expression;
  while (true) {
    while (Node.isParenthesizedExpression(current)) {
      current = current.getExpression();
    }
    if (Node.isAwaitExpression(current)) {
      current = (current as { getExpression: () => Node }).getExpression();
      continue;
    }
    break;
  }
  return Node.isIdentifier(current) ? current : undefined;
}

function findWorkflowCalls(sourceFile: SourceFile, opts: Required<AnalyzerOptions>): WorkflowCallInfo[] {
  const { Node } = loadTsMorph();
  const workflows: WorkflowCallInfo[] = [];

  // Track imports from awaitly
  const awaitlyImports = findAwaitlyImports(sourceFile, opts);

  // Track local declarations that shadow imports
  const localDeclarations = findLocalDeclarations(sourceFile);

  function resolveWorkflowNameArg(arg: Node | undefined): string | undefined {
    if (!arg) return undefined;
    if (Node.isStringLiteral(arg)) return arg.getLiteralText();
    if (Node.isNoSubstitutionTemplateLiteral(arg)) return arg.getLiteralText();
    // Best-effort: keep something stable for labels (may be dynamic).
    return arg.getText();
  }

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

        let bindingName: string | undefined;
        let variableDeclaration: Node | undefined;
        let depsObject: Node | undefined;
        let optionsObject: Node | undefined;

        // Track the binding name (how this workflow is invoked in code)
        if (Node.isVariableDeclaration(parent)) {
          bindingName = parent.getName();
          variableDeclaration = parent;
        } else if (Node.isPropertyAssignment(parent)) {
          bindingName = parent.getName();
        }

        // createWorkflow(workflowName) or createWorkflow(workflowName, deps, options?)
        if (args.length >= 1 && args[0]) {
          const name = resolveWorkflowNameArg(args[0]) ?? bindingName ?? "anonymous";
          depsObject = args.length >= 2 ? args[1] : undefined;
          if (args.length >= 3 && args[2] && Node.isObjectLiteralExpression(args[2])) {
            optionsObject = args[2];
          }

          workflows.push({
          name,
          bindingName,
          callExpression: node,
          depsObject,
          optionsObject,
          callbackFunction: undefined,
          variableDeclaration,
          source: "createWorkflow",
        });
        }
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

        let bindingName: string | undefined;
        let variableDeclaration: Node | undefined;
        let depsObject: Node | undefined;
        let optionsObject: Node | undefined;

        // Track the binding name (how this saga is invoked in code)
        if (Node.isVariableDeclaration(parent)) {
          bindingName = parent.getName();
          variableDeclaration = parent;
        } else if (Node.isPropertyAssignment(parent)) {
          bindingName = parent.getName();
        }

        // createSagaWorkflow(workflowName, deps, options?) — deps required (no name-only form at runtime)
        if (args.length >= 2 && args[0]) {
          const name = resolveWorkflowNameArg(args[0]) ?? bindingName ?? "anonymous";
          depsObject = args[1];
          if (args[2] && Node.isObjectLiteralExpression(args[2])) {
            optionsObject = args[2];
          }

          workflows.push({
            name,
            callExpression: node,
            bindingName,
            depsObject,
            optionsObject,
            callbackFunction: undefined,
            variableDeclaration,
            source: "createSagaWorkflow",
          });
        }
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
  let callbackForReturnType: Node | undefined;

  if (source === "run" || source === "runSaga") {
    callbackForReturnType = workflowInfo.callbackFunction;
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

  // Best-effort: workflow callback return type (inline callback or callback-by-identifier)
  try {
    const inferred = getWorkflowCallbackReturnType(callbackForReturnType);
    if (inferred) root.workflowReturnType = inferred;
  } catch {
    // ignore
  }

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
 * Infer workflow callback return type from the callback node (inline function or identifier).
 * When the callback is passed by identifier (e.g. workflow(callback)), resolves to the
 * declaration and gets return type from the initializer or function declaration.
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
  const workflowName = workflowInfo.bindingName ?? workflowInfo.name;

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
      // When we have the actual workflow variable declaration, require the call's
      // callee to resolve to that declaration (avoids same-name different variable).
      if (workflowInfo.variableDeclaration) {
        const calleeId = getCalleeIdentifier(expression);
        if (calleeId) {
          const symbol = calleeId.getSymbol();
          if (symbol) {
            const decls = symbol.getDeclarations();
            const isSameBinding = decls.some(
              (d) => d === workflowInfo.variableDeclaration
            );
            if (!isSameBinding) return;
          }
        }
      }

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

  // ── Fallback: factory pattern support ──
  // When createWorkflow() is returned from a function (no variable binding),
  // the direct binding-name search above finds nothing. Try two fallbacks:
  //
  // 1. Factory tracing: find calls to the enclosing factory function in the
  //    same file, trace the result variable, and find invocations of it.
  // 2. Deps-signature matching: find any callback invocation whose parameter
  //    destructuring matches the workflow's dependency names.
  if (invocations.length === 0 && !workflowInfo.bindingName) {
    // Fallback 1: Factory tracing
    // Check if createWorkflow is returned from a named function
    let factoryName: string | undefined;
    let factoryDecl: Node | undefined;
    let current: Node | undefined = workflowInfo.callExpression.getParent();
    while (current) {
      if (Node.isReturnStatement(current) || Node.isArrowFunction(current)) {
        // Walk up to find enclosing named function
        let scope: Node | undefined = current.getParent();
        while (scope) {
          if (Node.isFunctionDeclaration(scope)) {
            factoryName = (scope as { getName?: () => string | undefined }).getName?.();
            factoryDecl = scope;
            break;
          }
          if (Node.isVariableDeclaration(scope)) {
            const init = scope.getInitializer();
            if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
              factoryName = scope.getName();
              factoryDecl = scope;
              break;
            }
          }
          scope = scope.getParent();
        }
        break;
      }
      current = current.getParent();
    }

    if (factoryName && factoryDecl) {
      // Search for calls to the factory function that resolve to this declaration
      // (not a shadowed same-named function), then trace result variable declarations.
      const factoryResultDecls: Node[] = [];
      sourceFile.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const expression = node.getExpression();
        const calleeId = getCalleeIdentifier(expression);
        if (!calleeId || calleeId.getText() !== factoryName) return;
        const symbol = calleeId.getSymbol();
        if (!symbol) return;
        const decls = symbol.getDeclarations();
        const isOurFactory = decls.some((d) => d === factoryDecl);
        if (!isOurFactory) return;
        const parent = node.getParent();
        if (parent && Node.isVariableDeclaration(parent)) {
          factoryResultDecls.push(parent);
        }
      });

      // Find invocations only when the callee resolves to a factory result variable
      // (avoids same-name different variable and method calls like obj.run(cb)).
      sourceFile.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) return;
        const expression = node.getExpression();
        const calleeId = getCalleeIdentifier(expression);
        if (!calleeId) return;
        const symbol = calleeId.getSymbol();
        if (!symbol) return;
        const decls = symbol.getDeclarations();
        const isFactoryResultVar = decls.some((d) =>
          factoryResultDecls.includes(d)
        );
        if (!isFactoryResultVar) return;
        const args = node.getArguments();
        if (args.length > 0) {
          const firstArg = args[0];
          if (Node.isArrowFunction(firstArg) || Node.isFunctionExpression(firstArg)) {
            invocations.push({
              callExpression: node,
              callbackArg: firstArg,
            });
          }
        }
      });
    }

    // Fallback 2: Deps-signature matching
    // When the workflow is invoked via a parameter (e.g., function run(workflow) { workflow(cb) }),
    // match by checking if the callback's second parameter destructures the same dep names.
    if (invocations.length === 0 && workflowInfo.depsObject) {
      const depNames = extractDepNamesFromObject(workflowInfo.depsObject);

      if (depNames.length > 0) {
        sourceFile.forEachDescendant((node) => {
          if (!Node.isCallExpression(node)) return;
          const expression = node.getExpression();
          // Only consider `workflow(cb)` where `workflow` is a function parameter.
          // Unwrap parentheses and await so (workflow)(cb) and (await workflow)(cb) are recognized.
          const calleeId = getCalleeIdentifier(expression);
          if (!calleeId) return;
          const symbol = calleeId.getSymbol();
          if (!symbol) return;
          const isParameterCallee = symbol
            .getDeclarations()
            .some((decl) => Node.isParameterDeclaration(decl));
          if (!isParameterCallee) return;

          const args = node.getArguments();
          if (args.length === 0) return;

          const firstArg = args[0];
          if (!Node.isArrowFunction(firstArg) && !Node.isFunctionExpression(firstArg)) return;

          // Callback must have at least 2 parameters (step + deps)
          const params = (firstArg as { getParameters: () => Node[] }).getParameters();
          if (params.length < 2) return;

          // Second parameter must destructure names matching the workflow's deps
          const secondParam = params[1];
          if (!Node.isParameterDeclaration(secondParam)) return;
          const depsNameNode = secondParam.getNameNode();
          if (!Node.isObjectBindingPattern(depsNameNode)) return;

          const boundNames = depsNameNode.getElements().map((e: { getName: () => string }) => e.getName());
          // Require all workflow dep names to appear in the callback destructuring
          const allDepsPresent = depNames.every((d) => boundNames.includes(d));

          if (allDepsPresent) {
            // Guard: skip if the callee resolves to a locally-defined
            // function/variable (not a parameter) – those are unlikely to be
            // workflow invocations.
            if (calleeId) {
              const ident = calleeId as { getDefinitionNodes?: () => Node[] };
              const defs = ident.getDefinitionNodes?.() ?? [];
              const isLocalNonParam = defs.some(
                (d: Node) =>
                  Node.isFunctionDeclaration(d) ||
                  Node.isVariableDeclaration(d)
              );
              if (isLocalNonParam) return;
            }
            invocations.push({
              callExpression: node,
              callbackArg: firstArg,
            });
          }
        });
      }
    }
  }

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

  // step.try() call
  if (isStepMethodCall(callee, "try", context)) {
    return analyzeStepTryCall(node, args, opts, warnings, stats);
  }

  // step.fromResult() call
  if (isStepMethodCall(callee, "fromResult", context)) {
    return analyzeStepFromResultCall(node, args, opts, warnings, stats);
  }

  // Effect-style ergonomics methods
  // step.run() - unwrap AsyncResult directly
  if (isStepMethodCall(callee, "run", context)) {
    return analyzeStepCall(node, args, opts, warnings, stats);
  }

  // step.andThen() - chain AsyncResults
  if (isStepMethodCall(callee, "andThen", context)) {
    return analyzeStepCall(node, args, opts, warnings, stats);
  }

  // step.match() - pattern matching (treated as a step call)
  if (isStepMethodCall(callee, "match", context)) {
    return analyzeStepCall(node, args, opts, warnings, stats);
  }

  // step.all() - alias for step.parallel()
  if (isStepMethodCall(callee, "all", context)) {
    return analyzeParallelCall(node, args, "all", opts, warnings, stats, sagaContext, context);
  }

  // step.map() - parallel batch mapping (similar to parallel)
  if (isStepMethodCall(callee, "map", context)) {
    return analyzeStepCall(node, args, opts, warnings, stats);
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

  const stepNode: StaticStepNode = {
    id: generateId(),
    type: "step",
    stepId,
    callee: "step.sleep",
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  // Extract options from third argument
  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    const options = extractStepOptions(args[2]);
    if (options.key) stepNode.key = options.key;
    if (options.description) stepNode.description = options.description;
    if (options.markdown) stepNode.markdown = options.markdown;
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
  stats: AnalysisStats
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

  // In awaitly, step name is always derived from the first argument (id), not from options.
  if (!stepNode.name) {
    stepNode.name = stepNode.stepId;
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

  if (opts.includeLocations && innerCallNode) {
    const { Node } = loadTsMorph();
    if (Node.isCallExpression(innerCallNode)) {
      const calleeExpr = innerCallNode.getExpression();
      stepNode.depLocation = getDefinitionLocationForCallee(calleeExpr) ?? getLocation(calleeExpr);
    }
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
    callee: operationCallee,
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
    callee: operationCallee,
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
    callee: operationCallee ?? "step.try",
    depSource: depSourceOverride ?? normalizeCalleeToDepSource(operationCallee),
    name: stepId,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  inferStepIOFromInnerCall(node, innerCallNode, stepNode);

  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    const options = extractStepOptions(args[2]);
    if (options.key) stepNode.key = options.key;
    if (options.dep) stepNode.depSource = options.dep;
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
    callee: operationCallee ?? "step.fromResult",
    depSource: depSourceOverride ?? normalizeCalleeToDepSource(operationCallee),
    name: stepId,
    location: opts.includeLocations ? getLocation(node) : undefined,
  };

  inferStepIOFromInnerCall(node, innerCallNode, stepNode);

  if (args[2] && Node.isObjectLiteralExpression(args[2])) {
    const options = extractStepOptions(args[2]);
    if (options.key) stepNode.key = options.key;
    if (options.dep) stepNode.depSource = options.dep;
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
    callee: "step.parallel",
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
    for (const prop of operationsNode.getProperties()) {
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName();
        const init = prop.getInitializer();
        if (init) {
          if (Node.isObjectLiteralExpression(init)) {
            const fnProp = init.getProperty("fn");
            const errorsProp = init.getProperty("errors");
            if (fnProp && Node.isPropertyAssignment(fnProp)) {
              const fnInit = fnProp.getInitializer();
              if (fnInit) {
                const implicitStep = tryExtractImplicitStep(fnInit, opts, stats);
                if (implicitStep) {
                  implicitStep.name = name;
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
      const name = extractFunctionName(callee);
      stats.totalSteps++;
      return {
        id: generateId(),
        type: "step",
        stepId: `implicit:${name}`,
        location: opts.includeLocations ? getLocation(body) : undefined,
        callee,
        name,
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
        const name = extractFunctionName(callee);
        stats.totalSteps++;
        return {
          id: generateId(),
          type: "step",
          stepId: `implicit:${name}`,
          location: opts.includeLocations ? getLocation(expr) : undefined,
          callee,
          name,
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
        const name = extractFunctionName(callee);
        stats.totalSteps++;
        const implicitStep: StaticStepNode = {
          id: generateId(),
          type: "step",
          stepId: `implicit:${name}`,
          location: opts.includeLocations ? getLocation(element) : undefined,
          callee,
          name,
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

/**
 * Extract just the property names from an object literal expression.
 * Used for deps-signature matching in the factory pattern fallback.
 */
function extractDepNamesFromObject(depsNode: Node): string[] {
  const { Node } = loadTsMorph();
  const names: string[] = [];

  if (!Node.isObjectLiteralExpression(depsNode)) {
    return names;
  }

  for (const prop of depsNode.getProperties()) {
    if (Node.isPropertyAssignment(prop)) {
      names.push(prop.getName());
    } else if (Node.isShorthandPropertyAssignment(prop)) {
      names.push(prop.getName());
    }
  }

  return names;
}

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

    const errorTypes = inferErrorTypesFromSignature(typeSignature);

    dependencies.push({
      name,
      typeSignature,
      errorTypes,
    });
  }

  return dependencies;
}

/**
 * Best-effort: infer error type union from Result<T, E> in a type signature string.
 * Handles Promise<Result<T, E>> and Result<T, E>. Extracts string literal union members.
 * T may contain commas (e.g. tuple [number, string]), so we only treat a comma at
 * depth 1 (outside any nested <>, [], {}, ()) as the T/E separator.
 */
function inferErrorTypesFromSignature(typeSignature: string | undefined): string[] {
  if (!typeSignature) return [];
  const resultMatch = typeSignature.match(/Result\s*</);
  if (!resultMatch) return [];
  const start = resultMatch.index! + resultMatch[0].length;
  let depth = 1;
  let i = start;
  let firstComma = -1;
  while (i < typeSignature.length && depth > 0) {
    const c = typeSignature[i];
    if (c === "<" || c === "[" || c === "{" || c === "(") depth++;
    else if (c === ">" || c === "]" || c === "}" || c === ")") depth--;
    else if (c === "," && depth === 1 && firstComma < 0) firstComma = i;
    i++;
  }
  if (firstComma < 0 || depth !== 0) return [];
  const secondArg = typeSignature.slice(firstComma + 1, i - 1).trim();
  const parts = secondArg.split(/\s*\|\s*/).map((s) => s.trim().replace(/^["']|["']$/g, ""));
  return parts.filter((s) => s.length > 0 && /^[A-Z_][A-Z0-9_]*$/i.test(s));
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

/**
 * Step options we extract from step('id', fn, opts).
 * Aligns with awaitly: step identity/name is always the first argument, never in opts.
 * Same in awaitly: step('id', ...), step.sleep/retry/withTimeout/try/fromResult('id', ...),
 * step.parallel(name, ...), step.race(name, ...), saga.step(name, ...), saga.tryStep(name, ...).
 */
interface StepOptions {
  key?: string;
  description?: string;
  markdown?: string;
  retry?: StaticRetryConfig;
  timeout?: StaticTimeoutConfig;
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

    // Intentionally do not extract "name": in awaitly, step name/ID is always the first argument.
    if (propName === "name") continue;

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
 * Best-effort: infer stepNode.outputType and stepNode.inputType from the inner call using the type checker.
 * Uses the TypeScript compiler node so getResolvedSignature resolves correctly (ts-morph wrapper can miss in some setups).
 */
function inferStepIOFromInnerCall(
  contextNode: Node,
  innerCallNode: Node | undefined,
  stepNode: StaticStepNode
): void {
  const { Node } = loadTsMorph();
  if (!innerCallNode || !Node.isCallExpression(innerCallNode)) return;
  try {
    const project = contextNode.getSourceFile().getProject();
    const typeChecker = project.getTypeChecker();
    const tc = typeChecker.compilerObject as ts.TypeChecker;
    const tsNode = (innerCallNode as { compilerNode: ts.CallExpression }).compilerNode;
    const sig = tc.getResolvedSignature(tsNode);
    if (sig) {
      stepNode.outputType = tc.typeToString(sig.getReturnType());
      const decl = sig.getDeclaration();
      if (decl && "parameters" in decl && Array.isArray((decl as ts.SignatureDeclaration).parameters)) {
        const params = (decl as ts.SignatureDeclaration).parameters;
        if (params.length > 0) {
          const parts = params
            .map((p: ts.ParameterDeclaration) => (p.type ? tc.getTypeFromTypeNode(p.type) : null))
            .filter((t: ts.Type | null): t is ts.Type => t != null)
            .map((t: ts.Type) => tc.typeToString(t));
          if (parts.length > 0) stepNode.inputType = parts.join(", ");
        }
      }
    }
  } catch {
    // Type checker may be unavailable or call not resolved
  }
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

/**
 * Resolve the definition location of a callee expression (e.g. deps.getBatch).
 * Uses the type checker: symbol at location, or for property access the type's symbol.
 */
function getDefinitionLocationForCallee(calleeNode: Node): SourceLocation | undefined {
  const { Node } = loadTsMorph();
  try {
    const project = calleeNode.getSourceFile().getProject();
    const typeChecker = project.getTypeChecker();
    const tsNode = calleeNode as Parameters<typeof typeChecker.getSymbolAtLocation>[0];
    let sym = typeChecker.getSymbolAtLocation(tsNode);
    if (!sym && Node.isPropertyAccessExpression(calleeNode)) {
      const nameNode = calleeNode.getNameNode();
      if (nameNode) sym = typeChecker.getSymbolAtLocation(nameNode as typeof tsNode);
    }
    if (!sym) {
      const type = typeChecker.getTypeAtLocation(tsNode);
      if (type) {
        const maybeSym = type.getSymbol?.() ?? (type as { symbol?: unknown }).symbol;
        if (maybeSym) sym = maybeSym as ReturnType<typeof typeChecker.getSymbolAtLocation>;
      }
    }
    if (!sym) return undefined;
    const decls = sym.getDeclarations();
    if (!decls?.length) return undefined;
    const decl = decls[0];
    const tsDecl = (decl as unknown as { compilerNode?: ts.Node }).compilerNode ?? (decl as unknown as ts.Node);
    const sf = tsDecl.getSourceFile();
    const start = tsDecl.getStart();
    const end = tsDecl.getEnd();
    const startPos = sf.getLineAndCharacterOfPosition(start);
    const endPos = sf.getLineAndCharacterOfPosition(end);
    return {
      filePath: sf.fileName,
      line: startPos.line + 1,
      column: startPos.character,
      endLine: endPos.line + 1,
      endColumn: endPos.character,
    };
  } catch {
    return undefined;
  }
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

/** Structured JSDoc tags for steps/workflows */
interface JSDocTagsResult {
  params?: Array<{ name: string; description?: string }>;
  returns?: string;
  throws?: string[];
  example?: string;
}

/**
 * Extract JSDoc @param, @returns, @throws, @example from a node that has getJsDocs().
 */
function getJSDocTagsFromNode(node: Node): JSDocTagsResult | undefined {
  const n = node as {
    getJsDocs?: () => Array<{
      getTags?: () => Array<{ getTagName?: () => string; getText: () => string }>;
    }>;
  };
  if (typeof n.getJsDocs !== "function") return undefined;
  try {
    const docs = n.getJsDocs();
    if (!docs || docs.length === 0) return undefined;
    const first = docs[0];
    const tags = first.getTags?.();
    if (!tags || tags.length === 0) return undefined;

    const result: JSDocTagsResult = {};
    for (const tag of tags) {
      const raw = tag.getTagName?.() ?? (tag as { getName?: () => string }).getName?.();
      const tagName = typeof raw === "string" ? raw.toLowerCase() : undefined;
      const text = tag.getText().trim();
      if (!tagName) continue;
      if (tagName === "param" || tagName === "argument" || tagName === "arg") {
        // JSDoc: @param [type] name - desc or @param [type] [name] - desc (optional param). Capture name without brackets.
        const match = text.match(/^(?:@?\w+\s+)?(?:\{[^}]*\}\s*)?\[?(\w+)\]?\s*[-–—]\s*(.*)$/s);
        const words = text.split(/\s+/);
        const tagWords = ["@param", "param", "@argument", "argument", "@arg", "arg"];
        const isTypeToken = (w: string) => /^\{.*\}$/.test(w);
        const nameFromFallback = words.find((w) => !tagWords.includes(w) && !isTypeToken(w)) ?? words[0] ?? "?";
        const rawName = match ? match[1]!.trim() : nameFromFallback;
        // Strip optional brackets and default value: [id="guest"] -> id
        const name = rawName.replace(/^@/, "").replace(/^\[|\]$/g, "").split("=")[0]!.trim();
        let desc: string | undefined;
        if (match) {
          desc = match[2]!.trim().replace(/\s*\*+\s*$/, "");
        } else {
          // No dash separator: @param {string} id User identifier — description is everything after the param name
          const wordsForDesc = words.filter((w) => !isTypeToken(w));
          const nameToken = rawName.replace(/^@/, "");
          const nameIdx = wordsForDesc.indexOf(nameToken);
          const descStr = nameIdx >= 0 ? wordsForDesc.slice(nameIdx + 1).join(" ") : wordsForDesc.slice(1).join(" ");
          desc = descStr.replace(/^\s*[-–—]\s*/, "").trim().replace(/\s*\*+\s*$/, "") || undefined;
        }
        result.params = result.params ?? [];
        result.params.push({ name, description: desc || undefined });
      } else if (tagName === "returns" || tagName === "return") {
        // Strip tag then optional @returns {Type}; keep only the description
        const afterTag = text.replace(/^@?(?:returns?|return)\s+/i, "").trim();
        const afterType = afterTag.replace(/^\s*\{[^}]*\}\s*/, "").trim().replace(/\s*\*+\s*$/, "");
        result.returns = afterType || undefined;
      } else if (tagName === "throws" || tagName === "exception") {
        // Strip tag and optional {Type}; keep only the description (consistent with @returns)
        const raw = text.trim();
        const afterTag = raw.replace(/^@?(?:throws|exception)\s+/i, "").trim();
        const afterType = afterTag.replace(/^\s*\{[^}]*\}\s*/, "").trim().replace(/\s*\*+\s*$/, "");
        result.throws = result.throws ?? [];
        result.throws.push(afterType || "");
      } else if (tagName === "example") {
        // Store only the example content, not the @example tag prefix
        const clean = text.replace(/^@?example\s*/i, "").trim();
        result.example = clean || undefined;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
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
