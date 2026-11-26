import type { SourceCode, Scope } from 'eslint';
import { findVariable } from './bindings.js';
import { boundStepsParam, isDepsFirstRunCallback, staticPropertyName, workflowContextParam } from './workflow-context.js';
import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
} from 'estree';

type FunctionNode =
  | ArrowFunctionExpression
  | FunctionDeclaration
  | FunctionExpression;

function isFunctionNode(node: Node): node is FunctionNode {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression'
  );
}

/**
 * Names bound by the callback's static context properties.
 * Defaults and quoted keys do not change which property is being bound.
 */
function workflowContextAliases(fn: FunctionNode, key: string): string[] {
  const first = workflowContextParam(fn);
  if (!first || first.type !== 'ObjectPattern') return [];
  const aliases: string[] = [];
  for (const property of first.properties) {
    if (property.type !== 'Property') continue;
    const propertyName = staticPropertyName(property);
    const value = property.value.type === 'AssignmentPattern'
      ? property.value.left : property.value;
    if (propertyName === key && value.type === 'Identifier') {
      aliases.push(value.name);
    }
  }
  return aliases;
}

/**
 * Resolve the nearest declaration of each name using ESLint's lexical scopes.
 * This respects block, catch, loop, function-name and parameter shadowing.
 */
function workflowBindings(root: Node, key: string, sourceCode: SourceCode): Set<string> {
  const visible = new Set<string>();
  const origin = sourceCode.getScope(root);
  let scope: Scope.Scope | null = origin;
  while (scope) {
    if (isFunctionNode(scope.block)) {
      const fn = scope.block;
      for (const alias of workflowContextAliases(fn, key)) {
        // Look up only candidate aliases, rather than scanning every local and
        // global variable once per call expression.
        let bindingScope: Scope.Scope | null = origin;
        while (bindingScope) {
          const variable = bindingScope.set.get(alias);
          if (variable) {
            if (variable.defs.some(def => def.type === 'Parameter' && def.node === fn)) {
              visible.add(alias);
            }
            break;
          }
          bindingScope = bindingScope.upper;
        }
      }
    }
    scope = scope.upper;
  }
  return visible;
}

/** Workflow `step` bindings visible at a node, including destructured aliases. */
export function workflowStepBindings(root: Node, sourceCode: SourceCode): Set<string> {
  return workflowBindings(root, 'step', sourceCode);
}

/**
 * Include the canonical name for compatibility with standalone fragments and
 * extracted helpers; resolve other names against their actual declarations.
 */
export function stepNamesAt(node: Node, sourceCode: SourceCode): ReadonlySet<string> {
  const names = workflowStepBindings(node, sourceCode);
  names.add('step');
  return names;
}

/**
 * Concurrency advice is actionable when a context step binding is visible, or
 * inside deps-first `run(deps, fn)`, whose second parameter offers `step`.
 */
export function isInsideWorkflowCallback(node: Node, sourceCode: SourceCode): boolean {
  if (workflowStepBindings(node, sourceCode).size > 0) return true;
  let scope: Scope.Scope | null = sourceCode.getScope(node);
  while (scope) {
    if (isFunctionNode(scope.block) && isDepsFirstRunCallback(scope.block)) return true;
    scope = scope.upper;
  }
  return false;
}

/**
 * Whether a call runs a bound step of deps-first `run(deps, fn)`:
 * `s.getUser(id)` for `(s) => ...`, or `getUser(id)` for `({ getUser }) => ...`.
 * Resolved through the scope, so a shadowing local is left alone.
 */
export function isBoundStepCall(node: CallExpression, sourceCode: SourceCode): boolean {
  const callee = node.callee;
  const viaObject = callee.type === 'MemberExpression';
  const id = viaObject ? callee.object : callee;
  if (id.type !== 'Identifier') return false;
  const def = findVariable(sourceCode, id)?.defs[0];
  if (def?.type !== 'Parameter' || !isFunctionNode(def.node)) return false;
  const param = boundStepsParam(def.node);
  if (!param || param.type !== (viaObject ? 'Identifier' : 'ObjectPattern')) return false;
  const [start, end] = param.range ?? [0, -1];
  const [nameStart, nameEnd] = def.name.range ?? [-1, -1];
  return start <= nameStart && nameEnd <= end;
}

/** Dependency aliases, with the same canonical-name compatibility as step. */
export function depsNamesAt(node: Node, sourceCode: SourceCode): ReadonlySet<string> {
  const names = workflowBindings(node, 'deps', sourceCode);
  names.add('deps');
  return names;
}

/**
 * Whether a call expression is a step call: `step(...)` or `step.something(...)`.
 * `step` is only in scope inside a workflow callback, so a step call is a
 * reliable signal that we're looking at workflow control flow.
 */
export function isStepCall(node: CallExpression, stepNames: ReadonlySet<string>): boolean {
  const callee = node.callee;
  if (callee.type === 'Identifier') return stepNames.has(callee.name);
  if (
    callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    stepNames.has(callee.object.name)
  ) {
    return true;
  }
  return false;
}

/**
 * Whether a subtree contains a step call anywhere within it. Used to decide
 * whether a raw branch/loop is workflow control flow that should be expressed
 * with a first-class construct (step.if / step.forEach).
 */
export function subtreeContainsStepCall(
  root: Node,
  stepNames: ReadonlySet<string>
): boolean {
  let found = false;

  const walk = (value: unknown): void => {
    if (found || value == null || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    const node = value as Node & Record<string, unknown>;
    if (typeof node.type === 'string') {
      if (
        node.type === 'CallExpression' &&
        isStepCall(node as CallExpression, stepNames)
      ) {
        found = true;
        return;
      }
    }

    for (const key in node) {
      if (key === 'parent') continue; // avoid walking back up the tree
      walk(node[key]);
    }
  };

  walk(root);
  return found;
}
