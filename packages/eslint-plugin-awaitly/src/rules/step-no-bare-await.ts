import type { Rule } from 'eslint';
import type { AwaitExpression, CallExpression, MemberExpression, Node } from 'estree';
import { depsNamesAt, stepNamesAt } from '../detect-step.js';

function isDepsCall(node: CallExpression, context: Rule.RuleContext): boolean {
  if (node.callee.type !== 'MemberExpression') return false;
  const m = node.callee as MemberExpression;
  return m.object.type === 'Identifier' && depsNamesAt(node, context.sourceCode).has(m.object.name);
}

function isInsideStepCall(node: Node, context: Rule.RuleContext): boolean {
  let current: Node | undefined = (node as Node & { parent?: Node }).parent;
  while (current) {
    if (current.type === 'CallExpression') {
      const call = current as CallExpression;
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
    current = (current as Node & { parent?: Node }).parent;
  }
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow bare await deps.*() in workflow callbacks. Wrap them in step() or call them through steps.*().',
      recommended: true,
    },
    schema: [],
    messages: {
      noBareAwait:
        "Avoid bare await on a raw dependency call — it is invisible to the step engine. Use steps.fn(...), or wrap it: step('id', () => deps.fn(...)).",
    },
  },
  create(context) {
    return {
      AwaitExpression(node: AwaitExpression) {
        if (!node.argument || node.argument.type !== 'CallExpression') return;
        if (!isDepsCall(node.argument, context)) return;
        if (isInsideStepCall(node, context)) return;
        context.report({ node, messageId: 'noBareAwait' });
      },
    };
  },
};

export default rule;
