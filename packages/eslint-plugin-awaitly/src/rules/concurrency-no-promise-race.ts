import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression } from 'estree';
import { isInsideWorkflowCallback } from '../detect-step.js';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Promise.race in workflows; use step.race.', recommended: true },
    schema: [],
    messages: {
      noPromiseRace: 'Use step.race() instead of Promise.race() inside workflows.',
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
          m.property.name === 'race'
        ) {
          if (!isInsideWorkflowCallback(node, context.sourceCode)) return;
          context.report({ node, messageId: 'noPromiseRace' });
        }
      },
    };
  },
};

export default rule;
