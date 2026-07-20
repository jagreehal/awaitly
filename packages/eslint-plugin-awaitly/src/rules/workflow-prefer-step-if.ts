import type { Rule } from 'eslint';
import type { IfStatement, Node } from 'estree';
import {
  subtreeContainsStepCall,
  workflowStepBindings,
} from '../detect-step.js';

/**
 * A raw `if/else` that contains steps has no stable branch identity, so the
 * static analyzer can't render it deterministically (it degrades to an
 * unlabelled branch). Express the branch with `step.if` (labelled decision) or
 * a `when`/`unless` guard so the diagram stays exact.
 *
 * The presence of a `step(...)` call inside the branch is the signal that this
 * is workflow control flow rather than ordinary application `if`.
 */
const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer step.if / when / unless over a raw if/else that contains steps, so the workflow diagram stays deterministic.',
      recommended: false,
    },
    schema: [],
    messages: {
      preferStepIf:
        "Raw if/else containing steps has no stable branch id and degrades the diagram. Use step.if('decision-id', () => condition, ...) for a labelled branch, or when()/unless() to guard a single step.",
    },
  },
  create(context) {
    return {
      IfStatement(node: IfStatement) {
        // Skip `else if` chains — only report the outermost if, otherwise a
        // ladder produces a report per rung.
        const parent = (node as Node & { parent?: Node }).parent;
        if (parent && parent.type === 'IfStatement' && (parent as IfStatement).alternate === node) {
          return;
        }

        const stepNames = workflowStepBindings(node);
        if (stepNames.size === 0) return;
        const inConsequent = subtreeContainsStepCall(node.consequent, stepNames);
        const inAlternate = node.alternate
          ? subtreeContainsStepCall(node.alternate, stepNames)
          : false;
        if (!inConsequent && !inAlternate) return;

        context.report({ node: node.test, messageId: 'preferStepIf' });
      },
    };
  },
};

export default rule;
