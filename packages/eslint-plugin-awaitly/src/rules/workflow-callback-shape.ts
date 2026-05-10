import type { Rule } from 'eslint';
import type {
  ArrowFunctionExpression,
  CallExpression,
  FunctionExpression,
  ObjectPattern,
} from 'estree';

function getWorkflowCallback(
  node: CallExpression
): FunctionExpression | ArrowFunctionExpression | null {
  for (const arg of node.arguments) {
    if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
      return arg;
    }
  }
  return null;
}

/**
 * Workflow callbacks receive a single destructured object: `{ step, deps?, ctx? }`.
 *
 * `step` is always present — `deps` and `ctx` are optional depending on the
 * entry point (`run()` vs `createWorkflow().run()` and whether `createContext`
 * is set). Requiring all three is too strict; require only `step` (and accept
 * any superset).
 */
function destructuresStep(pattern: ObjectPattern): boolean {
  return pattern.properties.some(
    (p) =>
      p.type === 'Property' &&
      p.key.type === 'Identifier' &&
      p.key.name === 'step'
  );
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require workflow callbacks to destructure their context, e.g. ({ step }) or ({ step, deps }) or ({ step, deps, ctx }).',
      recommended: true,
    },
    schema: [],
    messages: {
      callbackShape:
        'Workflow callback should destructure its context, e.g. ({ step }) => ... or ({ step, deps }) => ...',
    },
  },
  create(context) {
    return {
      CallExpression(node: CallExpression) {
        // Only inspect calls to a function literally named `run` (top-level) or
        // a `.run(...)` method call.
        if (node.callee.type === 'Identifier' && node.callee.name !== 'run') {
          return;
        }
        if (
          node.callee.type === 'MemberExpression' &&
          !(
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'run'
          )
        ) {
          return;
        }

        const cb = getWorkflowCallback(node);
        if (!cb) return;
        const param = cb.params[0];
        if (!param || param.type !== 'ObjectPattern' || !destructuresStep(param)) {
          context.report({ node: cb, messageId: 'callbackShape' });
        }
      },
    };
  },
};

export default rule;
