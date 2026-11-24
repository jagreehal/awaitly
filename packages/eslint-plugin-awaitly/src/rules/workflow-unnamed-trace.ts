import type { Rule, SourceCode } from 'eslint';
import type { CallExpression, Node } from 'estree';
import { findVariable, isImportOf } from '../bindings.js';
import { staticPropertyName } from '../workflow-context.js';

/**
 * Rule: workflow-unnamed-trace
 *
 * A run with no name traces as a bare `run` span. The runtime warns about it
 * only while an SDK is recording, so tests and CI never see that warning.
 *
 * BAD:  run({ getUser }, async (s) => s.getUser(id))
 * BAD:  createWorkflow({ getUser }).run(async ({ steps }) => steps.getUser(id))
 * GOOD: run({ getUser }, async (s) => s.getUser(id), { workflowName: 'loadUser' })
 * GOOD: run({ getUser }, async function loadUser(s) { return s.getUser(id); })
 * GOOD: createWorkflow('loadUser', { getUser })
 */

const AWAITLY = new Set(['awaitly']);
const RUN_METHODS = new Set(['run', 'runWithState']);

/** The node as the runtime sees it: without `as`, `satisfies`, `<T>` or `!`. */
function unwrap(node: Node | undefined): Node | undefined {
  let current = node;
  while (current && /^TS(As|Satisfies|NonNull)Expression$|^TSTypeAssertion$/.test(current.type)) {
    // estree has no types for TypeScript's wrapper nodes.
    current = (current as unknown as { expression: Node }).expression;
  }
  return current;
}

/**
 * Follow a `const` to what it was initialized with. An object's properties can
 * change after that, so this says what kind of value it is, never what is in it.
 */
function resolve(node: Node | undefined, sourceCode: SourceCode): Node | undefined {
  const target = unwrap(node);
  if (target?.type !== 'Identifier') return target;
  const def = findVariable(sourceCode, target)?.defs[0];
  return def?.type === 'Variable' && def.parent.kind === 'const' && def.node.id.type === 'Identifier'
    ? unwrap(def.node.init ?? undefined)
    : target;
}

/** Only the runtime knows: a dynamic value, or options that aren't written inline. */
const UNKNOWN = Symbol('unknown');

/** An option's literal value; undefined when it is left out. Reads inline objects only. */
function readOption(options: Node | undefined, key: string, sourceCode: SourceCode): unknown {
  if (!options) return undefined;
  const object = unwrap(options);
  if (object?.type === 'Identifier' && object.name === 'undefined') return undefined;
  if (object?.type !== 'ObjectExpression') return UNKNOWN;
  let value: unknown;
  for (const prop of object.properties) {
    if (prop.type !== 'Property') {
      value = UNKNOWN;
      continue;
    }
    const name = staticPropertyName(prop);
    if (name === undefined) value = UNKNOWN;
    if (name !== key) continue;
    const given = resolve(prop.value, sourceCode);
    if (given?.type === 'Literal') value = given.value;
    else value = given?.type === 'Identifier' && given.name === 'undefined' ? undefined : UNKNOWN;
  }
  return value;
}

/** Only a run known to be traced is worth a report. */
const mayBeOff = (telemetry: unknown): boolean => telemetry !== undefined && telemetry !== true;

function isAnonymousFunction(node: Node | undefined): boolean {
  const fn = unwrap(node);
  return fn?.type === 'ArrowFunctionExpression' || (fn?.type === 'FunctionExpression' && !fn.id);
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require a name on every run() and createWorkflow(), so its OpenTelemetry span is not a bare "run".',
      recommended: true,
    },
    schema: [],
    messages: {
      unnamedRun:
        "This run traces as a bare 'run' span. Pass { workflowName: '...' } after the callback, or a named function.",
      unnamedWorkflow:
        "This workflow traces as a bare 'run' span: the runtime cannot see the variable name. Pass the name first: createWorkflow('checkout', deps).",
    },
  },

  create(context) {
    const { sourceCode } = context;
    /** Reported once however many runs it has. */
    const reported = new Set<Node>();

    function checkRun(node: CallExpression): void {
      const args = node.arguments as Node[];
      // run(fn, options?) or run(deps, fn, options?)
      const at = isAnonymousFunction(args[0]) ? 0 : 1;
      if (!isAnonymousFunction(args[at])) return;
      const options = args[at + 1];
      const name = readOption(options, 'workflowName', sourceCode);
      if (name || mayBeOff(readOption(options, 'telemetry', sourceCode))) return;
      context.report({ node, messageId: 'unnamedRun' });
    }

    /** `workflow.run(fn, config?)` or `workflow.run(id, fn, config?)`: the id names no span. */
    function checkWorkflowRun(node: CallExpression): void {
      if (node.callee.type !== 'MemberExpression') return;
      if (!RUN_METHODS.has(staticPropertyName(node.callee) ?? '')) return;
      const args = node.arguments as Node[];
      const at = isAnonymousFunction(args[0]) ? 0 : 1;
      if (!isAnonymousFunction(args[at])) return;

      const created = resolve(node.callee.object, sourceCode);
      if (created?.type !== 'CallExpression' || reported.has(created)) return;
      if (!isImportOf(created.callee, 'createWorkflow', AWAITLY, sourceCode)) return;
      // createWorkflow(deps, options?) has no name; anything else in front is one.
      if (resolve(created.arguments[0], sourceCode)?.type !== 'ObjectExpression') return;

      // As at runtime, the workflow's setting applies when the call leaves it unset.
      const own = readOption(args[at + 1], 'telemetry', sourceCode);
      if (mayBeOff(own === undefined ? readOption(created.arguments[1], 'telemetry', sourceCode) : own)) return;
      reported.add(created);
      context.report({ node: created, messageId: 'unnamedWorkflow' });
    }

    return {
      CallExpression(node: CallExpression) {
        if (isImportOf(node.callee, 'run', AWAITLY, sourceCode)) checkRun(node);
        else checkWorkflowRun(node);
      },
    };
  },
};

export default rule;
