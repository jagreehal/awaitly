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
 * - saga.step('name', operation, options?)
 * - saga.tryStep('name', operation, options)
 * - tryStep('name', ...) when destructured from saga context
 *
 * BAD:  step(() => fetchUser('1'))           - missing step ID
 * BAD:  tryStep(() => deps.riskyOp(), { error: 'FAILED' })  - missing step name (destructured)
 * BAD:  saga.step(() => deps.createOrder(), { compensate: ... })  - missing step name
 * BAD:  step.parallel({ a: () => ... })      - missing name (legacy form removed)
 * GOOD: saga.step('createOrder', () => deps.createOrder(), { compensate: ... })
 * GOOD: step.parallel('Fetch data', { a: () => fetchA(), b: () => fetchB() })
 * GOOD: step.race('Fastest API', () => anyAsync([...]))
 */

// Step helper methods that require string (id/name) as first argument
const STEP_HELPER_METHODS = ['sleep', 'retry', 'withTimeout', 'try', 'fromResult', 'parallel', 'race', 'allSettled'];

/** Saga context param names that may receive step/tryStep (common in createSagaWorkflow / runSaga callbacks). */
const SAGA_CONTEXT_NAMES = ['saga', 'ctx', 'sagaContext', 's'];

function isDirectStepCall(node: CallExpression): boolean {
  const { callee } = node;
  return callee.type === 'Identifier' && callee.name === 'step';
}

/** Destructured saga: tryStep(...) as identifier (e.g. ({ step, tryStep }) => tryStep(...)). */
function isDirectTryStepCall(node: CallExpression): boolean {
  const { callee } = node;
  return callee.type === 'Identifier' && callee.name === 'tryStep';
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

/** Returns 'step' | 'tryStep' if this is X.step / X.tryStep where X is a known saga param name (caller must also verify via scope that X is the callback's first param). */
function getSagaStepMethod(node: CallExpression): 'step' | 'tryStep' | null {
  const { callee } = node;
  if (callee.type !== 'MemberExpression') return null;

  const memberExpr = callee as MemberExpression;
  if (memberExpr.object.type !== 'Identifier') return null;
  if (memberExpr.property.type !== 'Identifier') return null;

  const objectName = memberExpr.object.name;
  const methodName = memberExpr.property.name;

  if (!SAGA_CONTEXT_NAMES.includes(objectName)) return null;
  if (methodName === 'step') return 'step';
  if (methodName === 'tryStep') return 'tryStep';
  return null;
}

/**
 * False only when the member call's object (saga, s, ctx, etc.) clearly refers to a
 * local variable (const/let/var), so we skip and avoid false positives. Otherwise
 * we enforce (including when unresolved or when it's the first param).
 */
function isSagaContextMemberCall(
  context: Rule.RuleContext,
  callNode: CallExpression
): boolean {
  if (callNode.callee.type !== 'MemberExpression') return false;
  const memberExpr = callNode.callee as MemberExpression;
  if (memberExpr.object.type !== 'Identifier') return false;

  const objName = (memberExpr.object as { name: string }).name;
  let scope = context.sourceCode.getScope(callNode) as ScopeWithReferences | null;
  let ref: { resolved: { defs: Array<{ type: string }>; scope: { block: unknown; params?: unknown[] } } | null } | null = null;
  while (scope) {
    const r = scope.references.find((x) => x.identifier === memberExpr.object);
    if (r) {
      ref = r as typeof ref;
      break;
    }
    scope = scope.upper;
  }
  if (!ref || !ref.resolved) return true; // Unresolved: enforce (real saga in callback or standalone)
  const variable = ref.resolved;
  if (variable.defs.length === 0) return true;
  if (variable.defs[0].type === 'Variable' || variable.defs[0].type === 'Function') return false; // Local: skip
  if (variable.defs[0].type === 'Parameter') {
    const paramScope = variable.scope as { block: { type: string; params?: unknown[] } };
    const firstParam = paramScope.block?.params?.[0] as { type: string; name?: string } | undefined;
    if (firstParam?.type === 'Identifier' && firstParam.name !== objName) return false; // Other param: skip
  }
  return true;
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

/** Returns the string value for Literal or no-substitution TemplateLiteral, or null. Used to reject empty saga step names. */
function getStringLiteralValue(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const typed = node as {
    type?: string;
    value?: string;
    quasis?: Array<{ value?: { cooked?: string } }>;
    expressions?: unknown[];
  };
  if (typed.type === 'Literal' && typeof typed.value === 'string') return typed.value;
  if (
    typed.type === 'TemplateLiteral' &&
    Array.isArray(typed.expressions) &&
    typed.expressions.length === 0 &&
    typed.quasis?.[0]
  ) {
    const cooked = typed.quasis[0].value?.cooked;
    return typeof cooked === 'string' ? cooked : null;
  }
  return null;
}

function isEmptyStringLiteral(node: unknown): boolean {
  return getStringLiteralValue(node) === '';
}

/**
 * True when the call's callee (tryStep) refers to a saga context parameter — i.e. the
 * enclosing callback's first parameter is an object pattern that includes tryStep.
 * Avoids false positives for unrelated local functions named tryStep.
 */
function isSagaContextTryStep(
  context: Rule.RuleContext,
  callNode: CallExpression
): boolean {
  if (callNode.callee.type !== 'Identifier' || callNode.callee.name !== 'tryStep')
    return false;

  const scope = context.sourceCode.getScope(callNode) as ScopeWithReferences;
  const ref = scope.references.find((r) => r.identifier === callNode.callee);
  if (!ref || !ref.resolved) return false;

  const variable = ref.resolved;
  if (variable.defs.length === 0) return false;
  if (variable.defs[0].type !== 'Parameter') return false;

  const paramScope = variable.scope;
  let current: typeof scope | null = scope;
  while (current) {
    if (current === paramScope) break;
    current = current.upper;
  }
  if (!current) return false;

  const fn = paramScope.block as { type: string; params?: unknown[] };
  if (
    fn.type !== 'ArrowFunctionExpression' &&
    fn.type !== 'FunctionExpression' &&
    fn.type !== 'FunctionDeclaration'
  )
    return false;
  const firstParam = fn.params?.[0] as { type: string; properties?: Array<{ type: string; key?: { type: string; name?: string } }> } | undefined;
  if (!firstParam || firstParam.type !== 'ObjectPattern') return false;
  return (firstParam.properties ?? []).some(
    (p) =>
      p.type === 'Property' &&
      p.key &&
      (p.key as { type: string }).type === 'Identifier' &&
      (p.key as { name: string }).name === 'tryStep'
  );
}

interface ScopeWithReferences {
  references: Array<{ identifier: unknown; resolved: { defs: Array<{ type: string }>; scope: { block: unknown; upper: null | ScopeWithReferences } } | null }>;
  upper: ScopeWithReferences | null;
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
      requireSagaStepName:
        "saga.{{method}}() requires a string literal as the first argument (step name). Example: saga.{{method}}('createOrder', () => deps.createOrder(), { compensate: ... }).",
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

        // Check destructured tryStep(...) (name-first required) — only when tryStep refers to saga context param
        if (isDirectTryStepCall(node) && isSagaContextTryStep(context, node)) {
          const firstArg = node.arguments[0];
          if (!firstArg) {
            context.report({
              node,
              messageId: 'requireSagaStepName',
              data: { method: 'tryStep' },
            });
            return;
          }
          if (!isStringLiteral(firstArg) && !isTemplateLiteralWithNoExpressions(firstArg)) {
            context.report({
              node: firstArg,
              messageId: 'requireSagaStepName',
              data: { method: 'tryStep' },
            });
            return;
          }
          if (isEmptyStringLiteral(firstArg)) {
            context.report({
              node: firstArg,
              messageId: 'requireSagaStepName',
              data: { method: 'tryStep' },
            });
          }
          return;
        }

        // Check saga.step / saga.tryStep (name-first required) — only when object is saga context param
        const sagaMethod = getSagaStepMethod(node);
        if (sagaMethod && isSagaContextMemberCall(context, node)) {
          const firstArg = node.arguments[0];
          if (!firstArg) {
            context.report({
              node,
              messageId: 'requireSagaStepName',
              data: { method: sagaMethod },
            });
            return;
          }
          if (!isStringLiteral(firstArg) && !isTemplateLiteralWithNoExpressions(firstArg)) {
            context.report({
              node: firstArg,
              messageId: 'requireSagaStepName',
              data: { method: sagaMethod },
            });
            return;
          }
          if (isEmptyStringLiteral(firstArg)) {
            context.report({
              node: firstArg,
              messageId: 'requireSagaStepName',
              data: { method: sagaMethod },
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
