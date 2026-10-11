import type { Rule } from 'eslint';
import type { CallExpression, Expression, SpreadElement } from 'estree';
import { durableContextVariableOf, operationCall } from '../durable-context.js';

/**
 * The config is always the last argument when present. A last argument that is
 * the name or the submitter means there is no config; anything else (a
 * variable, a call) is a config we cannot see into.
 */
function lastArgument(args: (Expression | SpreadElement)[]): 'none' | 'unknown' | Expression {
  const last = args.at(-1);
  if (!last || last.type === 'Literal' || last.type === 'TemplateLiteral') return 'none';
  if (last.type === 'ArrowFunctionExpression' || last.type === 'FunctionExpression') return 'none';
  return last.type === 'ObjectExpression' ? last : 'unknown';
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require a timeout on waitForCallback and createCallback, so the wait for a missing callback ends at that timeout.',
      recommended: true,
    },
    schema: [],
    messages: {
      missingTimeout:
        'context.{{operation}}() has no timeout, so a callback that never arrives holds the execution open until its execution timeout (up to a year). Pass { timeout: { ... } }.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      CallExpression(node: CallExpression) {
        const call = operationCall(node);
        if (!call || (call.operation !== 'waitForCallback' && call.operation !== 'createCallback')) return;
        if (!durableContextVariableOf(call.receiver, sourceCode)) return;
        const config = lastArgument(node.arguments);
        // A config we cannot see into gets the benefit of the doubt.
        if (config === 'unknown') return;
        const hasTimeout = config !== 'none' && config.type === 'ObjectExpression' && config.properties.some(
          (p) =>
            p.type === 'SpreadElement' ||
            (p.type === 'Property' && !p.computed && p.key.type === 'Identifier' && p.key.name === 'timeout')
        );
        if (!hasTimeout) {
          context.report({ node, messageId: 'missingTimeout', data: { operation: call.operation } });
        }
      },
    };
  },
};

export default rule;
