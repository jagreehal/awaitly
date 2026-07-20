import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  Pattern,
} from 'estree';

type FunctionNode =
  | ArrowFunctionExpression
  | FunctionDeclaration
  | FunctionExpression;

type NodeWithParent = Node & { parent?: Node };

function isFunctionNode(node: Node): node is FunctionNode {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression'
  );
}

function collectPatternNames(pattern: Pattern, names: Set<string>): void {
  if (pattern.type === 'Identifier') {
    names.add(pattern.name);
  } else if (pattern.type === 'AssignmentPattern') {
    collectPatternNames(pattern.left, names);
  } else if (pattern.type === 'RestElement') {
    collectPatternNames(pattern.argument, names);
  } else if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) {
      if (element) collectPatternNames(element, names);
    }
  } else if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      if (property.type === 'RestElement') {
        collectPatternNames(property.argument, names);
      } else {
        collectPatternNames(property.value, names);
      }
    }
  }
}

function workflowStepAliases(fn: FunctionNode): string[] {
  const first = fn.params[0];
  if (!first || first.type !== 'ObjectPattern') return [];
  const aliases: string[] = [];
  for (const property of first.properties) {
    if (
      property.type === 'Property' &&
      property.key.type === 'Identifier' &&
      property.key.name === 'step' &&
      property.value.type === 'Identifier'
    ) {
      aliases.push(property.value.name);
    }
  }
  return aliases;
}

/** Workflow `step` bindings visible at a node, including destructured aliases. */
export function workflowStepBindings(root: Node): Set<string> {
  const functions: FunctionNode[] = [];
  let current: Node | undefined = root;
  while (current) {
    if (isFunctionNode(current)) functions.push(current);
    current = (current as NodeWithParent).parent;
  }

  const visible = new Set<string>();
  const shadowed = new Set<string>();
  for (const fn of functions) {
    for (const alias of workflowStepAliases(fn)) {
      if (!shadowed.has(alias)) visible.add(alias);
    }
    for (const param of fn.params) collectPatternNames(param, shadowed);
  }
  return visible;
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
