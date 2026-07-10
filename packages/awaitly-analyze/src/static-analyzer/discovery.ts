/**
 * Workflow callsite discovery.
 *
 * Finds createWorkflow/createSagaWorkflow/runSaga/run callsites in a source
 * file, tracks awaitly imports (named/namespace/default, aliases), handles
 * identifier shadowing, and locates workflow invocations (including the
 * factory-tracing and deps-signature fallbacks).
 */

// Type-only imports - erased at compile time, no runtime dependency
import type { SourceFile, Node } from "ts-morph";
import { loadTsMorph } from "../ts-morph-loader";

import type { AnalyzerOptions } from "./shared";

export interface WorkflowCallInfo {
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

export function findWorkflowCalls(sourceFile: SourceFile, opts: Required<AnalyzerOptions>): WorkflowCallInfo[] {
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

        // Deps-first form: run(deps, fn, options?) — the callback is the
        // SECOND argument and the first is the deps object. Discriminate by
        // the second arg being a function: legacy run(cb, options) has an
        // object literal (options) there, never a function.
        const isDepsFirstForm =
          args.length >= 2 &&
          args[1] !== undefined &&
          (Node.isArrowFunction(args[1]) || Node.isFunctionExpression(args[1])) &&
          !Node.isArrowFunction(args[0]) &&
          !Node.isFunctionExpression(args[0]);

        workflows.push({
          name: `run@${fileName}:${line}`,
          callExpression: node,
          depsObject: isDepsFirstForm ? args[0] : undefined,
          optionsObject: isDepsFirstForm ? args[2] : undefined,
          callbackFunction: isDepsFirstForm ? args[1] : args[0],
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

export interface WorkflowInvocation {
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

export function findWorkflowInvocations(
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
      text === `(await ${workflowName})` ||
      text === `${workflowName}.run` ||
      text === `await ${workflowName}.run`
    ) {
      // When we have the actual workflow variable declaration, require the call's
      // callee to resolve to that declaration (avoids same-name different variable).
      if (workflowInfo.variableDeclaration) {
        // For direct calls: getCalleeIdentifier extracts workflow from `workflow(...)` or `await workflow(...)`
        // For .run() calls: need to extract workflow from `workflow.run(...)` or `await workflow.run(...)`
        let calleeId = getCalleeIdentifier(expression);
        if (!calleeId) {
          // Try extracting from PropertyAccessExpression (workflow.run case)
          const callee = getCalleeExpression(expression);
          if (Node.isPropertyAccessExpression(callee)) {
            const obj = callee.getExpression();
            if (Node.isIdentifier(obj)) {
              calleeId = obj;
            }
          }
        }
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
        // For direct calls: getCalleeIdentifier extracts the identifier
        // For .run() calls: extract the object part of the PropertyAccessExpression
        let calleeId = getCalleeIdentifier(expression);
        if (!calleeId) {
          const callee = getCalleeExpression(expression);
          if (Node.isPropertyAccessExpression(callee)) {
            const obj = callee.getExpression();
            if (Node.isIdentifier(obj)) {
              calleeId = obj;
            }
          }
        }
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
          // Only consider `workflow(cb)` or `workflow.run(cb)` where `workflow` is a function parameter.
          // Unwrap parentheses and await so (workflow)(cb) and (await workflow)(cb) are recognized.
          let calleeId = getCalleeIdentifier(expression);
          if (!calleeId) {
            const callee = getCalleeExpression(expression);
            if (Node.isPropertyAccessExpression(callee)) {
              const obj = callee.getExpression();
              if (Node.isIdentifier(obj)) {
                calleeId = obj;
              }
            }
          }
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

          const params = (firstArg as { getParameters: () => Node[] }).getParameters();
          if (params.length !== 1) return;

          const firstParam = params[0];
          if (!Node.isParameterDeclaration(firstParam)) return;
          const paramNameNode = firstParam.getNameNode();
          if (!Node.isObjectBindingPattern(paramNameNode)) return;

          const elements = paramNameNode.getElements();
          const hasStep = elements.some((e: { getName: () => string; getPropertyNameNode?: () => { getText: () => string } | undefined }) => {
            const propName = e.getPropertyNameNode?.()?.getText() || e.getName();
            return propName === "step";
          });
          if (!hasStep) return;

          const depsElement = elements.find((e: { getName: () => string; getPropertyNameNode?: () => { getText: () => string } | undefined }) => {
            const propName = e.getPropertyNameNode?.()?.getText() || e.getName();
            return propName === "deps";
          });
          if (!depsElement) return;

          const depsNameNode = (depsElement as { getNameNode?: () => Node }).getNameNode?.();
          let boundNames: string[];
          if (depsNameNode && Node.isObjectBindingPattern(depsNameNode)) {
            boundNames = depsNameNode.getElements().map((e: { getName: () => string }) => e.getName());
          } else {
            // deps is not further destructured, can't match individual dep names
            return;
          }

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
