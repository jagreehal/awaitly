import type { Rule } from 'eslint';
import type {
  Node,
  CallExpression,
  ArrowFunctionExpression,
  FunctionExpression,
  ReturnStatement,
} from 'estree';

/**
 * Rule: no-double-wrap-result
 *
 * Detects returning ok() or err() from workflow executor functions.
 * Workflow executors should return raw values - awaitly wraps them automatically.
 *
 * BAD:  run(async (step) => { return ok({ user }); })      - Double-wrapped
 * BAD:  createWorkflow('workflow', deps)(async (step) => ok(value))    - Double-wrapped
 * GOOD: run(async (step) => { return { user }; })          - Raw value
 * GOOD: createWorkflow('workflow', deps)(async (step) => value)        - Raw value
 */

const WORKFLOW_CALLERS = new Set(['run', 'createWorkflow']);
const RESULT_CONSTRUCTORS = new Set(['ok', 'err']);

type FunctionNode = ArrowFunctionExpression | FunctionExpression;

/**
 * Trace back through a chain of method calls to find if it originates from createWorkflow().
 * Handles patterns like: createWorkflow('workflow', deps).with(...).run(...)
 */
function tracesToCreateWorkflow(node: Node): boolean {
  // Direct createWorkflow() call
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'createWorkflow'
  ) {
    return true;
  }

  // Method call on something - trace back through the chain
  // e.g., createWorkflow('workflow', deps).with(...) -> check createWorkflow(...)
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    const { object } = node.callee;
    return tracesToCreateWorkflow(object);
  }

  return false;
}

function isWorkflowCall(node: CallExpression): boolean {
  const { callee } = node;

  // Direct: run(async (step) => ...)
  if (callee.type === 'Identifier' && WORKFLOW_CALLERS.has(callee.name)) {
    return true;
  }

  // Chained: createWorkflow('workflow', deps)(async (step) => ...)
  // The outer call's callee is another CallExpression
  if (callee.type === 'CallExpression') {
    const innerCallee = callee.callee;
    if (innerCallee.type === 'Identifier' && innerCallee.name === 'createWorkflow') {
      return true;
    }
    // Handle createWorkflow('workflow', deps).with(...)(async (step) => ...)
    // where the inner call is on a member of createWorkflow result
    if (innerCallee.type === 'MemberExpression') {
      const { object, property } = innerCallee;
      if (
        property.type === 'Identifier' &&
        (property.name === 'run' || property.name === 'with')
      ) {
        // Check if the object traces back to createWorkflow
        if (
          object.type === 'CallExpression' &&
          object.callee.type === 'Identifier' &&
          object.callee.name === 'createWorkflow'
        ) {
          return true;
        }
      }
    }
  }

  // Member: run.strict(async (step) => ...) or createWorkflow(deps).run(async (step) => ...)
  if (callee.type === 'MemberExpression') {
    const { object, property } = callee;

    // run.strict(...) - object is 'run' identifier
    if (
      object.type === 'Identifier' &&
      property.type === 'Identifier' &&
      WORKFLOW_CALLERS.has(object.name)
    ) {
      return true;
    }

    // createWorkflow('workflow', deps).run(...) or .with(...).run(...)
    // Trace back through the chain to find createWorkflow
    if (
      property.type === 'Identifier' &&
      (property.name === 'run' || property.name === 'with') &&
      tracesToCreateWorkflow(object)
    ) {
      return true;
    }
  }

  return false;
}

function getExecutorCallback(node: CallExpression): FunctionNode | null {
  // Find the executor callback in the arguments
  // Could be first arg (run(fn)) or second arg (workflow(args, fn))
  for (const arg of node.arguments) {
    if (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') {
      return arg;
    }
  }
  return null;
}

function isResultConstructorCall(node: Node | null | undefined): string | null {
  if (!node) return null;
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    RESULT_CONSTRUCTORS.has(node.callee.name)
  ) {
    return node.callee.name;
  }
  return null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow returning ok() or err() from workflow executor functions. Return raw values instead.',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      doubleWrap:
        'Do not return {{fn}}() from workflow executor. Return the raw value instead. ' +
        'awaitly automatically wraps the return value, so this causes double-wrapping where result.value will be a Result object.',
    },
  },

  create(context) {
    // Stack of executor functions we're inside
    const executorStack: FunctionNode[] = [];

    return {
      CallExpression(node: CallExpression) {
        if (isWorkflowCall(node)) {
          const executor = getExecutorCallback(node);
          if (executor) {
            executorStack.push(executor);
          }
        }
      },

      'CallExpression:exit'(node: CallExpression) {
        if (isWorkflowCall(node)) {
          const executor = getExecutorCallback(node);
          if (executor && executorStack.length > 0 && executorStack[executorStack.length - 1] === executor) {
            executorStack.pop();
          }
        }
      },

      ReturnStatement(node: ReturnStatement) {
        if (executorStack.length === 0) return;

        // Check if this return is directly inside an executor (not nested function)
        const currentExecutor = executorStack[executorStack.length - 1];

        // Walk up to find containing function
        let parent: Node | null = (node as Node & { parent?: Node }).parent ?? null;
        let containingFunction: FunctionNode | null = null;

        while (parent) {
          if (parent.type === 'ArrowFunctionExpression' || parent.type === 'FunctionExpression') {
            containingFunction = parent;
            break;
          }
          if (parent.type === 'FunctionDeclaration') {
            // Inside a nested function declaration, not the executor
            return;
          }
          parent = (parent as Node & { parent?: Node }).parent ?? null;
        }

        // Only check returns that are directly in the executor
        if (containingFunction !== currentExecutor) {
          return;
        }

        const fnName = isResultConstructorCall(node.argument);
        if (fnName) {
          context.report({
            node,
            messageId: 'doubleWrap',
            data: { fn: fnName },
            fix(fixer) {
              // Autofix: return ok(value) -> return value
              // Autofix: return err(value) -> (can't autofix err, user needs to handle error differently)
              if (fnName === 'ok') {
                const call = node.argument as CallExpression;
                if (call.arguments.length === 1) {
                  const argText = context.sourceCode.getText(call.arguments[0]);
                  return fixer.replaceText(node.argument!, argText);
                }
              }
              return null;
            },
          });
        }
      },

      // Handle implicit returns in arrow functions: () => ok(value)
      ArrowFunctionExpression(node: ArrowFunctionExpression) {
        if (executorStack.length === 0) return;

        const currentExecutor = executorStack[executorStack.length - 1];
        if (node !== currentExecutor) return;

        // Check for implicit return (expression body, not block)
        if (node.body.type !== 'BlockStatement') {
          const fnName = isResultConstructorCall(node.body);
          if (fnName) {
            context.report({
              node: node.body,
              messageId: 'doubleWrap',
              data: { fn: fnName },
              fix(fixer) {
                if (fnName === 'ok') {
                  const call = node.body as CallExpression;
                  if (call.arguments.length === 1) {
                    const argText = context.sourceCode.getText(call.arguments[0]);
                    return fixer.replaceText(node.body, argText);
                  }
                }
                return null;
              },
            });
          }
        }
      },
    };
  },
};

export default rule;
