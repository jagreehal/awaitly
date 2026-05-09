import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression } from 'estree';

function isPromiseMethod(node: CallExpression, method: string): boolean {
  if (node.callee.type !== 'MemberExpression') return false;
  const m = node.callee as MemberExpression;
  return (
    m.object.type === 'Identifier' &&
    m.object.name === 'Promise' &&
    m.property.type === 'Identifier' &&
    m.property.name === method
  );
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Promise.all in workflows; use step.all/step.map.', recommended: true },
    schema: [],
    messages: {
      noPromiseAll: 'Use step.all() or step.map() instead of Promise.all() inside workflows.',
    },
  },
  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (isPromiseMethod(node, 'all')) {
          context.report({ node, messageId: 'noPromiseAll' });
        }
      },
    };
  },
};

export default rule;
