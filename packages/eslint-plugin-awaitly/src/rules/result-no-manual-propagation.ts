import type { Rule } from 'eslint';
import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  ReturnStatement,
} from 'estree';

type AnyFunction = FunctionExpression | ArrowFunctionExpression | FunctionDeclaration;

function isOkErrCall(node: CallExpression): boolean {
  if (node.callee.type === 'Identifier') {
    return node.callee.name === 'ok' || node.callee.name === 'err';
  }
  if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
    return node.callee.property.name === 'ok' || node.callee.property.name === 'err';
  }
  return false;
}

function nearestEnclosingFunction(node: Node): AnyFunction | null {
  let cur: Node | undefined = (node as Node & { parent?: Node }).parent;
  while (cur) {
    if (
      cur.type === 'FunctionExpression' ||
      cur.type === 'ArrowFunctionExpression' ||
      cur.type === 'FunctionDeclaration'
    ) {
      return cur;
    }
    cur = (cur as Node & { parent?: Node }).parent;
  }
  return null;
}

function isWorkflowCallback(fn: AnyFunction): boolean {
  const parent = (fn as Node & { parent?: Node }).parent;
  if (!parent || parent.type !== 'CallExpression') return false;
  const call = parent as CallExpression;
  if (!call.arguments.includes(fn as unknown as CallExpression['arguments'][number])) return false;
  const callee = call.callee;
  if (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'run'
  ) {
    return true;
  }
  if (callee.type === 'Identifier' && callee.name === 'run') return true;
  if (callee.type === 'Identifier') {
    const param = fn.params[0];
    if (
      param &&
      param.type === 'ObjectPattern' &&
      param.properties.some(
        (p) =>
          p.type === 'Property' &&
          p.key.type === 'Identifier' &&
          p.key.name === 'step'
      )
    ) {
      return true;
    }
  }
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow manual Result propagation (return ok()/err()) inside workflow callbacks. Return raw values; the workflow wraps them automatically.',
      recommended: true,
    },
    schema: [],
    messages: {
      noManualPropagation:
        'Do not return ok()/err() inside a workflow callback. Return the raw value; the workflow wraps it automatically.',
    },
  },
  create(context) {
    return {
      ReturnStatement(node: ReturnStatement) {
        if (!node.argument || node.argument.type !== 'CallExpression') return;
        if (!isOkErrCall(node.argument)) return;
        const fn = nearestEnclosingFunction(node);
        if (!fn) return;
        if (!isWorkflowCallback(fn)) return;
        context.report({ node, messageId: 'noManualPropagation' });
      },
    };
  },
};

export default rule;
