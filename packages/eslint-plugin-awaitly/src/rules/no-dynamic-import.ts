import type { Rule } from "eslint";
import type { CallExpression } from "estree";

/**
 * Rule: no-dynamic-import
 *
 * Bans dynamic import() and require() so that bundlers and tree-shaking can
 * rely on static imports. Use static top-level import/export instead.
 *
 * BAD:  const m = await import('pkg');
 * BAD:  const m = require('pkg');
 * GOOD: import m from 'pkg';
 * GOOD: import { x } from 'pkg';
 */

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow dynamic import() and require(). Use static imports for predictable bundling and tree-shaking.",
      recommended: true,
    },
    schema: [],
    messages: {
      dynamicImport:
        "Dynamic import() is not allowed. Use static import instead.",
      require:
        "require() is not allowed. Use static import instead.",
    },
  },

  create(context) {
    return {
      ImportExpression(node) {
        context.report({ node, messageId: "dynamicImport" });
      },
      CallExpression(node: CallExpression) {
        if (node.callee.type !== "Identifier") return;
        if (node.callee.name !== "require") return;
        context.report({
          node: node.callee,
          messageId: "require",
        });
      },
    };
  },
};

export default rule;
