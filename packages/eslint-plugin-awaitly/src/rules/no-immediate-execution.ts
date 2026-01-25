import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression } from 'estree';

/**
 * Rule: no-immediate-execution
 *
 * Detects `step(fn())` patterns where the function is executed immediately
 * instead of being wrapped in a thunk `step(() => fn())`.
 *
 * BAD:  step(fetchUser('1'))           - executes immediately
 * BAD:  step(deps.fetchUser('1'))      - executes immediately
 * GOOD: step(() => fetchUser('1'))     - thunk, step controls execution
 * GOOD: step(() => deps.fetchUser('1')) - thunk, step controls execution
 */

const STEP_METHODS = new Set(['step', 'try', 'retry', 'withTimeout', 'fromResult']);

function isStepCall(node: CallExpression): boolean {
  const { callee } = node;

  // Direct step() call
  if (callee.type === 'Identifier' && callee.name === 'step') {
    return true;
  }

  // step.try(), step.retry(), step.withTimeout(), step.fromResult()
  if (callee.type === 'MemberExpression') {
    const { object, property } = callee as MemberExpression;
    if (
      object.type === 'Identifier' &&
      object.name === 'step' &&
      property.type === 'Identifier' &&
      STEP_METHODS.has(property.name)
    ) {
      return true;
    }
  }

  return false;
}

function isThunk(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const typed = node as { type?: string };

  // Arrow function: () => ...
  if (typed.type === 'ArrowFunctionExpression') return true;

  // Regular function: function() { ... }
  if (typed.type === 'FunctionExpression') return true;

  return false;
}

function isCallExpression(node: unknown): node is CallExpression {
  if (!node || typeof node !== 'object') return false;
  return (node as { type?: string }).type === 'CallExpression';
}

function getCalleeName(node: CallExpression): string {
  const { callee } = node;

  if (callee.type === 'Identifier') {
    return callee.name;
  }

  if (callee.type === 'MemberExpression') {
    const { property } = callee;
    if (property.type === 'Identifier') {
      return property.name;
    }
  }

  return 'function';
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow immediate function execution in step() calls. Use thunks: step(() => fn()) instead of step(fn())',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      immediateExecution:
        "Avoid immediate execution in step(). Use a thunk: step(() => {{functionName}}(...)) instead of step({{functionName}}(...)). Immediate execution defeats caching, retries, and resume capabilities.",
    },
  },

  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (!isStepCall(node)) return;

        const firstArg = node.arguments[0];
        if (!firstArg) return;

        // If first argument is already a thunk (arrow function or function expression), it's fine
        if (isThunk(firstArg)) return;

        // If first argument is a call expression, it's being executed immediately - BAD
        if (isCallExpression(firstArg)) {
          const functionName = getCalleeName(firstArg);

          context.report({
            node: firstArg,
            messageId: 'immediateExecution',
            data: { functionName },
            fix(fixer) {
              const sourceCode = context.sourceCode;
              const argText = sourceCode.getText(firstArg);
              return fixer.replaceText(firstArg, `() => ${argText}`);
            },
          });
        }
      },
    };
  },
};

export default rule;
