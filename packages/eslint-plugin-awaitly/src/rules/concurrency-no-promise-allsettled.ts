import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression } from 'estree';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Promise.allSettled in workflows; use step.map.', recommended: true },
    schema: [],
    messages: {
      noPromiseAllSettled: 'Use step.map() instead of Promise.allSettled() inside workflows.',
    },
  },
  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (node.callee.type !== 'MemberExpression') return;
        const m = node.callee as MemberExpression;
        if (
          m.object.type === 'Identifier' &&
          m.object.name === 'Promise' &&
          m.property.type === 'Identifier' &&
          m.property.name === 'allSettled'
        ) {
          context.report({ node, messageId: 'noPromiseAllSettled' });
        }
      },
    };
  },
};

export default rule;
