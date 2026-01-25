import type { Rule } from 'eslint';
import type { CallExpression, MemberExpression, ObjectExpression, Property } from 'estree';

/**
 * Rule: require-thunk-for-key
 *
 * When using step() with a `key` option, the first argument MUST be a thunk.
 * Otherwise, the function executes immediately and caching never works.
 *
 * BAD:  step(fetchUser('1'), { key: 'user:1' }) - executes immediately, key is useless
 * GOOD: step(() => fetchUser('1'), { key: 'user:1' }) - thunk enables caching
 */

const STEP_METHODS = new Set(['step', 'try', 'retry', 'withTimeout', 'fromResult']);

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

function isThunk(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const typed = node as { type?: string };
  return typed.type === 'ArrowFunctionExpression' || typed.type === 'FunctionExpression';
}

function hasKeyOption(node: CallExpression): boolean {
  // Look for options object with 'key' property
  for (const arg of node.arguments) {
    if (arg.type === 'ObjectExpression') {
      const obj = arg as ObjectExpression;
      for (const prop of obj.properties) {
        if (prop.type === 'Property') {
          const property = prop as Property;
          if (
            property.key.type === 'Identifier' &&
            property.key.name === 'key'
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require thunk when using step() with a key option. Without a thunk, the function executes immediately and caching never works.',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      requireThunkForKey:
        "When using step() with a 'key' option, the first argument must be a thunk. Use step(() => fn(), { key }) instead of step(fn(), { key }). Without a thunk, the function executes immediately and the cache is never checked.",
    },
  },

  create(context) {
    return {
      CallExpression(node: CallExpression) {
        if (!isStepCall(node)) return;
        if (!hasKeyOption(node)) return;

        const firstArg = node.arguments[0];
        if (!firstArg) return;

        // If first argument is already a thunk, it's fine
        if (isThunk(firstArg)) return;

        // If there's a key option but no thunk, report error
        if (firstArg.type === 'CallExpression') {
          context.report({
            node: firstArg,
            messageId: 'requireThunkForKey',
            fix(fixer) {
              const sourceCode = context.sourceCode;
              const argText = sourceCode.getText(firstArg);
              return fixer.replaceText(firstArg, `() => ${argText}`);
            },
          });
        }
      },
    };
  },
};

export default rule;
