import type {
  ArrowFunctionExpression,
  FunctionDeclaration,
  FunctionExpression,
  MemberExpression,
  Node,
  Pattern,
  Property,
} from 'estree';

/** Only literal property names are knowable without evaluating user code. */
export function staticPropertyName(node: MemberExpression | Property): string | undefined {
  const key = node.type === 'MemberExpression' ? node.property : node.key;
  if (!node.computed && key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  return undefined;
}

/** Deps-first run binds steps first and context second; other callbacks bind context first. */
export function workflowContextParam(
  fn: ArrowFunctionExpression | FunctionExpression | FunctionDeclaration
): Pattern | undefined {
  const parent = (fn as Node & { parent?: Node }).parent;
  const depsFirst = parent?.type === 'CallExpression' &&
    parent.callee.type === 'Identifier' && parent.callee.name === 'run' &&
    parent.arguments[1] === fn;
  const param = fn.params[depsFirst ? 1 : 0];
  return param?.type === 'AssignmentPattern' ? param.left : param;
}
