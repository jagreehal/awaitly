import type { Rule } from 'eslint';
import { staticPropertyName, workflowContextParam } from '../workflow-context.js';
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
 * Workflow callbacks receive a destructured context object: `{ step, steps?, raw?, ctx? }`.
 *
 * `step` is always present — `steps`, `raw`, and `ctx` are optional depending on the
 * entry point (`run()` vs `createWorkflow().run()` and whether `createContext`
 * is set). Requiring all three is too strict; require only `step` (and accept
 * any superset).
 */
function destructuresStep(pattern: ObjectPattern): boolean {
  return pattern.properties.some(
    (p) =>
      p.type === 'Property' &&
      staticPropertyName(p) === 'step'
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
        // Only inspect calls to a function literally named `run` (top-level) or a `.run(...)`
        // method call. Anything else - including curried calls like `it.each(rows)(name, fn)`,
        // whose callee is itself a call - is not a workflow.
        const isTopLevelRun = node.callee.type === 'Identifier' && node.callee.name === 'run';
        const isRunMethod =
          node.callee.type === 'MemberExpression' &&
          staticPropertyName(node.callee) === 'run';
        if (!isTopLevelRun && !isRunMethod) return;

        const cb = getWorkflowCallback(node);
        if (!cb) return;

        // Deps-first run(deps, (steps, context) => ...): the first parameter is the bound
        // steps object (conventionally `s`), so only the context, if taken, must be
        // destructured. durable.run(deps, fn) and workflow.run(fn) pass the context first.
        const isDepsFirstRun = isTopLevelRun && node.arguments[1] === cb;
        const contextParam = workflowContextParam(cb);
        if (isDepsFirstRun && !contextParam) return;

        if (!contextParam || contextParam.type !== 'ObjectPattern' || !destructuresStep(contextParam)) {
          context.report({ node: cb, messageId: 'callbackShape' });
        }
      },
    };
  },
};

export default rule;
