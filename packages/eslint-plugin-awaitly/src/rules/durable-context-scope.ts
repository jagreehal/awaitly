import type { Rule } from 'eslint';
import type { CallExpression } from 'estree';
import {
  DURABLE_COMBINATORS,
  DURABLE_OPERATIONS,
  durableContextVariableOf,
  durableZoneAt,
  operationCall,
} from '../durable-context.js';

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Call durable operations from orchestration code, on the context that code received.',
      recommended: true,
    },
    schema: [],
    messages: {
      operationInStep:
        'context.{{operation}}() runs inside a {{zone}} function, and Lambda cannot run durable operations there. Move it out, or group operations with context.runInChildContext(...).',
      outerContext:
        '"{{used}}.{{operation}}()" uses an enclosing durable context inside a child context. Use this callback\'s own context parameter "{{own}}" instead.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    return {
      CallExpression(node: CallExpression) {
        const call = operationCall(node);
        if (!call || !(DURABLE_OPERATIONS.has(call.operation) || DURABLE_COMBINATORS.has(call.operation))) return;
        const used = durableContextVariableOf(call.receiver, sourceCode);
        if (!used) return;
        const zone = durableZoneAt(node, sourceCode);
        if (!zone) return;
        if (zone.kind === 'step') {
          context.report({
            node,
            messageId: 'operationInStep',
            data: { operation: call.operation, zone: `context.${zone.operation}` },
          });
          return;
        }
        if (zone.context && zone.context !== used) {
          context.report({
            node,
            messageId: 'outerContext',
            data: { used: used.name, own: zone.context.name, operation: call.operation },
          });
        }
      },
    };
  },
};

export default rule;
