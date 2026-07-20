import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression, Node } from 'estree';
import {
  subtreeContainsStepCall,
  workflowStepBindings,
} from '../detect-step.js';

/**
 * A native loop (`for`, `for-of`, `for-in`, `while`) or an array `.forEach` /
 * `.map` that contains steps produces unstable, unbounded iteration ids in the
 * diagram. Express it with `step.forEach('loop-id', items, { stepIdPattern,
 * run })` so each iteration has a structured, statically-analyzable id.
 *
 * The presence of a `step(...)` call inside the loop body is the signal that
 * this is workflow control flow rather than ordinary iteration.
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer step.forEach over a native loop that contains steps, so iteration ids are stable and the diagram stays deterministic.',
      recommended: false,
    },
    schema: [],
    messages: {
      preferStepForEach:
        "Loop containing steps produces unstable iteration ids and degrades the diagram. Use step.forEach('loop-id', items, { stepIdPattern: 'item-{i}', run: (item) => ... }).",
    },
  },
  create(context) {
    const reportIfLoopHasSteps = (node: Node, body: Node | null | undefined): void => {
      if (!body) return;
      const stepNames = workflowStepBindings(node);
      if (stepNames.size === 0 || !subtreeContainsStepCall(body, stepNames)) return;
      context.report({ node, messageId: 'preferStepForEach' });
    };

    return {
      ForStatement(node) {
        reportIfLoopHasSteps(node, node.body);
      },
      ForOfStatement(node) {
        reportIfLoopHasSteps(node, node.body);
      },
      ForInStatement(node) {
        reportIfLoopHasSteps(node, node.body);
      },
      WhileStatement(node) {
        reportIfLoopHasSteps(node, node.body);
      },
      // Array iteration: arr.forEach(cb) / arr.map(cb) whose callback runs steps.
      CallExpression(node: CallExpression) {
        if (node.callee.type !== 'MemberExpression') return;
        const callee = node.callee as MemberExpression;
        if (callee.property.type !== 'Identifier') return;
        if (callee.property.name !== 'forEach' && callee.property.name !== 'map') return;
        const cb = node.arguments[0];
        if (!cb || (cb.type !== 'ArrowFunctionExpression' && cb.type !== 'FunctionExpression')) return;
        const stepNames = workflowStepBindings(node);
        if (stepNames.size === 0 || !subtreeContainsStepCall(cb.body as Node, stepNames)) return;
        context.report({ node: callee.property, messageId: 'preferStepForEach' });
      },
    };
  },
};

export default rule;
