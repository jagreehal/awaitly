import type { Rule } from 'eslint';
import type { AwaitExpression, CallExpression, MemberExpression, Node } from 'estree';

function isDepsCall(node: CallExpression): boolean {
  if (node.callee.type !== 'MemberExpression') return false;
  const m = node.callee as MemberExpression;
  return m.object.type === 'Identifier' && m.object.name === 'deps';
}

function isInsideStepCall(node: Node): boolean {
  let current: Node | undefined = (node as Node & { parent?: Node }).parent;
  while (current) {
    if (current.type === 'CallExpression') {
      const call = current as CallExpression;
      if (call.callee.type === 'Identifier' && call.callee.name === 'step') return true;
      if (
        call.callee.type === 'MemberExpression' &&
        call.callee.object.type === 'Identifier' &&
        call.callee.object.name === 'step'
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
      description: 'Disallow bare await deps.*() in workflow callbacks. Wrap deps calls in step().',
      recommended: true,
    },
    schema: [],
    messages: {
      noBareAwait:
        "Avoid bare await on deps call. Wrap it in step(): step('id', () => deps.fn(...)).",
    },
  },
  create(context) {
    return {
      AwaitExpression(node: AwaitExpression) {
        if (!node.argument || node.argument.type !== 'CallExpression') return;
        if (!isDepsCall(node.argument)) return;
        if (isInsideStepCall(node)) return;
        context.report({ node, messageId: 'noBareAwait' });
      },
    };
  },
};

export default rule;
