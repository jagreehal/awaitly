import type { Rule } from 'eslint';
import type {
  CallExpression,
  MemberExpression,
  ObjectExpression,
  Property,
  TemplateLiteral,
  Expression,
} from 'estree';

/**
 * Rule: stable-cache-keys
 *
 * Cache keys must be stable and deterministic. Using Date.now(), Math.random(),
 * or crypto.randomUUID() in keys means the cache will never hit.
 *
 * BAD:  { key: `user:${Date.now()}` }      - new key every time
 * BAD:  { key: `user:${Math.random()}` }   - new key every time
 * GOOD: { key: `user:${userId}` }          - stable key
 */

const STEP_METHODS = new Set(['step', 'try', 'retry', 'withTimeout', 'fromResult']);

const UNSTABLE_CALLS = new Set([
  'Date.now',
  'Math.random',
  'crypto.randomUUID',
  'randomUUID',
  'uuid',
  'uuidv4',
  'nanoid',
]);

function isStepCall(node: CallExpression): boolean {
  const { callee } = node;

  if (callee.type === 'Identifier' && callee.name === 'step') {
    return true;
  }

  if (callee.type === 'MemberExpression') {
    const { object, property } = callee as MemberExpression;
    if (
      object.type === 'Identifier' &&
      object.name === 'step' &&
      property.type === 'Identifier' &&
      STEP_METHODS.has(property.name)
    ) {
      return true;
    }
  }

  return false;
}

function getCallName(node: CallExpression): string | null {
  const { callee } = node;

  if (callee.type === 'Identifier') {
    return callee.name;
  }

  if (callee.type === 'MemberExpression') {
    const { object, property } = callee as MemberExpression;
    if (object.type === 'Identifier' && property.type === 'Identifier') {
      return `${object.name}.${property.name}`;
    }
  }

  return null;
}

function containsUnstableCall(node: Expression): { found: boolean; name: string | null } {
  if (node.type === 'CallExpression') {
    const name = getCallName(node);
    if (name && UNSTABLE_CALLS.has(name)) {
      return { found: true, name };
    }
    // Check arguments recursively
    for (const arg of node.arguments) {
      if (arg.type !== 'SpreadElement') {
        const result = containsUnstableCall(arg);
        if (result.found) return result;
      }
    }
  }

  if (node.type === 'TemplateLiteral') {
    const template = node as TemplateLiteral;
    for (const expr of template.expressions) {
      const result = containsUnstableCall(expr);
      if (result.found) return result;
    }
  }

  if (node.type === 'BinaryExpression') {
    const left = containsUnstableCall(node.left as Expression);
    if (left.found) return left;
    const right = containsUnstableCall(node.right as Expression);
    if (right.found) return right;
  }

  return { found: false, name: null };
}

function getKeyValue(node: CallExpression): Expression | null {
  for (const arg of node.arguments) {
    if (arg.type === 'ObjectExpression') {
      const obj = arg as ObjectExpression;
      for (const prop of obj.properties) {
        if (prop.type === 'Property') {
          const property = prop as Property;
          if (property.key.type === 'Identifier' && property.key.name === 'key') {
            return property.value as Expression;
          }
        }
      }
    }
  }
  return null;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow non-deterministic values in cache keys. Using Date.now(), Math.random(), etc. means the cache will never hit.',
      recommended: true,
    },
    schema: [],
    messages: {
      unstableKey:
        "Cache key contains '{{name}}' which produces a different value on each call. Use stable identifiers like user IDs or idempotency keys instead.",
    },
  },

  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (!isStepCall(node)) return;

        const keyValue = getKeyValue(node);
        if (!keyValue) return;

        const result = containsUnstableCall(keyValue);
        if (result.found && result.name) {
          context.report({
            node: keyValue,
            messageId: 'unstableKey',
            data: { name: result.name },
          });
        }
      },
    };
  },
};

export default rule;
