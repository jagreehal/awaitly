/**
 * Detection for AWS Lambda durable functions written with the native SDK
 * (`@aws/durable-execution-sdk-js`, or its drop-in `awaitly-durable-lambda`).
 *
 * A durable function's code falls into two zones:
 * - orchestration: the handler body and child-context callbacks. It re-runs on
 *   every replay, so it must be deterministic and may call durable operations
 *   only on its own context.
 * - step: the function passed to `context.step` (and other operations that run
 *   user code as a step). It runs once per attempt and its result is
 *   checkpointed; it may not call durable operations at all.
 */
import type { Scope, SourceCode } from 'eslint';
import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  Identifier,
  MemberExpression,
  Node,
} from 'estree';

/** Modules whose `withDurableExecution` marks a durable handler. */
const DURABLE_MODULES = new Set(['@aws/durable-execution-sdk-js', 'awaitly-durable-lambda']);

/** DurableContext methods that create durable operations. */
export const DURABLE_OPERATIONS = new Set([
  'step',
  'wait',
  'waitForCallback',
  'createCallback',
  'invoke',
  'parallel',
  'map',
  'runInChildContext',
  'waitForCondition',
]);

/** `context.promise` combinators, which are durable operations too. */
export const DURABLE_COMBINATORS = new Set(['all', 'allSettled', 'any', 'race']);

/** Operations whose function argument runs as a step (no durable ops inside). */
const STEP_FUNCTION_OPERATIONS = new Set(['step', 'waitForCondition', 'waitForCallback']);

/** Operations whose function argument receives a child DurableContext. */
const CHILD_CONTEXT_OPERATIONS = new Set(['runInChildContext', 'map', 'parallel']);

export type FunctionNode = ArrowFunctionExpression | FunctionDeclaration | FunctionExpression;

export type DurableZone =
  | { kind: 'orchestration'; context: Scope.Variable | undefined }
  | { kind: 'step'; operation: string };

type WithParent<T> = T & { parent?: Node };

const parentOf = (node: Node): Node | undefined => (node as WithParent<Node>).parent;

export function isFunctionNode(node: Node): node is FunctionNode {
  return (
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression'
  );
}

function findVariable(sourceCode: SourceCode, node: Identifier): Scope.Variable | undefined {
  let scope: Scope.Scope | null = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return undefined;
}

/** Whether `callee` is the export `name`, imported (named or via namespace) from one of `modules`. */
function isImportOf(callee: Node, name: string, modules: ReadonlySet<string>, sourceCode: SourceCode): boolean {
  if (callee.type === 'Identifier') {
    const def = findVariable(sourceCode, callee)?.defs[0];
    return (
      def?.type === 'ImportBinding' &&
      def.node.type === 'ImportSpecifier' &&
      def.node.imported.type === 'Identifier' &&
      def.node.imported.name === name &&
      def.parent.type === 'ImportDeclaration' &&
      modules.has(String(def.parent.source.value))
    );
  }
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === name &&
    callee.object.type === 'Identifier'
  ) {
    const def = findVariable(sourceCode, callee.object)?.defs[0];
    return (
      def?.type === 'ImportBinding' &&
      def.node.type === 'ImportNamespaceSpecifier' &&
      def.parent.type === 'ImportDeclaration' &&
      modules.has(String(def.parent.source.value))
    );
  }
  return false;
}

/** Whether `callee` is `withDurableExecution` imported from a durable SDK module. */
const isWithDurableExecution = (callee: Node, sourceCode: SourceCode): boolean =>
  isImportOf(callee, 'withDurableExecution', DURABLE_MODULES, sourceCode);

/** Wrappers that pass the handler through: `validateEvent(schema, handler)`. */
const HANDLER_WRAPPER_MODULES = new Set(['awaitly-durable-lambda']);

/**
 * Whether `call` is a handler wrapper whose last argument is `fn`, passed as
 * the handler to `withDurableExecution`.
 */
function isWrappedHandler(fn: FunctionNode, call: CallExpression, sourceCode: SourceCode): boolean {
  if (call.arguments.at(-1) !== fn || !isImportOf(call.callee, 'validateEvent', HANDLER_WRAPPER_MODULES, sourceCode)) {
    return false;
  }
  const outer = parentOf(call);
  return outer?.type === 'CallExpression' && outer.arguments[0] === call && isWithDurableExecution(outer.callee, sourceCode);
}

/** The operation name of `<receiver>.<operation>(...)`, if the call has that shape. */
export function operationCall(node: CallExpression): { receiver: Expression; operation: string } | undefined {
  const callee = node.callee;
  if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
    return undefined;
  }
  if (callee.object.type === 'Super') return undefined;
  return { receiver: callee.object, operation: callee.property.name };
}

type FunctionRole =
  | { role: 'handler'; contextParam: number }
  | { role: 'child'; contextParam: number; operation: string }
  | { role: 'step'; operation: string };

/**
 * The call a function is passed to, and the argument that carries it: the
 * function itself, or the branch array of `parallel([fn, { func: fn }])`.
 */
function holdingCall(fn: FunctionNode): { call: CallExpression; viaBranch: boolean } | undefined {
  let argument: Node = fn;
  let viaBranch = false;
  let parent = parentOf(fn);
  if (parent?.type === 'Property' && parent.value === fn) {
    const branch = parentOf(parent);
    const branches = branch && parentOf(branch);
    if (branch?.type !== 'ObjectExpression' || branches?.type !== 'ArrayExpression') return undefined;
    argument = branches;
    viaBranch = true;
  } else if (parent?.type === 'ArrayExpression') {
    argument = parent;
    viaBranch = true;
  }
  parent = parentOf(argument);
  if (parent?.type !== 'CallExpression') return undefined;
  return parent.arguments.includes(argument as Expression) ? { call: parent, viaBranch } : undefined;
}

/**
 * What role a function plays in a durable function, decided by where it is
 * passed: to `withDurableExecution`, or as the function argument of an
 * operation called on a durable context. Config callbacks such as
 * `retryStrategy` have no role.
 */
function functionRole(fn: FunctionNode, sourceCode: SourceCode): FunctionRole | undefined {
  const held = holdingCall(fn);
  if (!held) return undefined;
  const { call, viaBranch } = held;

  if (
    !viaBranch &&
    ((call.arguments[0] === fn && isWithDurableExecution(call.callee, sourceCode)) ||
      isWrappedHandler(fn, call, sourceCode))
  ) {
    return { role: 'handler', contextParam: 1 };
  }

  const op = operationCall(call);
  if (!op || !isDurableContextExpression(op.receiver, sourceCode)) return undefined;
  if (viaBranch) {
    return op.operation === 'parallel' ? { role: 'child', contextParam: 0, operation: 'parallel' } : undefined;
  }
  if (STEP_FUNCTION_OPERATIONS.has(op.operation)) return { role: 'step', operation: op.operation };
  if (CHILD_CONTEXT_OPERATIONS.has(op.operation)) {
    return { role: 'child', contextParam: 0, operation: op.operation };
  }
  return undefined;
}

/** Whether `variable` is the DurableContext parameter of a handler or child callback. */
function isDurableContextVariable(variable: Scope.Variable, sourceCode: SourceCode): boolean {
  const def = variable.defs[0];
  if (def?.type !== 'Parameter' || !isFunctionNode(def.node)) return false;
  const role = functionRole(def.node, sourceCode);
  if (!role || role.role === 'step') return false;
  const param = def.node.params[role.contextParam];
  return param?.type === 'Identifier' && param.name === variable.name;
}

/** Whether an expression is a DurableContext (`context`, or `context.promise`). */
export function isDurableContextExpression(node: Expression, sourceCode: SourceCode): boolean {
  return durableContextVariableOf(node, sourceCode) !== undefined;
}

/** The DurableContext variable an expression refers to, if any. */
export function durableContextVariableOf(node: Expression, sourceCode: SourceCode): Scope.Variable | undefined {
  const target =
    node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier' && node.property.name === 'promise'
      ? (node as MemberExpression).object
      : node;
  if (target.type !== 'Identifier') return undefined;
  const variable = findVariable(sourceCode, target);
  return variable && isDurableContextVariable(variable, sourceCode) ? variable : undefined;
}

/**
 * The durable zone a node runs in, decided by its nearest enclosing function
 * that has a durable role. Plain nested functions inherit their parent's zone.
 */
export function durableZoneAt(node: Node, sourceCode: SourceCode): DurableZone | undefined {
  for (let current = parentOf(node); current; current = parentOf(current)) {
    if (!isFunctionNode(current)) continue;
    const role = functionRole(current, sourceCode);
    if (!role) continue;
    if (role.role === 'step') return { kind: 'step', operation: role.operation };
    const param = current.params[role.contextParam];
    const context =
      param?.type === 'Identifier' ? findVariable(sourceCode, param) : undefined;
    return { kind: 'orchestration', context };
  }
  return undefined;
}

/** The nearest enclosing step function of a node, if it runs inside one. */
export function enclosingStepFunction(node: Node, sourceCode: SourceCode): FunctionNode | undefined {
  for (let current = parentOf(node); current; current = parentOf(current)) {
    if (!isFunctionNode(current)) continue;
    const role = functionRole(current, sourceCode);
    if (!role) continue;
    return role.role === 'step' ? current : undefined;
  }
  return undefined;
}

export { findVariable, parentOf };
