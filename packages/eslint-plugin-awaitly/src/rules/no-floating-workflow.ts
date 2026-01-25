import type { Rule } from 'eslint';
import type { CallExpression, Node } from 'estree';

/**
 * Rule: no-floating-workflow
 *
 * Detects `run()` or workflow calls that are not awaited, returned, or assigned.
 * Floating workflows execute asynchronously without any way to handle their results.
 *
 * BAD:  run(async (step) => { ... });        - fire-and-forget
 * BAD:  myWorkflow(async (step) => { ... }); - fire-and-forget
 * GOOD: await run(async (step) => { ... });
 * GOOD: const result = await run(async (step) => { ... });
 * GOOD: return run(async (step) => { ... });
 */

const WORKFLOW_FUNCTIONS = new Set(['run']);

function isWorkflowCall(node: CallExpression): boolean {
  const { callee } = node;

  // Direct run() call
  if (callee.type === 'Identifier' && WORKFLOW_FUNCTIONS.has(callee.name)) {
    return true;
  }

  return false;
}

function hasWorkflowCallbackSignature(node: CallExpression): boolean {
  const firstArg = node.arguments[0];
  if (!firstArg) return false;

  // Check if first argument is an arrow function or function expression
  return firstArg.type === 'ArrowFunctionExpression' || firstArg.type === 'FunctionExpression';
}

function isProperlyHandled(node: CallExpression, parent: Node | null): boolean {
  if (!parent) return false;

  // Awaited: await run(...)
  if (parent.type === 'AwaitExpression') {
    return true;
  }

  // Assigned: const result = run(...)
  if (parent.type === 'VariableDeclarator') {
    return true;
  }

  // Returned: return run(...)
  if (parent.type === 'ReturnStatement') {
    return true;
  }

  // Part of assignment: result = run(...)
  if (parent.type === 'AssignmentExpression') {
    return true;
  }

  // Chained: run(...).then(...)
  if (parent.type === 'MemberExpression') {
    return true;
  }

  // Arrow function implicit return: () => run(...)
  if (parent.type === 'ArrowFunctionExpression' && parent.body === node) {
    return true;
  }

  // Used in logical expressions: condition && run(...)
  if (parent.type === 'LogicalExpression') {
    return true;
  }

  // Used in conditional: condition ? run(...) : other
  if (parent.type === 'ConditionalExpression') {
    return true;
  }

  // Used as argument to another function: Promise.all([run(...)])
  if (parent.type === 'CallExpression' || parent.type === 'ArrayExpression') {
    return true;
  }

  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow floating workflow calls (run() or workflow functions not awaited/assigned)',
      recommended: true,
    },
    schema: [],
    messages: {
      floatingWorkflow:
        'Floating workflow call. The result of {{functionName}}() is not awaited, returned, or assigned. This creates a fire-and-forget async operation that cannot be tracked.',
    },
  },

  create(context) {
    const ancestors: Node[] = [];

    return {
      ':function'(node: Node) {
        ancestors.push(node);
      },
      ':function:exit'() {
        ancestors.pop();
      },
      CallExpression(node: CallExpression) {
        if (!isWorkflowCall(node)) return;
        if (!hasWorkflowCallbackSignature(node)) return;

        const parent = (node as unknown as { parent?: Node }).parent || null;

        // Check if it's in an expression statement (floating)
        if (parent?.type === 'ExpressionStatement') {
          const callee = node.callee;
          const functionName = callee.type === 'Identifier' ? callee.name : 'workflow';

          context.report({
            node,
            messageId: 'floatingWorkflow',
            data: { functionName },
          });
          return;
        }

        // Check if properly handled
        if (!isProperlyHandled(node, parent)) {
          const callee = node.callee;
          const functionName = callee.type === 'Identifier' ? callee.name : 'workflow';

          context.report({
            node,
            messageId: 'floatingWorkflow',
            data: { functionName },
          });
        }
      },
    };
  },
};

export default rule;
