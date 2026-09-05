import type { Rule } from 'eslint';
import type { CallExpression, Node, TryStatement } from 'estree';
import { stepNamesAt } from '../detect-step.js';

/**
 * Recursively walks `node` looking for a `step(...)` or `step.X(...)` call.
 *
 * Uses a generic property iteration rather than a hand-rolled child list so
 * arbitrary AST shapes (statement bodies, expression operands, switch cases,
 * loop bodies, etc.) are all covered.
 */
function hasStepCall(node: Node, context: Rule.RuleContext): boolean {
  if (node.type === 'CallExpression') {
    const call = node as CallExpression;
    const stepNames = stepNamesAt(call, context.sourceCode);
    if (call.callee.type === 'Identifier' && stepNames.has(call.callee.name)) return true;
    if (
      call.callee.type === 'MemberExpression' &&
      call.callee.object.type === 'Identifier' &&
      stepNames.has(call.callee.object.name)
    ) {
      return true;
    }
  }

  // Iterate every property and recurse into anything that looks like an AST
  // node (an object with a string `type`) or an array of such nodes. Skip
  // ESLint's runtime `parent` back-reference to avoid infinite recursion.
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === 'parent') continue;
    const v = record[key];
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object' && 'type' in (item as object)) {
          if (hasStepCall(item as Node, context)) return true;
        }
      }
    } else if ('type' in (v as object)) {
      if (hasStepCall(v as Node, context)) return true;
    }
  }
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow wrapping step calls in try/catch; prefer step.try().',
      recommended: true,
    },
    schema: [],
    messages: {
      wrapStepTry:
        'Do not wrap step() in try/catch. Use step.try() with explicit error mapping.',
    },
  },
  create(context) {
    return {
      TryStatement(node: TryStatement) {
        if (!node.handler) return;
        if (hasStepCall(node.block, context)) {
          context.report({ node, messageId: 'wrapStepTry' });
        }
      },
    };
  },
};

export default rule;
