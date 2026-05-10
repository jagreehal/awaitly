import type { Rule } from 'eslint';
import type {
  CallExpression,
  IfStatement,
  MemberExpression,
  Node,
} from 'estree';

/**
 * Returns true if `node` is `<something>.error._tag` or `<something>.error.type`.
 */
function isErrorTagAccess(node: Node): boolean {
  if (node.type !== 'MemberExpression') return false;
  const me = node as MemberExpression;
  if (me.property.type !== 'Identifier') return false;
  if (me.property.name !== '_tag' && me.property.name !== 'type') return false;
  if (me.object.type !== 'MemberExpression') return false;
  const inner = me.object as MemberExpression;
  return (
    inner.property.type === 'Identifier' && inner.property.name === 'error'
  );
}

/**
 * Returns true if `node` is a call expression whose callee is an Identifier
 * named `isUnexpectedError`.
 */
function isUnexpectedGuardCall(node: Node): boolean {
  if (node.type !== 'CallExpression') return false;
  const callee = (node as CallExpression).callee;
  return callee.type === 'Identifier' && callee.name === 'isUnexpectedError';
}

/**
 * Walks the AST under `root` looking for any node that satisfies `predicate`.
 * Stops on first match.
 */
function anyDescendant(root: Node, predicate: (n: Node) => boolean): boolean {
  let found = false;
  const stack: Node[] = [root];
  while (stack.length && !found) {
    const n = stack.pop() as Node;
    if (predicate(n)) {
      found = true;
      break;
    }
    for (const key of Object.keys(n)) {
      // ESLint augments the AST with a `parent` back-reference at runtime;
      // skip it to avoid infinite loops. The estree types don't declare it,
      // so this comparison is intentionally loose.
      if ((key as string) === 'parent') continue;
      const v = (n as unknown as Record<string, unknown>)[key];
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === 'object' && 'type' in item) {
            stack.push(item as Node);
          }
        }
      } else if ('type' in (v as object)) {
        stack.push(v as Node);
      }
    }
  }
  return found;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'When matching on result.error tags, check isUnexpectedError(result.error) first to separate library bugs from typed business errors.',
      recommended: true,
    },
    schema: [],
    messages: {
      checkUnexpectedFirst:
        'Check isUnexpectedError(result.error) before matching on result.error._tag / .type. Without it, library/SDK bugs are silently treated as typed errors.',
    },
  },
  create(context) {
    return {
      IfStatement(node: IfStatement) {
        const test = node.test;
        if (!anyDescendant(test, isErrorTagAccess)) return;
        if (anyDescendant(test, isUnexpectedGuardCall)) return;
        context.report({ node: test, messageId: 'checkUnexpectedFirst' });
      },
    };
  },
};

export default rule;
