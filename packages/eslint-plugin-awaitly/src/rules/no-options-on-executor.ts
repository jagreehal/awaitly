import type { Rule } from 'eslint';
import type { CallExpression, Identifier, Literal, ObjectExpression, Property } from 'estree';

/**
 * Rule: no-options-on-executor
 *
 * Detects when workflow options (cache, onEvent, deps, snapshot, etc.) are passed
 * in the wrong place. Execution is via workflow.run(fn) or workflow.run(fn, config).
 *
 * Per-run options (including call-time dependency overrides via `deps`) should be
 * passed after the callback:
 * - workflow.run(fn, config)
 * - workflow.run(name, fn, config)
 *
 * BAD:  workflow({ cache: new Map() }, async ({ step }) => { ... }) // legacy callable form
 * BAD:  workflow.run({ cache: new Map() }, async ({ step }) => { ... }) // wrong order
 * BAD:  workflow.run('run-name', { cache: new Map() }, async ({ step }) => { ... }) // wrong order
 * GOOD: await workflow.run(async ({ step }) => { ... });
 * GOOD: await workflow.run(async ({ step }) => { ... }, { deps: overrideDeps, onEvent });
 */

const KNOWN_OPTION_KEYS = new Set([
  'cache',
  'deps',
  'onEvent',
  'resumeState',
  'snapshot',
  'serialization',
  'snapshotSerialization',
  'onUnknownSteps',
  'onDefinitionChange',
  'onError',
  'onBeforeStart',
  'onAfterStep',
  'shouldRun',
  'createContext',
  'signal',
  'strict',
  'catchUnexpected',
  'description',
  'markdown',
  'streamStore',
]);

// Names that suggest an awaitly workflow executor (callable form, legacy)
const WORKFLOW_CALLEE_PATTERNS = [
  /workflow/i,
  /^run$/i,
];

// .run() and .runWithState() are the canonical execution methods
const RUN_METHOD_NAMES = new Set(['run', 'runWithState']);

function isLikelyWorkflowCall(node: CallExpression): boolean {
  const { callee } = node;

  // Direct call: workflow(...) or myWorkflow(...) (legacy callable)
  if (callee.type === 'Identifier') {
    return WORKFLOW_CALLEE_PATTERNS.some(pattern => pattern.test(callee.name));
  }

  // Member expression: this.workflow(...) or obj.workflow(...)
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    const propertyName = (callee.property as Identifier).name;
    return WORKFLOW_CALLEE_PATTERNS.some(pattern => pattern.test(propertyName));
  }

  return false;
}

function isWorkflowRunCall(node: CallExpression): boolean {
  if (node.callee.type !== 'MemberExpression' || node.callee.property.type !== 'Identifier') {
    return false;
  }
  return RUN_METHOD_NAMES.has(node.callee.property.name);
}

function isStringLiteral(node: unknown): node is Literal {
  if (!node || typeof node !== 'object') return false;
  const typed = node as { type?: string; value?: unknown };
  return typed.type === 'Literal' && typeof typed.value === 'string';
}

function isThunkOrCallback(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const typed = node as { type?: string };
  // Accept inline functions or function identifiers (e.g., `workflow({ cache }, handler)`)
  return (
    typed.type === 'ArrowFunctionExpression' ||
    typed.type === 'FunctionExpression' ||
    typed.type === 'Identifier'
  );
}

interface ObjectKeyAnalysis {
  optionKeys: string[];
  nonOptionKeys: string[];
}

function analyzeObjectKeys(node: ObjectExpression): ObjectKeyAnalysis {
  const optionKeys: string[] = [];
  const nonOptionKeys: string[] = [];

  for (const prop of node.properties) {
    if (prop.type === 'Property') {
      const property = prop as Property;
      if (property.key.type === 'Identifier') {
        const keyName = property.key.name;
        if (KNOWN_OPTION_KEYS.has(keyName)) {
          optionKeys.push(keyName);
        } else {
          nonOptionKeys.push(keyName);
        }
      }
    } else if (prop.type === 'SpreadElement') {
      // Spread elements mean we can't determine all keys statically
      // Treat as having non-option keys to avoid false positives
      nonOptionKeys.push('...');
    }
  }

  return { optionKeys, nonOptionKeys };
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow passing workflow options in the wrong argument position. For workflow.run(), pass callback first (or run name then callback), then config.',
      recommended: true,
    },
    schema: [],
    messages: {
      optionsOnExecutor:
        'Workflow options ({{ keys }}) are in the wrong place. Use workflow.run(callback, config) or workflow.run(name, callback, config).',
      optionsWrongOrderRun:
        'Workflow options ({{ keys }}) are in the wrong argument position for .run(). The callback must come first (or after run name), then config.',
    },
  },

  create(context) {
    return {
      CallExpression(node: CallExpression) {
        const args = node.arguments;
        if (args.length < 2) return;

        if (isWorkflowRunCall(node)) {
          const firstArg = args[0];
          const secondArg = args[1];

          // Pattern: workflow.run({ options }, callback)
          if (firstArg.type === 'ObjectExpression' && isThunkOrCallback(secondArg)) {
            const { optionKeys, nonOptionKeys } = analyzeObjectKeys(firstArg as ObjectExpression);
            if (optionKeys.length > 0 && nonOptionKeys.length === 0) {
              context.report({
                node: firstArg,
                messageId: 'optionsWrongOrderRun',
                data: { keys: optionKeys.join(', ') },
              });
            }
            return;
          }

          // Pattern: workflow.run('run-name', { options }, callback)
          if (args.length >= 3) {
            const thirdArg = args[2];
            if (
              isStringLiteral(firstArg) &&
              secondArg.type === 'ObjectExpression' &&
              isThunkOrCallback(thirdArg)
            ) {
              const { optionKeys, nonOptionKeys } = analyzeObjectKeys(secondArg as ObjectExpression);
              if (optionKeys.length > 0 && nonOptionKeys.length === 0) {
                context.report({
                  node: secondArg,
                  messageId: 'optionsWrongOrderRun',
                  data: { keys: optionKeys.join(', ') },
                });
              }
            }
          }
          return;
        }

        // Pattern: workflow({ options }, callback) — legacy callable form, options ignored
        if (isLikelyWorkflowCall(node)) {
          const firstArg = args[0];
          const secondArg = args[1];
          if (firstArg.type !== 'ObjectExpression') return;
          if (!isThunkOrCallback(secondArg)) return;

          const { optionKeys, nonOptionKeys } = analyzeObjectKeys(firstArg as ObjectExpression);
          if (optionKeys.length === 0 || nonOptionKeys.length > 0) return;

          context.report({
            node: firstArg,
            messageId: 'optionsOnExecutor',
            data: { keys: optionKeys.join(', ') },
          });
        }
      },
    };
  },
};

export default rule;
