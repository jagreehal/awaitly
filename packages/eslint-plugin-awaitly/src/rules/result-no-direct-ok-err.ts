import type { Rule } from 'eslint';
import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
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

/**
 * A workflow callback is a function passed directly as an argument to:
 *   - `something.run(callback)` (e.g. `workflow.run(...)`)
 *   - `run(callback)` (the bare run() entry point)
 *   - `workflow(callback)` / `workflow(args, callback)` (callable form — also a
 *     workflow body, even if `workflow-no-callable-form` flags it separately).
 */
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
  // Heuristic for callable form: callback's first parameter destructures `step`.
  // This lines up with the awaitly workflow callback signature without
  // requiring symbol resolution.
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
        'Disallow direct ok()/err() calls inside workflow callbacks. Steps unwrap Results automatically; raw values are returned from the callback.',
      recommended: true,
    },
    schema: [],
    messages: {
      noDirectOkErr:
        'Do not call ok()/err() directly inside a workflow callback. Return raw values; steps unwrap Results automatically.',
    },
  },
  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (!isOkErrCall(node)) return;
        const fn = nearestEnclosingFunction(node);
        if (!fn) return;
        if (!isWorkflowCallback(fn)) return;
        context.report({ node, messageId: 'noDirectOkErr' });
      },
    };
  },
};

export default rule;
