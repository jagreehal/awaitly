import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression, Node } from 'estree';

/**
 * Rule: no-floating-result
 *
 * Detects step() calls whose Result is discarded without handling.
 * Results should be assigned or their status checked.
 *
 * BAD:  step(() => fetchUser());             - Result ignored
 * BAD:  await step(() => fetchUser());       - Awaited but ignored
 * GOOD: const result = await step(() => fetchUser());
 * GOOD: return step(() => fetchUser());
 */

const STEP_METHODS = new Set(['step', 'try', 'retry', 'withTimeout', 'fromResult', 'parallel', 'race']);

function isStepCall(node: CallExpression): boolean {
  const { callee } = node;

  // Direct step() call
  if (callee.type === 'Identifier' && callee.name === 'step') {
    return true;
  }

  // step.try(), step.retry(), step.withTimeout(), step.fromResult(), step.parallel(), step.race()
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

function isProperlyHandled(node: CallExpression, parent: Node | null): boolean {
  if (!parent) return false;

  // Assigned: const result = step(...)
  if (parent.type === 'VariableDeclarator') {
    return true;
  }

  // Returned: return step(...)
  if (parent.type === 'ReturnStatement') {
    return true;
  }

  // Part of assignment: result = step(...)
  if (parent.type === 'AssignmentExpression') {
    return true;
  }

  // Chained: step(...).andThen(...) or step(...).value (though .value is unsafe)
  if (parent.type === 'MemberExpression') {
    return true;
  }

  // Arrow function implicit return: () => step(...)
  if (parent.type === 'ArrowFunctionExpression' && parent.body === node) {
    return true;
  }

  // Used in logical expressions: condition && step(...)
  if (parent.type === 'LogicalExpression') {
    return true;
  }

  // Used in conditional: condition ? step(...) : other
  if (parent.type === 'ConditionalExpression') {
    return true;
  }

  // Used as argument to another function: allAsync([step(...)])
  if (parent.type === 'CallExpression' || parent.type === 'ArrayExpression') {
    return true;
  }

  // Awaited - need to check the parent of await
  if (parent.type === 'AwaitExpression') {
    const awaitParent = (parent as unknown as { parent?: Node }).parent || null;
    return isProperlyHandled(parent as unknown as CallExpression, awaitParent);
  }

  return false;
}

function getStepMethodName(node: CallExpression): string {
  const { callee } = node;

  if (callee.type === 'Identifier') {
    return callee.name;
  }

  if (callee.type === 'MemberExpression') {
    const { object, property } = callee;
    if (object.type === 'Identifier' && property.type === 'Identifier') {
      return `${object.name}.${property.name}`;
    }
  }

  return 'step';
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow discarding Result values from step() calls. Results must be assigned or returned.',
      recommended: true,
    },
    schema: [],
    messages: {
      floatingResult:
        "Floating Result from {{methodName}}(). The Result is discarded without checking its status. Assign it to a variable or return it.",
    },
  },

  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (!isStepCall(node)) return;

        const parent = (node as unknown as { parent?: Node }).parent || null;

        // Check if it's in an expression statement (floating)
        if (parent?.type === 'ExpressionStatement') {
          const methodName = getStepMethodName(node);
          context.report({
            node,
            messageId: 'floatingResult',
            data: { methodName },
          });
          return;
        }

        // Check if properly handled
        if (!isProperlyHandled(node, parent)) {
          const methodName = getStepMethodName(node);
          context.report({
            node,
            messageId: 'floatingResult',
            data: { methodName },
          });
        }
      },
    };
  },
};

export default rule;
