import type { Rule } from 'eslint';
import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionExpression,
  ObjectPattern,
} from 'estree';

/**
 * Detects the awaitly workflow callback signature:
 *   ({ step, ... }) => { ... }
 *
 * The destructured `step` property is the awaitly invariant — generic callbacks
 * (setTimeout, describe, Array.from, ...) do not match this shape, so this is
 * a high-precision way to identify a workflow body without symbol resolution.
 */
function callbackHasStepDestructure(
  fn: FunctionExpression | ArrowFunctionExpression
): boolean {
  const param = fn.params[0];
  if (!param || param.type !== 'ObjectPattern') return false;
  return (param as ObjectPattern).properties.some(
    (p) =>
      p.type === 'Property' &&
      p.key.type === 'Identifier' &&
      p.key.name === 'step'
  );
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow the callable workflow form: workflow(callback). Use workflow.run(callback) instead.',
      recommended: true,
    },
    schema: [],
    messages: {
      noCallableForm:
        'Use workflow.run(...) instead of calling workflow(...) as a function. The callable form is not supported.',
    },
  },
  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (node.callee.type !== 'Identifier') return;
        // `run(callback)` and `step('id', () => ...)` are legitimate;
        // they are exempted by name to avoid duplicate diagnostics.
        if (node.callee.name === 'run' || node.callee.name === 'step') return;

        // Workflow callable form passes the body as the first or second argument
        // (callable supports `workflow(name, fn)` and `workflow(fn)`).
        const cb = node.arguments.find(
          (arg) =>
            arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression'
        ) as FunctionExpression | ArrowFunctionExpression | undefined;
        if (!cb) return;
        if (!callbackHasStepDestructure(cb)) return;

        context.report({ node, messageId: 'noCallableForm' });
      },
    };
  },
};

export default rule;
