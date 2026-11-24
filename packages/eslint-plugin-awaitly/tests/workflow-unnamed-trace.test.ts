import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });
const config = [
  {
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { awaitly: plugin },
    rules: { 'awaitly/workflow-unnamed-trace': 'error' },
  },
];
const lint = (code: string, imports = "import { run, createWorkflow } from 'awaitly';") =>
  linter.verify(`${imports}\n${code}`, config).map((m) => m.messageId ?? m.message);

describe('workflow-unnamed-trace', () => {
  it.each([
    ['named by option', "run({ a }, async (s) => s.a(), { workflowName: 'load' })"],
    ['named by option, callback only', "run(async ({ step }) => step('a', a), { workflowName: 'load' })"],
    ['name held in a variable', 'run({ a }, async (s) => s.a(), { workflowName })'],
    ['named function', 'run({ a }, async function load(s) { return s.a(); })'],
    ['function reference', 'run({ a }, load)'],
    ['options it cannot read', 'run({ a }, async (s) => s.a(), options)'],
    ['options with a spread', 'run({ a }, async (s) => s.a(), { ...options })'],
    ['tracing off through a const', 'const telemetry = false; run(async () => 1, { telemetry })'],
    ['tracing that may be off', 'run({ a }, async (s) => s.a(), { telemetry: isEnabled() })'],
    ['options given a name later', "const options = {}; options.workflowName = 'load'; run({ a }, async (s) => s.a(), options)"],
    ['options turned off later', 'const options = {}; options.telemetry = false; const w = createWorkflow({ a }, options); w.run(async ({ steps }) => steps.a())'],
    ['workflow tracing off through a const', 'const telemetry = false; createWorkflow({ a }, { telemetry }).run(async ({ steps }) => steps.a())'],
    ['tracing off', 'run({ a }, async (s) => s.a(), { telemetry: false })'],
    ['options in a const with a name', "const o = { workflowName: 'load' }; run({ a }, async (s) => s.a(), o)"],
    ['a spread then a name', "run({ a }, async (s) => s.a(), { ...options, workflowName: 'load' })"],
    ['named workflow', "createWorkflow('load', { a }).run(async ({ steps }) => steps.a())"],
    ['workflow name in a const', "const NAME = 'load'; createWorkflow(NAME, { a }).run(async ({ steps }) => steps.a())"],
    ['workflow run by a named function', 'createWorkflow({ a }).run(async function load({ steps }) { return steps.a(); })'],
    ['workflow run by reference', 'const w = createWorkflow({ a }); w.run(load)'],
    ['workflow with tracing off', 'const w = createWorkflow({ a }, { telemetry: false }); w.run(async ({ steps }) => steps.a())'],
    ['workflow run with tracing off', 'const w = createWorkflow({ a }); w.run(async ({ steps }) => steps.a(), { telemetry: false })'],
    ['workflow run with options it cannot read', 'const w = createWorkflow({ a }); w.run(async ({ steps }) => steps.a(), options)'],
    ['workflow with options it cannot read', 'const w = createWorkflow({ a }, options); w.run(async ({ steps }) => steps.a())'],
    ['workflow this file never runs', 'export const w = createWorkflow({ a })'],
    ['a parameter shadowing the import', 'function f(run) { run({ a }, async (s) => s.a()); }'],
    ['a local shadowing the import', 'function f() { const createWorkflow = make(); createWorkflow({ a }).run(async () => 1); }'],
    ['a run method on something else', 'db.run(async () => 1); client.run({ a }, async () => 1)'],
  ])('allows %s', (_label, code) => {
    expect(lint(code)).toEqual([]);
  });

  it.each([
    ['deps-first arrow', 'run({ a }, async (s) => s.a())', 'unnamedRun'],
    ['deps in a variable', 'run(deps, async (s) => s.a())', 'unnamedRun'],
    ['callback-only arrow', "run(async ({ step }) => step('a', a))", 'unnamedRun'],
    ['type parameters', "run<T, E>(async ({ step }) => step('a', a))", 'unnamedRun'],
    ['anonymous function', 'run({ a }, async function (s) { return s.a(); })', 'unnamedRun'],
    ['options without a name', 'run({ a }, async (s) => s.a(), { onEvent })', 'unnamedRun'],
    ['empty name', "run({ a }, async (s) => s.a(), { workflowName: '' })", 'unnamedRun'],
    ['wrapped callback', 'run({ a }, (async (s) => s.a()) as Callback)', 'unnamedRun'],
    ['tracing on through a const', 'const telemetry = true; run({ a }, async (s) => s.a(), { telemetry })', 'unnamedRun'],
    ['an empty name in a const', "const workflowName = ''; run({ a }, async (s) => s.a(), { workflowName })", 'unnamedRun'],
    ['undefined name', 'run({ a }, async (s) => s.a(), { workflowName: undefined })', 'unnamedRun'],
    ['deps-first workflow', 'const w = createWorkflow({ a }); w.run(async ({ steps }) => steps.a())', 'unnamedWorkflow'],
    ['deps in a const', 'const deps = { a }; const w = createWorkflow(deps); w.run(async ({ steps }) => steps.a())', 'unnamedWorkflow'],
    ['deps as const', 'const deps = { a } as const; createWorkflow(deps).run(async ({ steps }) => steps.a())', 'unnamedWorkflow'],
    ['run id, which names no span', "const w = createWorkflow({ a }); w.run('id-1', async ({ steps }) => steps.a())", 'unnamedWorkflow'],
    ['runWithState', 'const w = createWorkflow({ a }); w.runWithState(async ({ steps }) => steps.a())', 'unnamedWorkflow'],
    ['telemetry back on for one run', 'const w = createWorkflow({ a }, { telemetry: false }); w.run(async ({ steps }) => steps.a(), { telemetry: true })', 'unnamedWorkflow'],
    ['two runs, reported once', 'const w = createWorkflow({ a }); w.run(async ({ steps }) => steps.a()); w.run(async ({ steps }) => steps.a())', 'unnamedWorkflow'],
  ])('flags %s', (_label, code, messageId) => {
    expect(lint(code)).toEqual([messageId]);
  });

  it('follows an import alias and ignores run from elsewhere', () => {
    expect(lint('go({ a }, async (s) => s.a())', "import { run as go } from 'awaitly';")).toEqual(['unnamedRun']);
    expect(lint('run({ a }, async (s) => s.a())', "import { run } from 'other';")).toEqual([]);
    expect(lint('awaitly.run({ a }, async (s) => s.a())', "import * as awaitly from 'awaitly';")).toEqual(['unnamedRun']);
  });

  it('sees a call above a hoisted import', () => {
    expect(lint("import { run } from 'awaitly';", 'run({ a }, async (s) => s.a());')).toEqual(['unnamedRun']);
  });
});
