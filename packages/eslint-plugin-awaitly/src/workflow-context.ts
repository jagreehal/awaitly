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

type FunctionNode = ArrowFunctionExpression | FunctionExpression | FunctionDeclaration;

/** Whether `fn` is the callback of deps-first `run(deps, fn)`. */
export function isDepsFirstRunCallback(fn: FunctionNode): boolean {
  const parent = (fn as Node & { parent?: Node }).parent;
  return parent?.type === 'CallExpression' &&
    parent.callee.type === 'Identifier' && parent.callee.name === 'run' &&
    parent.arguments[1] === fn;
}

const unwrapDefault = (param: Pattern | undefined): Pattern | undefined =>
  param?.type === 'AssignmentPattern' ? param.left : param;

/** Deps-first run binds steps first and context second; other callbacks bind context first. */
export function workflowContextParam(fn: FunctionNode): Pattern | undefined {
  return unwrapDefault(fn.params[isDepsFirstRunCallback(fn) ? 1 : 0]);
}

/** The bound-steps parameter of deps-first `run(deps, (s) => ...)`. */
export function boundStepsParam(fn: FunctionNode): Pattern | undefined {
  return isDepsFirstRunCallback(fn) ? unwrapDefault(fn.params[0]) : undefined;
}
