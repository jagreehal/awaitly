import type { Rule, Scope } from 'eslint';
import type { AssignmentExpression, Node, Pattern, UpdateExpression } from 'estree';
import { enclosingStepFunction, findVariable } from '../durable-context.js';

/** The variable at the root of an assignment target: `x`, `x.y`, `x[i].z`. */
function rootIdentifier(target: Pattern | Node): Node | undefined {
  let current: Node = target;
  while (current.type === 'MemberExpression') current = current.object;
  return current.type === 'Identifier' ? current : undefined;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a step to return its result instead of writing it to a variable declared outside the step, which a replay skips.',
      recommended: true,
    },
    schema: [],
    messages: {
      closureMutation:
        'Writing to "{{name}}" inside a step is lost on replay: completed steps do not run again. Return the value from the step and use its result instead.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const check = (node: AssignmentExpression | UpdateExpression, target: Pattern | Node) => {
      const step = enclosingStepFunction(node, sourceCode);
      if (!step) return;
      const root = rootIdentifier(target);
      if (root?.type !== 'Identifier') return;
      const variable: Scope.Variable | undefined = findVariable(sourceCode, root);
      const declaration = variable?.defs[0]?.name;
      if (!declaration) return;
      // Declared inside the step function: local state, not a closure write.
      const [start, end] = step.range ?? [0, 0];
      const at = declaration.range?.[0] ?? -1;
      if (at >= start && at <= end) return;
      context.report({ node, messageId: 'closureMutation', data: { name: root.name } });
    };
    return {
      AssignmentExpression(node: AssignmentExpression) {
        check(node, node.left);
      },
      UpdateExpression(node: UpdateExpression) {
        check(node, node.argument);
      },
    };
  },
};

export default rule;
