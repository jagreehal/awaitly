import type { Rule } from 'eslint';
import type { CallExpression, Identifier, ObjectExpression, Property } from 'estree';

/**
 * Rule: no-options-on-executor
 *
 * Detects when workflow options (cache, onEvent, snapshot, etc.) are passed
 * to the workflow executor function instead of createWorkflow().
 *
 * Options passed to the executor are silently ignored, which is a common mistake.
 *
 * BAD:  await workflow({ cache: new Map() }, async ({ step }) => { ... })
 * GOOD: const workflow = createWorkflow('workflow', deps, { cache: new Map() });
 *       await workflow(async ({ step }) => { ... });
 */

const KNOWN_OPTION_KEYS = new Set([
  'cache',
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

// Names that suggest an awaitly workflow executor
const WORKFLOW_CALLEE_PATTERNS = [
  /workflow/i,  // workflow, myWorkflow, userWorkflow, etc.
  /^run$/i,     // run (common awaitly pattern)
];

function isLikelyWorkflowCall(node: CallExpression): boolean {
  const { callee } = node;

  // Direct call: workflow(...) or myWorkflow(...)
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
        'Disallow passing workflow options to the executor function. Options like cache, onEvent, and snapshot should be passed to createWorkflow() instead.',
      recommended: true,
    },
    schema: [],
    messages: {
      optionsOnExecutor:
        'Workflow options ({{ keys }}) passed to executor are ignored. Pass options to createWorkflow() instead:\n' +
        '  const workflow = createWorkflow(\'workflow\', deps, { {{ keys }} });\n' +
        '  await workflow(async ({ step }) => { ... });',
    },
  },

  create(context) {
    return {
      CallExpression(node: CallExpression) {
        // Only check calls that look like workflow executors
        if (!isLikelyWorkflowCall(node)) return;

        // Check for pattern: workflow({ optionsKey: value }, async ({ step }) => { ... })
        const args = node.arguments;

        // Need at least 2 arguments: options object and callback
        if (args.length < 2) return;

        const firstArg = args[0];
        const secondArg = args[1];

        // First arg must be an object expression
        if (firstArg.type !== 'ObjectExpression') return;

        // Second arg must be a function (arrow or regular)
        if (!isThunkOrCallback(secondArg)) return;

        // Check if the object has ONLY known option keys (no other properties)
        // This matches the runtime warning logic which only warns when all keys are options
        const { optionKeys, nonOptionKeys } = analyzeObjectKeys(firstArg as ObjectExpression);

        // Only report if ALL keys are option keys (pure options object, not args with coincidental names)
        if (optionKeys.length > 0 && nonOptionKeys.length === 0) {
          context.report({
            node: firstArg,
            messageId: 'optionsOnExecutor',
            data: {
              keys: optionKeys.join(', '),
            },
          });
        }
      },
    };
  },
};

export default rule;
