import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression } from 'estree';

/**
 * Rule: require-step-id
 *
 * step() and all step helper methods require a string literal as the first argument (step ID / name).
 *
 * Covers:
 * - step('id', fn, options?)
 * - step.sleep('id', duration, options?)
 * - step.retry('id', fn, options)
 * - step.withTimeout('id', fn, options)
 * - step.try('id', fn, options)
 * - step.fromResult('id', fn, options)
 * - step.parallel('name', operations | callback)
 * - step.race('name', callback)
 * - step.allSettled('name', callback)
 *
 * BAD:  step(() => fetchUser('1'))           - missing step ID
 * BAD:  step.parallel({ a: () => ... })      - missing name (legacy form removed)
 * GOOD: step.parallel('Fetch data', { a: () => fetchA(), b: () => fetchB() })
 * GOOD: step.race('Fastest API', () => anyAsync([...]))
 */

// Step helper methods that require string (id/name) as first argument
const STEP_HELPER_METHODS = ['sleep', 'retry', 'withTimeout', 'try', 'fromResult', 'parallel', 'race', 'allSettled'];

function isDirectStepCall(node: CallExpression): boolean {
  const { callee } = node;
  return callee.type === 'Identifier' && callee.name === 'step';
}

function isStepHelperCall(node: CallExpression): string | null {
  const { callee } = node;
  if (callee.type !== 'MemberExpression') return null;

  const memberExpr = callee as MemberExpression;

  // Check if it's step.method or s.method (common alias)
  if (memberExpr.object.type !== 'Identifier') return null;

  const objectName = memberExpr.object.name;
  // Support common step parameter names: step, s, runStep
  if (objectName !== 'step' && objectName !== 's' && objectName !== 'runStep') return null;

  // Check if the property is one of our helper methods
  if (memberExpr.property.type !== 'Identifier') return null;

  const methodName = memberExpr.property.name;
  if (STEP_HELPER_METHODS.includes(methodName)) {
    return methodName;
  }

  return null;
}

function isStringLiteral(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const typed = node as { type?: string; value?: unknown };
  return typed.type === 'Literal' && typeof typed.value === 'string';
}

function isTemplateLiteralWithNoExpressions(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const typed = node as { type?: string; expressions?: unknown[] };
  return typed.type === 'TemplateLiteral' && Array.isArray(typed.expressions) && typed.expressions.length === 0;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Require a string literal as the first argument to step() and step helper methods (sleep, retry, withTimeout, try, fromResult, parallel, race, allSettled).",
      recommended: true,
    },
    schema: [],
    messages: {
      requireStepId:
        "step() requires a string literal as the first argument (step ID). Example: step('fetchUser', () => fetchUser(id)).",
      requireHelperStepId:
        "step.{{method}}() requires a string literal as the first argument (step ID). Example: step.{{method}}('{{example}}', ...).",
      requireStepSleepDuration:
        "step.sleep() requires two arguments: id and duration (e.g. step.sleep('delay', '5s')). Single-argument step.sleep(duration) is the old API and fails at runtime.",
    },
  },

  create(context) {
    return {
      CallExpression(node: CallExpression) {
        // Check direct step() call
        if (isDirectStepCall(node)) {
          const firstArg = node.arguments[0];
          if (!firstArg) {
            context.report({
              node,
              messageId: 'requireStepId',
            });
            return;
          }

          if (!isStringLiteral(firstArg) && !isTemplateLiteralWithNoExpressions(firstArg)) {
            context.report({
              node: firstArg,
              messageId: 'requireStepId',
            });
          }
          return;
        }

        // Check step helper method calls
        const helperMethod = isStepHelperCall(node);
        if (helperMethod) {
          const firstArg = node.arguments[0];

          // step.sleep(id, duration, opts?) — require at least id and duration
          if (helperMethod === 'sleep' && node.arguments.length < 2) {
            context.report({
              node,
              messageId: 'requireStepSleepDuration',
            });
            return;
          }

          // Generate example based on method
          const examples: Record<string, string> = {
            sleep: 'delay',
            retry: 'fetchData',
            withTimeout: 'slowOp',
            try: 'parse',
            fromResult: 'callProvider',
            parallel: 'Fetch data',
            race: 'Fastest API',
            allSettled: 'Fetch all',
          };

          if (!firstArg) {
            context.report({
              node,
              messageId: 'requireHelperStepId',
              data: {
                method: helperMethod,
                example: examples[helperMethod] || 'stepId',
              },
            });
            return;
          }

          if (!isStringLiteral(firstArg) && !isTemplateLiteralWithNoExpressions(firstArg)) {
            context.report({
              node: firstArg,
              messageId: 'requireHelperStepId',
              data: {
                method: helperMethod,
                example: examples[helperMethod] || 'stepId',
              },
            });
          }
        }
      },
    };
  },
};

export default rule;
