import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression } from 'estree';
import { stepNamesAt } from '../detect-step.js';

/**
 * Rule: no-immediate-execution
 *
 * Detects `step('id', fn())` patterns where the function is executed immediately
 * instead of being wrapped in a thunk `step('id', () => fn())`.
 *
 * step() requires a string ID as first argument; the executor is the second.
 *
 * BAD:  step('fetchUser', fetchUser('1'))  - executes immediately
 * BAD:  step('fetchUser', deps.fetchUser('1')) - executes immediately
 * GOOD: step('fetchUser', () => fetchUser('1')) - thunk, step controls execution
 */

const STEP_METHODS = new Set(['step', 'try', 'retry', 'withTimeout', 'fromResult', 'map', 'withFallback', 'withResource', 'workflow']);

// Methods where the executor/function argument is at index 2 (3rd arg) instead of index 1 (2nd arg)
// step.map('id', items, mapper, options?) - mapper is 3rd arg
const EXECUTOR_AT_INDEX_2 = new Set(['map']);

function isDirectStepCall(node: CallExpression, context: Rule.RuleContext): boolean {
  const { callee } = node;
  return callee.type === 'Identifier' && stepNamesAt(node, context.sourceCode).has(callee.name);
}

function getStepMethodName(node: CallExpression, context: Rule.RuleContext): string | null {
  const { callee } = node;
  if (callee.type === 'MemberExpression') {
    const { object, property } = callee as MemberExpression;
    if (
      object.type === 'Identifier' &&
      stepNamesAt(node, context.sourceCode).has(object.name) &&
      property.type === 'Identifier' &&
      STEP_METHODS.has(property.name)
    ) {
      return property.name;
    }
  }
  return null;
}

function isStepCall(node: CallExpression, context: Rule.RuleContext): boolean {
  if (isDirectStepCall(node, context)) return true;
  return getStepMethodName(node, context) !== null;
}

function isStringLiteral(node: unknown): node is { type: 'Literal'; value: string } {
  if (!node || typeof node !== 'object') return false;
  const typed = node as { type?: string; value?: unknown };
  return typed.type === 'Literal' && typeof typed.value === 'string';
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
        "Avoid immediate execution in step(). Use a thunk: step('id', () => {{functionName}}(...)) instead of step('id', {{functionName}}(...)). Immediate execution defeats caching, retries, and resume capabilities.",
    },
  },

  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (!isStepCall(node, context)) return;

        const args = node.arguments;
        let executorArg: typeof args[0];

        if (isDirectStepCall(node, context)) {
          // step() requires step('id', executor, options?). Executor is second arg when first is string.
          if (isStringLiteral(args[0])) {
            executorArg = args[1];
          } else {
            // Legacy or missing ID: treat first arg as executor for backward compat
            executorArg = args[0];
          }
        } else {
          // For step.method calls, determine executor position based on method
          const methodName = getStepMethodName(node, context);
          if (args.length > 0 && isStringLiteral(args[0])) {
            // step.map('id', items, mapper, opts) - executor at index 2
            // step.retry('id', fn, opts) / step.try('id', fn, opts) - executor at index 1
            executorArg = methodName && EXECUTOR_AT_INDEX_2.has(methodName) ? args[2] : args[1];
          } else {
            executorArg = args[0];
          }
        }

        if (!executorArg) return;
        if (isThunk(executorArg)) return;
        if (!isCallExpression(executorArg)) return;

        const functionName = getCalleeName(executorArg);

        context.report({
          node: executorArg,
          messageId: 'immediateExecution',
          data: { functionName },
          fix(fixer) {
            const sourceCode = context.sourceCode;
            const executorText = sourceCode.getText(executorArg!);
            if (isDirectStepCall(node, context) && isStringLiteral(args[0])) {
              return fixer.replaceText(executorArg!, `() => ${executorText}`);
            }
            if (!isDirectStepCall(node, context) && args[0] && isStringLiteral(args[0])) {
              return fixer.replaceText(executorArg!, `() => ${executorText}`);
            }
            // Legacy step(fn()) or step(fn(), opts): fix to step('id', () => fn()[, opts])
            const suggestedId = functionName !== 'function' ? functionName : 'step';
            const restArgs = args.length > 1 ? `, ${args.slice(1).map((a) => sourceCode.getText(a)).join(', ')}` : '';
            return fixer.replaceText(node, `${sourceCode.getText(node.callee)}('${suggestedId}', () => ${executorText}${restArgs})`);
          },
        });
      },
    };
  },
};

export default rule;
