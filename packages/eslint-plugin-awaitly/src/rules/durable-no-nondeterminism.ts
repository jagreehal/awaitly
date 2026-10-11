import type { Rule } from 'eslint';
import type { CallExpression, NewExpression, Node } from 'estree';
import { durableZoneAt, findVariable } from '../durable-context.js';

/** `<object>.<property>()` calls that return a different value on every run. */
const NONDETERMINISTIC_MEMBERS: Record<string, ReadonlySet<string>> = {
  Date: new Set(['now']),
  Math: new Set(['random']),
  crypto: new Set(['randomUUID', 'getRandomValues']),
  performance: new Set(['now']),
};

/** Named imports from node:crypto that are nondeterministic. */
const CRYPTO_IMPORTS = new Set(['randomUUID', 'randomBytes', 'randomInt']);

function describeCall(node: CallExpression, sourceCode: Rule.RuleContext['sourceCode']): string | undefined {
  const callee = node.callee;
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.property.type === 'Identifier' &&
    NONDETERMINISTIC_MEMBERS[callee.object.name]?.has(callee.property.name) &&
    // A local binding named Date/Math/crypto is not the global.
    !findVariable(sourceCode, callee.object)?.defs.length
  ) {
    return `${callee.object.name}.${callee.property.name}()`;
  }
  if (callee.type === 'Identifier') {
    if (callee.name === 'Date' && !findVariable(sourceCode, callee)?.defs.length) return 'Date()';
    const def = findVariable(sourceCode, callee)?.defs[0];
    if (
      def?.type === 'ImportBinding' &&
      def.node.type === 'ImportSpecifier' &&
      def.node.imported.type === 'Identifier' &&
      CRYPTO_IMPORTS.has(def.node.imported.name) &&
      def.parent.type === 'ImportDeclaration' &&
      ['crypto', 'node:crypto'].includes(String(def.parent.source.value))
    ) {
      return `${def.node.imported.name}()`;
    }
  }
  return undefined;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow time, randomness, and IDs in durable orchestration code; compute them in a step so replays see the checkpointed value.',
      recommended: true,
    },
    schema: [],
    messages: {
      nondeterministic:
        '{{api}} returns a different value when this durable function replays. Compute it inside context.step(...) so the value is checkpointed.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const check = (node: Node, api: string | undefined) => {
      if (api && durableZoneAt(node, sourceCode)?.kind === 'orchestration') {
        context.report({ node, messageId: 'nondeterministic', data: { api } });
      }
    };
    return {
      CallExpression(node: CallExpression) {
        check(node, describeCall(node, sourceCode));
      },
      NewExpression(node: NewExpression) {
        const isNewDate =
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Date' &&
          node.arguments.length === 0 &&
          !findVariable(sourceCode, node.callee)?.defs.length;
        check(node, isNewDate ? 'new Date()' : undefined);
      },
    };
  },
};

export default rule;
