import type { Rule } from 'eslint';
import type { BinaryExpression, Node, SwitchStatement } from 'estree';
import { anyDescendant } from '../ast-walk.js';

/**
 * Rule: error-prefer-match
 *
 * A Result's error union mixes string errors, `{ type }` objects and
 * `TaggedError` classes. `match` keys all three the same way and checks the
 * arms exhaustively, so normalising by hand before a `switch`, or fanning out
 * with `switch (true)`, repeats its work without the check.
 *
 * BAD:  const code = typeof result.error === 'string' ? result.error : result.error.type;
 *       switch (code) { ... }
 * BAD:  switch (true) { case result.error instanceof ValidationError: ... }
 * GOOD: match(result, { ok, NOT_FOUND: (e) => ..., ValidationError: (e) => ... })
 */

function isErrorAccess(node: Node): boolean {
  return (
    node.type === 'MemberExpression' &&
    node.property.type === 'Identifier' &&
    node.property.name === 'error'
  );
}

function isTypeofError(node: Node): boolean {
  return (
    node.type === 'UnaryExpression' &&
    node.operator === 'typeof' &&
    isErrorAccess(node.argument)
  );
}

function isStringLiteral(node: Node): boolean {
  return node.type === 'Literal' && node.value === 'string';
}

const EQUALITY = new Set(['===', '!==', '==', '!=']);

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer match(result, { ... }) over hand-normalising result.error with typeof checks or switch (true).',
      recommended: true,
    },
    schema: [],
    messages: {
      preferMatch:
        'Use match(result, { ok, ...arms }) instead of normalising result.error by hand. Strings, { type } objects and TaggedError classes all match on one key, and the arms are checked exhaustively.',
    },
  },
  create(context) {
    return {
      BinaryExpression(node: BinaryExpression) {
        if (!EQUALITY.has(node.operator)) return;
        const { left, right } = node;
        if (
          (isTypeofError(left) && isStringLiteral(right)) ||
          (isTypeofError(right) && isStringLiteral(left))
        ) {
          context.report({ node, messageId: 'preferMatch' });
        }
      },
      SwitchStatement(node: SwitchStatement) {
        const d = node.discriminant;
        if (d.type !== 'Literal' || d.value !== true) return;
        const touchesError = node.cases.some(
          (c) => c.test != null && anyDescendant(c.test, isErrorAccess),
        );
        if (touchesError) {
          context.report({ node: d, messageId: 'preferMatch' });
        }
      },
    };
  },
};

export default rule;
