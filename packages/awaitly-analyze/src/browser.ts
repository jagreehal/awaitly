/**
 * Browser Entry Point for Static Workflow Analysis
 *
 * This module provides static workflow analysis for browser environments.
 * It uses fetch() to load WASM files instead of Node.js fs APIs.
 *
 * Usage:
 * ```typescript
 * import {
 *   setWasmBasePath,
 *   analyzeWorkflowSource,
 *   renderStaticMermaid
 * } from 'awaitly-analyze/browser';
 *
 * // Configure WASM path before first use
 * setWasmBasePath('/wasm/');
 *
 * // Analyze workflow source code
 * const results = await analyzeWorkflowSource(code, { assumeImported: true });
 * if (results.length > 0) {
 *   const diagram = renderStaticMermaid(results[0]);
 *   console.log(diagram);
 * }
 * ```
 */

import {
  setWasmBasePath,
  getWasmBasePath,
  loadTreeSitterBrowser,
  clearTreeSitterBrowserCache,
} from "./tree-sitter-loader-browser";
import type { SyntaxNode } from "./tree-sitter-loader";
import type {
  StaticWorkflowIR,
  StaticWorkflowNode,
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticConditionalNode,
  StaticSwitchNode,
  StaticSwitchCase,
  StaticLoopNode,
  StaticWorkflowRefNode,
  StaticRetryConfig,
  StaticTimeoutConfig,
  StaticAnalysisMetadata,
  SourceLocation,
  AnalysisWarning,
  AnalysisStats,
  AnalyzerOptions,
  StaticSagaStepNode,
  StaticStreamNode,
} from "./types";

// Re-export WASM configuration
export { setWasmBasePath, getWasmBasePath, clearTreeSitterBrowserCache };

// Re-export renderers
export {
  renderStaticMermaid,
  renderPathsMermaid,
  renderStaticJSON,
  renderMultipleStaticJSON,
  type MermaidOptions,
  type MermaidStyles,
  type JSONRenderOptions,
} from "./renderers";

// Re-export types
export type {
  StaticWorkflowIR,
  StaticWorkflowNode,
  StaticFlowNode,
  StaticStepNode,
  StaticSequenceNode,
  StaticParallelNode,
  StaticRaceNode,
  StaticConditionalNode,
  StaticLoopNode,
  AnalysisWarning,
  AnalysisStats,
  AnalyzerOptions,
};

// =============================================================================
// Types (duplicated to avoid importing from static-analyzer.ts which uses Node APIs)
// =============================================================================

interface AnalyzerContext {
  sourceCode: string;
  filePath: string;
  opts: Required<AnalyzerOptions>;
  warnings: AnalysisWarning[];
  stats: AnalysisStats;
  workflowNames: Set<string>;
  currentWorkflow?: string;
  stepParameterName?: string;
  /** Whether the saga context is destructured (e.g., `({ step })` instead of `saga`) */
  isSagaDestructured?: boolean;
  /** The alias for `step` when saga is destructured */
  sagaStepAlias?: string;
  /** The alias for `tryStep` when saga is destructured */
  sagaTryStepAlias?: string;
}

const DEFAULT_OPTIONS: Required<AnalyzerOptions> = {
  tsConfigPath: "./tsconfig.json",
  resolveReferences: false,
  maxReferenceDepth: 5,
  includeLocations: true,
  detect: "all",
  assumeImported: false,
};

// =============================================================================
// Public API
// =============================================================================

let idCounter = 0;

/**
 * Reset the ID counter (for testing).
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Generate a unique ID.
 */
function generateId(): string {
  return `ts-${++idCounter}`;
}

/**
 * Parse source code directly (browser-compatible).
 *
 * Note: This does NOT support file-based analysis - use analyzeWorkflowSource
 * with source code strings only.
 */
export async function analyzeWorkflowSource(
  sourceCode: string,
  options: AnalyzerOptions = {}
): Promise<StaticWorkflowIR[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { parser } = await loadTreeSitterBrowser();
  const tree = parser.parse(sourceCode);

  if (!tree) {
    throw new Error("Failed to parse source code");
  }

  const ctx: AnalyzerContext = {
    sourceCode,
    filePath: "<source>",
    opts,
    warnings: [],
    stats: createEmptyStats(),
    workflowNames: new Set(),
  };

  // Find all workflow definitions first to track names
  const definitions = findWorkflowDefinitions(
    tree.rootNode as unknown as SyntaxNode,
    ctx
  );
  definitions.forEach((d) => ctx.workflowNames.add(d.name));

  const results: StaticWorkflowIR[] = [];

  // Find and analyze createWorkflow calls (unless filtered to run only)
  if (opts.detect === "all" || opts.detect === "createWorkflow") {
    const workflowCalls = findWorkflowCalls(
      tree.rootNode as unknown as SyntaxNode,
      ctx
    );
    for (const call of workflowCalls) {
      const ir = analyzeWorkflowCall(call, ctx);
      if (ir) {
        results.push(ir);
      }
    }
  }

  // Find and analyze run() calls (unless filtered to createWorkflow only)
  if (opts.detect === "all" || opts.detect === "run") {
    const runCalls = findRunCalls(tree.rootNode as unknown as SyntaxNode, ctx);
    for (const call of runCalls) {
      const ir = analyzeRunCall(call, ctx);
      if (ir) {
        results.push(ir);
      }
    }
  }

  // Find and analyze createSagaWorkflow calls
  if (opts.detect === "all" || opts.detect === "createSagaWorkflow") {
    const sagaDefinitions = findSagaWorkflowDefinitions(
      tree.rootNode as unknown as SyntaxNode,
      ctx
    );
    sagaDefinitions.forEach((d) => ctx.workflowNames.add(d.name));
    const sagaCalls = findSagaWorkflowCalls(
      tree.rootNode as unknown as SyntaxNode,
      ctx
    );
    for (const call of sagaCalls) {
      const ir = analyzeSagaWorkflowCall(call, ctx);
      if (ir) {
        results.push(ir);
      }
    }
  }

  // Find and analyze runSaga() calls
  if (opts.detect === "all" || opts.detect === "runSaga") {
    const runSagaCalls = findRunSagaCalls(
      tree.rootNode as unknown as SyntaxNode,
      ctx
    );
    for (const call of runSagaCalls) {
      const ir = analyzeRunSagaCall(call, ctx);
      if (ir) {
        results.push(ir);
      }
    }
  }

  return results;
}

// =============================================================================
// The following is a copy of the analysis logic from static-analyzer.ts
// This duplication is necessary because static-analyzer.ts imports from
// tree-sitter-loader.ts which uses Node.js APIs (fs, path, etc.)
// =============================================================================

interface WorkflowDefinition {
  name: string;
  createWorkflowCall: SyntaxNode;
  /** Short description for labels/tooltips */
  description?: string;
  /** Full markdown documentation */
  markdown?: string;
}

/**
 * Extracted workflow options from createWorkflow call.
 */
interface WorkflowOptionsExtracted {
  description?: string;
  markdown?: string;
}

/**
 * Saga workflow definition found in the source.
 */
interface SagaWorkflowDefinition {
  name: string;
  createSagaWorkflowCall: SyntaxNode;
  description?: string;
  markdown?: string;
}

/**
 * Extract workflow options (description, markdown) from an options object literal.
 */
function extractWorkflowOptions(
  optionsNode: SyntaxNode,
  ctx: AnalyzerContext
): WorkflowOptionsExtracted {
  const result: WorkflowOptionsExtracted = {};

  if (optionsNode.type !== "object") {
    return result;
  }

  for (const prop of optionsNode.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);
        if (key === "description") {
          const value = extractStringValue(valueNode, ctx);
          if (value) result.description = value;
        } else if (key === "markdown") {
          const value = extractStringValue(valueNode, ctx);
          if (value) result.markdown = value;
        }
      }
    }
  }

  return result;
}

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
            // Extract documentation options from second argument
            const args = node.childForFieldName("arguments");
            const optionsNode = args?.namedChildren[1]; // Second arg is options
            const options = optionsNode
              ? extractWorkflowOptions(optionsNode, ctx)
              : {};

            results.push({
              name: workflowName,
              createWorkflowCall: node,
              description: options.description,
              markdown: options.markdown,
            });
          }
        }
      }
    }
  });

  return results;
}

function findWorkflowCalls(root: SyntaxNode, ctx: AnalyzerContext): SyntaxNode[] {
  const definitions = findWorkflowDefinitions(root, ctx);
  const workflowNames = new Set(definitions.map((d) => d.name));

  const results: SyntaxNode[] = [];

  traverseNode(root, (node) => {
    if (node.type === "call_expression") {
      const funcNode = node.childForFieldName("function");
      if (funcNode) {
        const funcText = getText(funcNode, ctx);
        if (workflowNames.has(funcText)) {
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

function findAwaitlyImports(
  root: SyntaxNode,
  exportName: string,
  ctx: AnalyzerContext
): Set<string> {
  const importedNames = new Set<string>();

  traverseNode(root, (node) => {
    if (node.type === "import_statement") {
      let isTypeOnly = false;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.children[i];
        if (child && child.type === "type") {
          isTypeOnly = true;
          break;
        }
      }
      if (isTypeOnly) {
        return;
      }

      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        const sourceText = getText(sourceNode, ctx);
        const modulePath = sourceText.slice(1, -1);
        if (modulePath === "awaitly" || modulePath.startsWith("@awaitly/")) {
          for (const child of node.namedChildren) {
            if (child.type === "import_clause") {
              for (const clauseChild of child.namedChildren) {
                if (clauseChild.type === "named_imports") {
                  for (const specifier of clauseChild.namedChildren) {
                    if (specifier.type === "import_specifier") {
                      let isTypeOnlySpecifier = false;
                      for (const specChild of specifier.children) {
                        if (specChild.type === "type") {
                          isTypeOnlySpecifier = true;
                          break;
                        }
                      }
                      if (isTypeOnlySpecifier) {
                        continue;
                      }

                      const nameNode = specifier.childForFieldName("name");
                      const aliasNode = specifier.childForFieldName("alias");

                      if (nameNode) {
                        const importedName = getText(nameNode, ctx);
                        if (importedName === exportName) {
                          const localName = aliasNode
                            ? getText(aliasNode, ctx)
                            : importedName;
                          importedNames.add(localName);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  return importedNames;
}

/**
 * Recursively search for var declarations within a node.
 * Used to find function-scoped var declarations in nested blocks.
 */
function hasVarDeclaration(
  node: SyntaxNode,
  identifierName: string,
  ctx: AnalyzerContext
): boolean {
  // Check if this node is a var declaration
  if (node.type === "variable_declaration") {
    for (const declarator of node.namedChildren) {
      if (declarator.type === "variable_declarator") {
        const nameNode = declarator.childForFieldName("name");
        if (nameNode && getText(nameNode, ctx) === identifierName) {
          return true;
        }
      }
    }
  }

  // Don't recurse into nested functions (they have their own scope)
  if (
    node.type === "arrow_function" ||
    node.type === "function_expression" ||
    node.type === "function_declaration"
  ) {
    return false;
  }

  // Recursively check children
  for (const child of node.namedChildren) {
    if (hasVarDeclaration(child, identifierName, ctx)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an identifier at a given node is shadowed by a local declaration.
 * Walks up the AST looking for variable/function declarations or parameters
 * that would shadow the identifier before reaching module scope.
 */
function isIdentifierShadowed(
  node: SyntaxNode,
  identifierName: string,
  ctx: AnalyzerContext
): boolean {
  let current: SyntaxNode | null = node.parent;

  while (current) {
    // Check for variable declarations in statement blocks
    if (
      current.type === "statement_block" ||
      current.type === "program"
    ) {
      // Check ALL declarations in the scope (not just before the call site)
      // because const/let create TDZ and function declarations are hoisted
      for (const child of current.namedChildren) {
        // Check let/const (block-scoped) at this level only
        if (child.type === "lexical_declaration") {
          for (const declarator of child.namedChildren) {
            if (declarator.type === "variable_declarator") {
              const nameNode = declarator.childForFieldName("name");
              if (nameNode && getText(nameNode, ctx) === identifierName) {
                return true;
              }
            }
          }
        }
        // Check var (function-scoped) at this level only - nested vars handled below
        else if (child.type === "variable_declaration") {
          for (const declarator of child.namedChildren) {
            if (declarator.type === "variable_declarator") {
              const nameNode = declarator.childForFieldName("name");
              if (nameNode && getText(nameNode, ctx) === identifierName) {
                return true;
              }
            }
          }
        } else if (child.type === "function_declaration") {
          const nameNode = child.childForFieldName("name");
          if (nameNode && getText(nameNode, ctx) === identifierName) {
            return true;
          }
        }
      }

      // At program scope, search nested blocks for var declarations (they're program-scoped)
      if (current.type === "program") {
        if (hasVarDeclaration(current, identifierName, ctx)) {
          return true;
        }
      }
    }

    // Check function parameters and search entire function body for var declarations
    if (
      current.type === "arrow_function" ||
      current.type === "function_expression" ||
      current.type === "function_declaration" ||
      current.type === "method_definition"
    ) {
      const params = current.childForFieldName("parameters");
      if (params) {
        for (const param of params.namedChildren) {
          // Handle simple identifier parameters
          if (param.type === "identifier" && getText(param, ctx) === identifierName) {
            return true;
          }
          // Handle destructuring patterns
          if (param.type === "object_pattern" || param.type === "array_pattern") {
            // For simplicity, check if the identifier appears anywhere in the pattern
            let found = false;
            traverseNode(param, (n) => {
              if (n.type === "identifier" && getText(n, ctx) === identifierName) {
                found = true;
              }
            });
            if (found) return true;
          }
          // Handle assignment patterns (default values)
          if (param.type === "assignment_pattern") {
            const left = param.childForFieldName("left");
            if (left?.type === "identifier" && getText(left, ctx) === identifierName) {
              return true;
            }
          }
        }
      }

      // Search entire function body for var declarations (they're function-scoped)
      const body = current.childForFieldName("body");
      if (body && hasVarDeclaration(body, identifierName, ctx)) {
        return true;
      }
    }

    // Stop at program level (module scope)
    if (current.type === "program") break;

    current = current.parent;
  }

  return false;
}

function findRunCalls(root: SyntaxNode, ctx: AnalyzerContext): SyntaxNode[] {
  const runImportNames = findAwaitlyImports(root, "run", ctx);

  if (ctx.opts.assumeImported) {
    runImportNames.add("run");
  }

  if (runImportNames.size === 0) {
    return [];
  }

  const results: SyntaxNode[] = [];

  traverseNode(root, (node) => {
    if (node.type === "call_expression") {
      const funcNode = node.childForFieldName("function");
      if (funcNode && funcNode.type === "identifier") {
        const funcText = getText(funcNode, ctx);
        if (runImportNames.has(funcText)) {
          // Check if the identifier is shadowed by a local declaration
          if (isIdentifierShadowed(node, funcText, ctx)) {
            return; // Skip - this is a shadowed local variable
          }

          const args = node.childForFieldName("arguments");
          const firstArg = args?.namedChildren[0];
          if (
            firstArg?.type === "arrow_function" ||
            firstArg?.type === "function_expression"
          ) {
            results.push(node);
          }
        }
      }
    }
  });

  return results;
}

function findSagaWorkflowDefinitions(
  root: SyntaxNode,
  ctx: AnalyzerContext
): SagaWorkflowDefinition[] {
  const results: SagaWorkflowDefinition[] = [];

  traverseNode(root, (node) => {
    if (node.type === "call_expression") {
      const funcNode = node.childForFieldName("function");
      if (funcNode) {
        const funcText = getText(funcNode, ctx);
        if (funcText === "createSagaWorkflow") {
          const workflowName = extractWorkflowName(node, ctx);
          if (workflowName) {
            const args = node.childForFieldName("arguments");
            const optionsNode = args?.namedChildren[1];
            const options = optionsNode
              ? extractWorkflowOptions(optionsNode, ctx)
              : {};

            results.push({
              name: workflowName,
              createSagaWorkflowCall: node,
              description: options.description,
              markdown: options.markdown,
            });
          }
        }
      }
    }
  });

  return results;
}

function findSagaWorkflowCalls(root: SyntaxNode, ctx: AnalyzerContext): SyntaxNode[] {
  const definitions = findSagaWorkflowDefinitions(root, ctx);
  const sagaNames = new Set(definitions.map((d) => d.name));

  const results: SyntaxNode[] = [];

  traverseNode(root, (node) => {
    if (node.type === "call_expression") {
      const funcNode = node.childForFieldName("function");
      if (funcNode) {
        const funcText = getText(funcNode, ctx);
        if (sagaNames.has(funcText)) {
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

function findRunSagaCalls(root: SyntaxNode, ctx: AnalyzerContext): SyntaxNode[] {
  const runSagaImportNames = findAwaitlyImports(root, "runSaga", ctx);

  if (ctx.opts.assumeImported) {
    runSagaImportNames.add("runSaga");
  }

  if (runSagaImportNames.size === 0) {
    return [];
  }

  const results: SyntaxNode[] = [];

  traverseNode(root, (node) => {
    if (node.type === "call_expression") {
      const funcNode = node.childForFieldName("function");
      if (funcNode && funcNode.type === "identifier") {
        const funcText = getText(funcNode, ctx);
        if (runSagaImportNames.has(funcText)) {
          if (isIdentifierShadowed(node, funcText, ctx)) {
            return;
          }

          const args = node.childForFieldName("arguments");
          const firstArg = args?.namedChildren[0];
          if (
            firstArg?.type === "arrow_function" ||
            firstArg?.type === "function_expression"
          ) {
            results.push(node);
          }
        }
      }
    }
  });

  return results;
}

function analyzeSagaWorkflowCall(
  callNode: SyntaxNode,
  parentCtx: AnalyzerContext
): StaticWorkflowIR | null {
  const funcNode = callNode.childForFieldName("function");
  const workflowName = funcNode ? getText(funcNode, parentCtx) : "<unknown>";

  const args = callNode.childForFieldName("arguments");
  const callbackNode = args?.namedChildren[0];

  const workflowWarnings: AnalysisWarning[] = [];
  const workflowStats = createEmptyStats();
  workflowStats.sagaWorkflowCount = 1;

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
      message: `Could not find callback for saga workflow ${workflowName}`,
      location: getLocation(callNode, ctx),
    });
    return null;
  }

  const prevWorkflow = ctx.currentWorkflow;
  ctx.currentWorkflow = workflowName;

  const sagaParamInfo = extractSagaParameterInfo(callbackNode, ctx);
  const prevStepParamName = ctx.stepParameterName;
  const prevIsSagaDestructured = ctx.isSagaDestructured;
  const prevSagaStepAlias = ctx.sagaStepAlias;
  const prevSagaTryStepAlias = ctx.sagaTryStepAlias;
  ctx.stepParameterName = sagaParamInfo?.name;
  ctx.isSagaDestructured = sagaParamInfo?.isDestructured;
  ctx.sagaStepAlias = sagaParamInfo?.stepAlias;
  ctx.sagaTryStepAlias = sagaParamInfo?.tryStepAlias;

  const children = analyzeSagaCallback(callbackNode, ctx);

  ctx.currentWorkflow = prevWorkflow;
  ctx.stepParameterName = prevStepParamName;
  ctx.isSagaDestructured = prevIsSagaDestructured;
  ctx.sagaStepAlias = prevSagaStepAlias;
  ctx.sagaTryStepAlias = prevSagaTryStepAlias;

  const treeRoot = (callNode as unknown as { tree?: { rootNode: SyntaxNode } })
    .tree?.rootNode;
  const definitions = treeRoot
    ? findSagaWorkflowDefinitions(treeRoot, parentCtx)
    : [];
  const definition = definitions.find((d) => d.name === workflowName);

  const rootNode: StaticWorkflowNode = {
    id: generateId(),
    type: "workflow",
    workflowName,
    source: "createSagaWorkflow",
    dependencies: [],
    errorTypes: [],
    children: wrapInSequence(children),
    description: definition?.description,
    markdown: definition?.markdown,
  };

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

function analyzeRunSagaCall(
  callNode: SyntaxNode,
  parentCtx: AnalyzerContext
): StaticWorkflowIR | null {
  const args = callNode.childForFieldName("arguments");
  const callbackNode = args?.namedChildren[0];

  const workflowWarnings: AnalysisWarning[] = [];
  const workflowStats = createEmptyStats();
  workflowStats.sagaWorkflowCount = 1;

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
      message: "Could not find callback for runSaga()",
      location: getLocation(callNode, ctx),
    });
    return null;
  }

  const workflowName = generateRunSagaName(callNode, ctx);

  const sagaParamInfo = extractSagaParameterInfo(callbackNode, ctx);
  const prevStepParamName = ctx.stepParameterName;
  const prevIsSagaDestructured = ctx.isSagaDestructured;
  const prevSagaStepAlias = ctx.sagaStepAlias;
  const prevSagaTryStepAlias = ctx.sagaTryStepAlias;
  ctx.stepParameterName = sagaParamInfo?.name;
  ctx.isSagaDestructured = sagaParamInfo?.isDestructured;
  ctx.sagaStepAlias = sagaParamInfo?.stepAlias;
  ctx.sagaTryStepAlias = sagaParamInfo?.tryStepAlias;

  const children = analyzeSagaCallback(callbackNode, ctx);

  ctx.stepParameterName = prevStepParamName;
  ctx.isSagaDestructured = prevIsSagaDestructured;
  ctx.sagaStepAlias = prevSagaStepAlias;
  ctx.sagaTryStepAlias = prevSagaTryStepAlias;

  const rootNode: StaticWorkflowNode = {
    id: generateId(),
    type: "workflow",
    workflowName,
    source: "runSaga",
    dependencies: [],
    errorTypes: [],
    children: wrapInSequence(children),
    location: ctx.opts.includeLocations ? getLocation(callNode, ctx) : undefined,
  };

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

function generateRunSagaName(callNode: SyntaxNode, ctx: AnalyzerContext): string {
  const line = callNode.startPosition.row + 1;
  const filePath = ctx.filePath;
  const fileName = filePath.includes("/")
    ? filePath.split("/").pop() || filePath
    : filePath.includes("\\")
      ? filePath.split("\\").pop() || filePath
      : filePath;
  return `runSaga@${fileName}:${line}`;
}

/**
 * Result of extracting saga parameter info.
 */
interface SagaParameterInfo {
  /** The saga parameter name (when not destructured) */
  name?: string;
  /** Whether the saga context is destructured (e.g., `({ step })` instead of `saga`) */
  isDestructured: boolean;
  /** The alias for `step` when destructured (e.g., "step" or "s" from `{ step: s }`) */
  stepAlias?: string;
  /** The alias for `tryStep` when destructured */
  tryStepAlias?: string;
}

/**
 * Extract the saga parameter info from a saga workflow callback.
 * e.g., `async (saga, deps) => {...}` -> { name: "saga", isDestructured: false }
 * e.g., `async ({ step }, deps) => {...}` -> { isDestructured: true, stepAlias: "step" }
 * e.g., `async ({ step: s, tryStep }, deps) => {...}` -> { isDestructured: true, stepAlias: "s", tryStepAlias: "tryStep" }
 */
function extractSagaParameterInfo(
  callbackNode: SyntaxNode,
  ctx: AnalyzerContext
): SagaParameterInfo | undefined {
  const params = callbackNode.childForFieldName("parameters");
  if (!params) return undefined;

  const firstParam = params.namedChildren[0];
  if (!firstParam) return undefined;

  if (firstParam.type === "identifier") {
    return { name: getText(firstParam, ctx), isDestructured: false };
  }

  if (firstParam.type === "required_parameter") {
    const patternNode = firstParam.childForFieldName("pattern");
    if (patternNode) {
      if (patternNode.type === "object_pattern") {
        const aliases = extractSagaAliasesFromObjectPattern(patternNode, ctx);
        if (aliases.stepAlias || aliases.tryStepAlias) {
          return { isDestructured: true, ...aliases };
        }
      }
      return { name: getText(patternNode, ctx), isDestructured: false };
    }
  }

  // Handle direct object_pattern (no type annotation)
  if (firstParam.type === "object_pattern") {
    const aliases = extractSagaAliasesFromObjectPattern(firstParam, ctx);
    if (aliases.stepAlias || aliases.tryStepAlias) {
      return { isDestructured: true, ...aliases };
    }
  }

  return undefined;
}

/**
 * Extract step and tryStep aliases from a saga destructuring pattern.
 * e.g., `{ step }` -> { stepAlias: "step" }
 * e.g., `{ step: s, tryStep: ts }` -> { stepAlias: "s", tryStepAlias: "ts" }
 */
function extractSagaAliasesFromObjectPattern(
  objectPattern: SyntaxNode,
  ctx: AnalyzerContext
): { stepAlias?: string; tryStepAlias?: string } {
  const result: { stepAlias?: string; tryStepAlias?: string } = {};

  for (const child of objectPattern.namedChildren) {
    // Handle pair_pattern: `step: s` or `step: s = fallback`
    if (child.type === "pair_pattern") {
      const keyNode = child.childForFieldName("key");
      const valueNode = child.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);
        if (key === "step" || key === "tryStep") {
          let alias: string;
          // Handle assignment_pattern: `step: s = fallback`
          if (valueNode.type === "assignment_pattern") {
            const left = valueNode.childForFieldName("left");
            alias = left ? getText(left, ctx) : getText(valueNode, ctx);
          } else {
            alias = getText(valueNode, ctx);
          }
          if (key === "step") {
            result.stepAlias = alias;
          } else {
            result.tryStepAlias = alias;
          }
        }
      }
    }

    // Handle shorthand_property_identifier_pattern: `{ step }` or `{ tryStep }`
    if (child.type === "shorthand_property_identifier_pattern") {
      const name = getText(child, ctx);
      if (name === "step") {
        result.stepAlias = "step";
      } else if (name === "tryStep") {
        result.tryStepAlias = "tryStep";
      }
    }

    // Handle assignment_pattern: `{ step = fallback }` or `{ tryStep = fallback }`
    if (child.type === "assignment_pattern") {
      const left = child.childForFieldName("left");
      if (left) {
        const name = getText(left, ctx);
        if (name === "step") {
          result.stepAlias = "step";
        } else if (name === "tryStep") {
          result.tryStepAlias = "tryStep";
        }
      }
    }
  }

  return result;
}

function analyzeSagaCallback(
  callbackNode: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const body = callbackNode.childForFieldName("body");
  if (!body) return [];

  if (body.type === "statement_block") {
    return analyzeSagaStatements(body.namedChildren, ctx);
  }

  return analyzeSagaExpression(body, ctx);
}

function analyzeSagaStatements(
  statements: SyntaxNode[],
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const results: StaticFlowNode[] = [];

  for (const stmt of statements) {
    const nodes = analyzeSagaStatement(stmt, ctx);
    results.push(...nodes);
  }

  return results;
}

function analyzeSagaStatement(
  stmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  switch (stmt.type) {
    case "expression_statement": {
      const expr = stmt.namedChildren[0];
      if (expr) {
        return analyzeSagaExpression(expr, ctx);
      }
      return [];
    }

    case "variable_declaration":
    case "lexical_declaration":
      return analyzeSagaVariableDeclaration(stmt, ctx);

    case "return_statement": {
      const returnExpr = stmt.childForFieldName("value");
      if (returnExpr) {
        return analyzeSagaExpression(returnExpr, ctx);
      }
      return [];
    }

    case "if_statement":
      return analyzeSagaIfStatement(stmt, ctx);

    case "for_statement":
    case "for_in_statement":
    case "while_statement":
      return analyzeSagaLoopStatement(stmt, ctx);

    case "switch_statement":
      return analyzeSagaSwitchStatement(stmt, ctx);

    default:
      return [];
  }
}

function analyzeSagaExpression(
  expr: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  if (expr.type === "await_expression") {
    const inner = expr.namedChildren[0];
    if (inner) {
      return analyzeSagaExpression(inner, ctx);
    }
    return [];
  }

  if (expr.type === "parenthesized_expression") {
    const inner = expr.namedChildren[0];
    if (inner) {
      return analyzeSagaExpression(inner, ctx);
    }
    return [];
  }

  if (expr.type === "call_expression") {
    return analyzeSagaCallExpression(expr, ctx);
  }

  return [];
}

function analyzeSagaVariableDeclaration(
  decl: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const results: StaticFlowNode[] = [];

  for (const child of decl.namedChildren) {
    if (child.type === "variable_declarator") {
      const value = child.childForFieldName("value");
      if (value) {
        results.push(...analyzeSagaExpression(value, ctx));
      }
    }
  }

  return results;
}

function analyzeSagaIfStatement(
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
    ? analyzeSagaBlock(consequentNode, ctx)
    : [];

  let alternate: StaticFlowNode[] | undefined;
  if (alternateNode) {
    if (alternateNode.type === "else_clause") {
      const elseContent = alternateNode.namedChildren[0];
      if (elseContent) {
        alternate = analyzeSagaBlock(elseContent, ctx);
      }
    } else {
      alternate = analyzeSagaBlock(alternateNode, ctx);
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

function analyzeSagaBlock(
  node: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  if (node.type === "statement_block") {
    return analyzeSagaStatements(node.namedChildren, ctx);
  }
  return analyzeSagaStatement(node, ctx);
}

function analyzeSagaLoopStatement(
  loopStmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const bodyNode = loopStmt.childForFieldName("body");
  if (!bodyNode) return [];

  const bodyChildren = analyzeSagaBlock(bodyNode, ctx);
  if (bodyChildren.length === 0) return [];

  ctx.stats.loopCount++;

  let loopType: "for" | "while" | "for-of" | "for-in" = "for";
  if (loopStmt.type === "while_statement") {
    loopType = "while";
  } else if (loopStmt.type === "for_in_statement") {
    const stmtText = getText(loopStmt, ctx);
    loopType = stmtText.includes(" of ") ? "for-of" : "for-in";
  }

  const rightNode = loopStmt.childForFieldName("right");
  const iterSource = rightNode ? getText(rightNode, ctx) : undefined;

  return [
    {
      id: generateId(),
      type: "loop",
      loopType,
      iterSource,
      body: bodyChildren,
      boundKnown: false,
      location: ctx.opts.includeLocations ? getLocation(loopStmt, ctx) : undefined,
    } as StaticLoopNode,
  ];
}

function analyzeSagaSwitchStatement(
  switchStmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const valueNode = switchStmt.childForFieldName("value");
  const bodyNode = switchStmt.childForFieldName("body");

  const expression = valueNode
    ? getText(valueNode, ctx).replace(/^\(|\)$/g, "")
    : "<unknown>";

  const cases: StaticSwitchCase[] = [];
  let hasStepCalls = false;

  if (bodyNode) {
    for (const caseNode of bodyNode.namedChildren) {
      if (caseNode.type === "switch_case" || caseNode.type === "switch_default") {
        const caseValueNode = caseNode.childForFieldName("value");
        const isDefault = caseNode.type === "switch_default" || !caseValueNode;
        const caseValue = caseValueNode ? getText(caseValueNode, ctx) : undefined;

        // Analyze statements in the case body (all named children except the value)
        const bodyStatements = caseNode.namedChildren.filter(
          (n) => n !== caseValueNode
        );
        const body = analyzeSagaStatements(bodyStatements, ctx);

        if (body.length > 0) {
          hasStepCalls = true;
        }

        cases.push({
          value: caseValue,
          isDefault,
          body,
        });
      }
    }
  }

  // Only count if there are step calls inside
  if (hasStepCalls) {
    ctx.stats.conditionalCount++;
  }

  // If no step calls, return empty
  if (!hasStepCalls) {
    return [];
  }

  const switchNode: StaticSwitchNode = {
    id: generateId(),
    type: "switch",
    expression,
    cases,
    location: ctx.opts.includeLocations ? getLocation(switchStmt, ctx) : undefined,
  };

  return [switchNode];
}

/**
 * Analyze a saga call expression for saga.step() and saga.tryStep() calls.
 * Handles both forms:
 * - `saga.step()` when saga context is passed as identifier (e.g., `async (saga) => ...`)
 * - `step()` when saga context is destructured (e.g., `async ({ step }) => ...`)
 */
function analyzeSagaCallExpression(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const funcNode = call.childForFieldName("function");
  if (!funcNode) return [];

  const funcText = getText(funcNode, ctx);
  const sagaParam = ctx.stepParameterName || "saga";

  // When saga context is destructured, match against the destructured aliases
  if (ctx.isSagaDestructured) {
    // Check for step() calls (destructured from saga context)
    if (ctx.sagaStepAlias && funcText === ctx.sagaStepAlias) {
      return [analyzeSagaStepCall(call, ctx)];
    }

    // Check for tryStep() calls (destructured from saga context)
    if (ctx.sagaTryStepAlias && funcText === ctx.sagaTryStepAlias) {
      return [analyzeSagaTryStepCall(call, ctx)];
    }

    return [];
  }

  if (funcText === `${sagaParam}.step`) {
    return [analyzeSagaStepCall(call, ctx)];
  }

  if (funcText === `${sagaParam}.tryStep`) {
    return [analyzeSagaTryStepCall(call, ctx)];
  }

  return [];
}

function analyzeSagaStepCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticSagaStepNode {
  ctx.stats.totalSteps++;

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];
  const secondArg = args?.namedChildren[1];

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

  const { hasCompensation, compensationCallee, name, description, markdown } =
    extractSagaStepOptions(secondArg, ctx);

  if (hasCompensation) {
    ctx.stats.compensatedStepCount = (ctx.stats.compensatedStepCount || 0) + 1;
  }

  return {
    id: generateId(),
    type: "saga-step",
    callee,
    name,
    description,
    markdown,
    hasCompensation,
    compensationCallee,
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };
}

function analyzeSagaTryStepCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticSagaStepNode {
  ctx.stats.totalSteps++;

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];
  const secondArg = args?.namedChildren[1];

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

  const { hasCompensation, compensationCallee, name, description, markdown } =
    extractSagaStepOptions(secondArg, ctx);

  if (hasCompensation) {
    ctx.stats.compensatedStepCount = (ctx.stats.compensatedStepCount || 0) + 1;
  }

  return {
    id: generateId(),
    type: "saga-step",
    callee,
    name,
    description,
    markdown,
    hasCompensation,
    compensationCallee,
    isTryStep: true,
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };
}

function extractSagaStepOptions(
  optionsNode: SyntaxNode | undefined,
  ctx: AnalyzerContext
): {
  hasCompensation: boolean;
  compensationCallee?: string;
  name?: string;
  description?: string;
  markdown?: string;
} {
  const result = {
    hasCompensation: false,
    compensationCallee: undefined as string | undefined,
    name: undefined as string | undefined,
    description: undefined as string | undefined,
    markdown: undefined as string | undefined,
  };

  if (!optionsNode || optionsNode.type !== "object") {
    return result;
  }

  for (const prop of optionsNode.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);

        if (key === "compensate") {
          result.hasCompensation = true;
          if (
            valueNode.type === "arrow_function" ||
            valueNode.type === "function_expression"
          ) {
            const body = valueNode.childForFieldName("body");
            if (body) {
              result.compensationCallee = extractCalleeFromFunctionBody(body, ctx);
            }
          }
        } else if (key === "name") {
          const value = extractStringValue(valueNode, ctx);
          if (value) result.name = value;
        } else if (key === "description") {
          const value = extractStringValue(valueNode, ctx);
          if (value) result.description = value;
        } else if (key === "markdown") {
          const value = extractStringValue(valueNode, ctx);
          if (value) result.markdown = value;
        }
      }
    }
  }

  return result;
}

function generateRunName(callNode: SyntaxNode, ctx: AnalyzerContext): string {
  const line = callNode.startPosition.row + 1;
  const filePath = ctx.filePath;
  const fileName = filePath.includes("/")
    ? filePath.split("/").pop() || filePath
    : filePath.includes("\\")
      ? filePath.split("\\").pop() || filePath
      : filePath;
  return `run@${fileName}:${line}`;
}

function analyzeRunCall(
  callNode: SyntaxNode,
  parentCtx: AnalyzerContext
): StaticWorkflowIR | null {
  const args = callNode.childForFieldName("arguments");
  const callbackNode = args?.namedChildren[0];

  const workflowWarnings: AnalysisWarning[] = [];
  const workflowStats = createEmptyStats();

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
      message: "Could not find callback for run()",
      location: getLocation(callNode, ctx),
    });
    return null;
  }

  const workflowName = generateRunName(callNode, ctx);
  const stepParamName = extractStepParameterName(callbackNode, ctx);
  const prevStepParamName = ctx.stepParameterName;
  ctx.stepParameterName = stepParamName;

  const children = analyzeCallback(callbackNode, ctx);

  ctx.stepParameterName = prevStepParamName;

  const rootNode: StaticWorkflowNode = {
    id: generateId(),
    type: "workflow",
    workflowName,
    source: "run",
    dependencies: [],
    errorTypes: [],
    children: wrapInSequence(children),
    location: ctx.opts.includeLocations ? getLocation(callNode, ctx) : undefined,
  };

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

function analyzeWorkflowCall(
  callNode: SyntaxNode,
  parentCtx: AnalyzerContext
): StaticWorkflowIR | null {
  const funcNode = callNode.childForFieldName("function");
  const workflowName = funcNode ? getText(funcNode, parentCtx) : "<unknown>";

  const args = callNode.childForFieldName("arguments");
  const callbackNode = args?.namedChildren[0];

  const workflowWarnings: AnalysisWarning[] = [];
  const workflowStats = createEmptyStats();

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

  const prevWorkflow = ctx.currentWorkflow;
  ctx.currentWorkflow = workflowName;

  const stepParamName = extractStepParameterName(callbackNode, ctx);
  const prevStepParamName = ctx.stepParameterName;
  ctx.stepParameterName = stepParamName;

  const children = analyzeCallback(callbackNode, ctx);

  ctx.currentWorkflow = prevWorkflow;
  ctx.stepParameterName = prevStepParamName;

  // Find the definition to get documentation
  const definitions = findWorkflowDefinitions(
    (callNode as unknown as { tree?: { rootNode: SyntaxNode } }).tree?.rootNode || callNode,
    parentCtx
  );
  const definition = definitions.find((d) => d.name === workflowName);

  const rootNode: StaticWorkflowNode = {
    id: generateId(),
    type: "workflow",
    workflowName,
    source: "createWorkflow",
    dependencies: [],
    errorTypes: [],
    children: wrapInSequence(children),
    description: definition?.description,
    markdown: definition?.markdown,
  };

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

function extractWorkflowName(
  callNode: SyntaxNode,
  ctx: AnalyzerContext
): string | null {
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

function extractStepParameterName(
  callbackNode: SyntaxNode,
  ctx: AnalyzerContext
): string | undefined {
  const params = callbackNode.childForFieldName("parameters");
  if (!params) return undefined;

  const firstParam = params.namedChildren[0];
  if (!firstParam) return undefined;

  if (firstParam.type === "identifier") {
    return getText(firstParam, ctx);
  }

  if (firstParam.type === "required_parameter") {
    const patternNode = firstParam.childForFieldName("pattern");
    if (patternNode) {
      if (patternNode.type === "object_pattern") {
        return extractStepFromObjectPattern(patternNode, ctx);
      }
      return getText(patternNode, ctx);
    }
  }

  if (firstParam.type === "object_pattern") {
    return extractStepFromObjectPattern(firstParam, ctx);
  }

  return undefined;
}

function extractStepFromObjectPattern(
  objectPattern: SyntaxNode,
  ctx: AnalyzerContext
): string | undefined {
  for (const child of objectPattern.namedChildren) {
    if (child.type === "pair_pattern") {
      const keyNode = child.childForFieldName("key");
      const valueNode = child.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);
        if (key === "step") {
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

    if (child.type === "shorthand_property_identifier_pattern") {
      const name = getText(child, ctx);
      if (name === "step") {
        return "step";
      }
    }

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

function analyzeCallback(
  callbackNode: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const body = callbackNode.childForFieldName("body");
  if (!body) return [];

  if (body.type === "statement_block") {
    return analyzeStatements(body.namedChildren, ctx);
  }

  return analyzeExpression(body, ctx);
}

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

function analyzeStatement(
  stmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  switch (stmt.type) {
    case "expression_statement": {
      const expr = stmt.namedChildren[0];
      if (expr) {
        return analyzeExpression(expr, ctx);
      }
      return [];
    }

    case "variable_declaration":
    case "lexical_declaration":
      return analyzeVariableDeclaration(stmt, ctx);

    case "return_statement": {
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

    case "switch_statement":
      return analyzeSwitchStatement(stmt, ctx);

    default:
      return [];
  }
}

function analyzeExpression(
  expr: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  if (expr.type === "await_expression") {
    const inner = expr.namedChildren[0];
    if (inner) {
      return analyzeExpression(inner, ctx);
    }
    return [];
  }

  if (expr.type === "parenthesized_expression") {
    const inner = expr.namedChildren[0];
    if (inner) {
      return analyzeExpression(inner, ctx);
    }
    return [];
  }

  if (expr.type === "call_expression") {
    return analyzeCallExpression(expr, ctx);
  }

  return [];
}

function analyzeVariableDeclaration(
  decl: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const results: StaticFlowNode[] = [];

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

function analyzeStreamWritableCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticStreamNode {
  ctx.stats.streamCount++;

  const args = call.childForFieldName("arguments");
  const optionsArg = args?.namedChildren[0];

  const options = optionsArg ? extractStreamOptions(optionsArg, ctx) : {};

  return {
    id: generateId(),
    type: "stream",
    streamType: "write",
    namespace: options.namespace,
    options: options.highWaterMark !== undefined ? { highWaterMark: options.highWaterMark } : undefined,
    callee: "step.getWritable",
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };
}

function analyzeStreamReadableCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticStreamNode {
  ctx.stats.streamCount++;

  const args = call.childForFieldName("arguments");
  const optionsArg = args?.namedChildren[0];

  const options = optionsArg ? extractStreamOptions(optionsArg, ctx) : {};

  return {
    id: generateId(),
    type: "stream",
    streamType: "read",
    namespace: options.namespace,
    options: options.startIndex !== undefined ? { startIndex: options.startIndex } : undefined,
    callee: "step.getReadable",
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };
}

function analyzeStreamForEachCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticStreamNode {
  ctx.stats.streamCount++;

  const args = call.childForFieldName("arguments");
  // streamForEach(source, processor, options?)
  const optionsArg = args?.namedChildren[2];

  const options = optionsArg ? extractStreamForEachOptions(optionsArg, ctx) : {};

  return {
    id: generateId(),
    type: "stream",
    streamType: "forEach",
    options: {
      ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
      ...(options.checkpointInterval !== undefined ? { checkpointInterval: options.checkpointInterval } : {}),
    },
    callee: "step.streamForEach",
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };
}

function extractStreamOptions(
  optionsNode: SyntaxNode,
  ctx: AnalyzerContext
): { namespace?: string; highWaterMark?: number | "<dynamic>"; startIndex?: number | "<dynamic>" } {
  const result: { namespace?: string; highWaterMark?: number | "<dynamic>"; startIndex?: number | "<dynamic>" } = {};

  if (optionsNode.type !== "object") {
    return result;
  }

  for (const prop of optionsNode.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);

        if (key === "namespace") {
          const value = extractStringValue(valueNode, ctx);
          if (value && value !== "<dynamic>") result.namespace = value;
        } else if (key === "highWaterMark") {
          result.highWaterMark = extractNumberValue(valueNode, ctx);
        } else if (key === "startIndex") {
          result.startIndex = extractNumberValue(valueNode, ctx);
        }
      }
    }
  }

  return result;
}

function extractStreamForEachOptions(
  optionsNode: SyntaxNode,
  ctx: AnalyzerContext
): { concurrency?: number | "<dynamic>"; checkpointInterval?: number | "<dynamic>" } {
  const result: { concurrency?: number | "<dynamic>"; checkpointInterval?: number | "<dynamic>" } = {};

  if (optionsNode.type !== "object") {
    return result;
  }

  for (const prop of optionsNode.namedChildren) {
    if (prop.type === "pair") {
      const keyNode = prop.childForFieldName("key");
      const valueNode = prop.childForFieldName("value");

      if (keyNode && valueNode) {
        const key = getText(keyNode, ctx);

        if (key === "concurrency") {
          result.concurrency = extractNumberValue(valueNode, ctx);
        } else if (key === "checkpointInterval") {
          result.checkpointInterval = extractNumberValue(valueNode, ctx);
        }
      }
    }
  }

  return result;
}

function analyzeCallExpression(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const funcNode = call.childForFieldName("function");
  if (!funcNode) return [];

  const funcText = getText(funcNode, ctx);

  const stepParam = ctx.stepParameterName || "step";
  if (funcText === stepParam) {
    return [analyzeStepCall(call, ctx)];
  }

  if (funcText === `${stepParam}.retry`) {
    return [analyzeStepRetryCall(call, ctx)];
  }

  if (funcText === `${stepParam}.withTimeout`) {
    return [analyzeStepTimeoutCall(call, ctx)];
  }

  if (funcText === `${stepParam}.parallel`) {
    return analyzeParallelCall(call, ctx);
  }

  if (funcText === `${stepParam}.race`) {
    return analyzeRaceCall(call, ctx);
  }

  // Stream operations
  if (funcText === `${stepParam}.getWritable`) {
    return [analyzeStreamWritableCall(call, ctx)];
  }

  if (funcText === `${stepParam}.getReadable`) {
    return [analyzeStreamReadableCall(call, ctx)];
  }

  if (funcText === `${stepParam}.streamForEach`) {
    return [analyzeStreamForEachCall(call, ctx)];
  }

  if (["when", "unless", "whenOr", "unlessOr"].includes(funcText)) {
    return analyzeConditionalHelper(
      call,
      funcText as "when" | "unless" | "whenOr" | "unlessOr",
      ctx
    );
  }

  if (funcText === "allAsync" || funcText === "allSettledAsync") {
    return analyzeAllAsyncCall(
      call,
      funcText === "allAsync" ? "all" : "allSettled",
      ctx
    );
  }

  if (funcText === "anyAsync") {
    return analyzeAnyAsyncCall(call, ctx);
  }

  if (isLikelyWorkflowCall(call, funcText, ctx)) {
    return analyzeWorkflowRefCall(call, funcText, ctx);
  }

  return [];
}

function isLikelyWorkflowCall(
  call: SyntaxNode,
  funcText: string,
  ctx: AnalyzerContext
): boolean {
  if (funcText === ctx.currentWorkflow) {
    return false;
  }

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  if (!firstArg) return false;

  if (
    firstArg.type === "arrow_function" ||
    firstArg.type === "function_expression"
  ) {
    if (ctx.workflowNames.has(funcText)) {
      return true;
    }

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
    resolved: false,
    location: ctx.opts.includeLocations ? getLocation(call, ctx) : undefined,
  };

  return [refNode];
}

function extractCalleeFromFunctionBody(
  body: SyntaxNode,
  ctx: AnalyzerContext
): string {
  if (body.type === "call_expression") {
    const funcNode = body.childForFieldName("function");
    if (funcNode) {
      return getText(funcNode, ctx);
    }
  }

  if (body.type === "statement_block") {
    for (const child of body.namedChildren) {
      if (child.type === "return_statement") {
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

  return getText(body, ctx);
}

function analyzeStepCall(call: SyntaxNode, ctx: AnalyzerContext): StaticStepNode {
  ctx.stats.totalSteps++;

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];
  const secondArg = args?.namedChildren[1];

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

function analyzeStepRetryCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticStepNode {
  ctx.stats.totalSteps++;

  const args = call.childForFieldName("arguments");
  const argList = args?.namedChildren || [];

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

  const optionsArg = argList[1];
  const options = optionsArg ? extractStepOptions(optionsArg, ctx) : {};

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

function analyzeStepTimeoutCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticStepNode {
  ctx.stats.totalSteps++;

  const args = call.childForFieldName("arguments");
  const argList = args?.namedChildren || [];

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

  const optionsArg = argList[1];
  const options = optionsArg ? extractStepOptions(optionsArg, ctx) : {};

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

interface StepOptions {
  key?: string;
  name?: string;
  retry?: StaticRetryConfig;
  timeout?: StaticTimeoutConfig;
}

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

function analyzeParallelCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  if (!firstArg) {
    return [];
  }

  if (
    firstArg.type === "string" ||
    firstArg.type === "identifier" ||
    firstArg.type === "member_expression"
  ) {
    const parallelName =
      firstArg.type === "string"
        ? extractStringValue(firstArg, ctx)
        : getText(firstArg, ctx);

    const secondArg = args?.namedChildren[1];
    if (
      secondArg &&
      (secondArg.type === "arrow_function" ||
        secondArg.type === "function_expression")
    ) {
      const analyzed = analyzeCallbackBody(secondArg, ctx);
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

  if (firstArg.type !== "object") {
    return [];
  }

  ctx.stats.parallelCount++;

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

function analyzeParallelItem(
  keyNode: SyntaxNode,
  valueNode: SyntaxNode,
  ctx: AnalyzerContext
): StaticStepNode | null {
  ctx.stats.totalSteps++;

  const name = getText(keyNode, ctx);

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

function analyzeRaceCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.raceCount++;

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

  const consequent = consequentNode ? analyzeBlock(consequentNode, ctx) : [];

  let alternate: StaticFlowNode[] | undefined;
  if (alternateNode) {
    if (alternateNode.type === "else_clause") {
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

function analyzeBlock(node: SyntaxNode, ctx: AnalyzerContext): StaticFlowNode[] {
  if (node.type === "statement_block") {
    return analyzeStatements(node.namedChildren, ctx);
  }
  return analyzeStatement(node, ctx);
}

function analyzeSwitchStatement(
  switchStmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const valueNode = switchStmt.childForFieldName("value");
  const bodyNode = switchStmt.childForFieldName("body");

  const expression = valueNode
    ? getText(valueNode, ctx).replace(/^\(|\)$/g, "")
    : "<unknown>";

  const cases: StaticSwitchCase[] = [];
  let hasStepCalls = false;

  if (bodyNode) {
    for (const caseNode of bodyNode.namedChildren) {
      if (caseNode.type === "switch_case" || caseNode.type === "switch_default") {
        const caseValueNode = caseNode.childForFieldName("value");
        const isDefault = caseNode.type === "switch_default" || !caseValueNode;
        const caseValue = caseValueNode ? getText(caseValueNode, ctx) : undefined;

        // Analyze statements in the case body (all named children except the value)
        const bodyStatements = caseNode.namedChildren.filter(
          (n) => n !== caseValueNode
        );
        const body = analyzeStatements(bodyStatements, ctx);

        if (body.length > 0) {
          hasStepCalls = true;
        }

        cases.push({
          value: caseValue,
          isDefault,
          body,
        });
      }
    }
  }

  // Only count if there are step calls inside
  if (hasStepCalls) {
    ctx.stats.conditionalCount++;
  }

  // If no step calls, return empty
  if (!hasStepCalls) {
    return [];
  }

  const switchNode: StaticSwitchNode = {
    id: generateId(),
    type: "switch",
    expression,
    cases,
    location: ctx.opts.includeLocations ? getLocation(switchStmt, ctx) : undefined,
  };

  return [switchNode];
}

function analyzeConditionalHelper(
  call: SyntaxNode,
  helper: "when" | "unless" | "whenOr" | "unlessOr",
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.conditionalCount++;

  const args = call.childForFieldName("arguments");
  const argList = args?.namedChildren || [];

  const conditionNode = argList[0];
  const condition = conditionNode ? getText(conditionNode, ctx) : "<unknown>";

  const callbackNode = argList[1];
  const consequent = callbackNode ? analyzeCallbackBody(callbackNode, ctx) : [];

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
      return analyzeExpression(body, ctx);
    }
  }
  return analyzeExpression(node, ctx);
}

function analyzeAllAsyncCall(
  call: SyntaxNode,
  mode: "all" | "allSettled",
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.parallelCount++;

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  if (!firstArg || firstArg.type !== "array") {
    return [];
  }

  const children: StaticFlowNode[] = [];

  for (const element of firstArg.namedChildren) {
    if (element.type === "call_expression") {
      const analyzed = analyzeCallExpression(element, ctx);
      if (analyzed.length > 0) {
        children.push(...wrapInSequence(analyzed));
      } else {
        const implicitStep = createImplicitStepFromCall(element, ctx);
        if (implicitStep) {
          children.push(implicitStep);
        }
      }
    } else {
      const analyzed = analyzeCallbackBody(element, ctx);
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

function analyzeAnyAsyncCall(
  call: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  ctx.stats.raceCount++;

  const args = call.childForFieldName("arguments");
  const firstArg = args?.namedChildren[0];

  if (!firstArg || firstArg.type !== "array") {
    return [];
  }

  const children: StaticFlowNode[] = [];

  for (const element of firstArg.namedChildren) {
    if (element.type === "call_expression") {
      const analyzed = analyzeCallExpression(element, ctx);
      if (analyzed.length > 0) {
        children.push(...wrapInSequence(analyzed));
      } else {
        const implicitStep = createImplicitStepFromCall(element, ctx);
        if (implicitStep) {
          children.push(implicitStep);
        }
      }
    } else {
      const analyzed = analyzeCallbackBody(element, ctx);
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

function createImplicitStepFromCall(
  callNode: SyntaxNode,
  ctx: AnalyzerContext
): StaticStepNode | null {
  ctx.stats.totalSteps++;

  const funcNode = callNode.childForFieldName("function");
  const callee = funcNode ? getText(funcNode, ctx) : "<unknown>";

  const name = callee.includes(".") ? callee.split(".").pop() : callee;

  return {
    id: generateId(),
    type: "step",
    name,
    callee,
    location: ctx.opts.includeLocations ? getLocation(callNode, ctx) : undefined,
  };
}

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

function analyzeForInStatement(
  forStmt: SyntaxNode,
  ctx: AnalyzerContext
): StaticFlowNode[] {
  const bodyNode = forStmt.childForFieldName("body");
  if (!bodyNode) return [];

  const bodyChildren = analyzeBlock(bodyNode, ctx);
  if (bodyChildren.length === 0) return [];

  ctx.stats.loopCount++;

  const stmtText = getText(forStmt, ctx);
  const isForOf = stmtText.includes(" of ");

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

function getText(node: SyntaxNode, ctx: AnalyzerContext): string {
  return ctx.sourceCode.slice(node.startIndex, node.endIndex);
}

function extractStringValue(
  node: SyntaxNode,
  ctx: AnalyzerContext
): string | undefined {
  const text = getText(node, ctx);

  if (node.type === "string") {
    return text.slice(1, -1);
  }

  if (node.type === "template_string") {
    return "<dynamic>";
  }

  return text;
}

function getLocation(node: SyntaxNode, ctx: AnalyzerContext): SourceLocation {
  return {
    filePath: ctx.filePath,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
}

function traverseNode(
  node: SyntaxNode,
  callback: (node: SyntaxNode) => void
): void {
  callback(node);
  for (const child of node.namedChildren) {
    traverseNode(child, callback);
  }
}

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
  };
}
