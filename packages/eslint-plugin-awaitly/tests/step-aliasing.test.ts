/**
 * A rule must see the same bug whether the workflow callback destructures
 * `{ step }` or `{ step: s }` — the alias is ordinary usage, not a trick.
 *
 * Rules matched the literal name `step`, so renaming the binding silently
 * turned them off. Each case below is the same defect written twice.
 */

import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

function verify(code: string, rule: string): Linter.LintMessage[] {
  return linter.verify(code, [
    { plugins: { awaitly: plugin }, rules: { [rule]: 'error' } },
  ]);
}

/** The aliased form must report exactly what the canonical form reports. */
function expectSameAsCanonical(
  rule: string,
  canonical: string,
  aliased: string
): void {
  const canonicalMessages = verify(canonical, rule);
  expect(canonicalMessages.length).toBeGreaterThan(0);
  expect(verify(aliased, rule).length).toBe(canonicalMessages.length);
}

const wrap = (body: string, binding = 'step') =>
  `run(deps, async ({ step: ${binding}, deps: d }) => { ${body} });`;

describe('step aliasing', () => {
  it('checks helper IDs for arbitrary aliases', () => {
    expectSameAsCanonical(
      'awaitly/step-require-id',
      wrap(`step.sleep(1000);`),
      wrap(`execute.sleep(1000);`, 'execute')
    );
  });

  it.each(['execute', 's', 'runStep'])('ignores shadowed %s helper calls', alias => {
    expect(verify(wrap(`{ const ${alias} = { sleep: n => n }; ${alias}.sleep(1000); }`, alias), 'awaitly/step-require-id')).toEqual([]);
  });

  it.each([
    `const execute = n => n + 1; execute(42);`,
    `let execute = n => n + 1; execute(42);`,
    `function execute(n) { return n + 1; } execute(42);`,
    `try { throw (n => n); } catch (execute) { execute(42); }`,
    `for (const execute of [n => n]) { execute(42); }`,
    `const f = function execute() { execute(42); };`,
  ])('ignores locally shadowed step aliases: %s', body => {
    expect(verify(wrap(`{ ${body} }`, 'execute'), 'awaitly/step-require-id')).toEqual([]);
  });

  it('does not let sibling declarations hide a workflow alias', () => {
    expect(verify(wrap(`{ const execute = n => n; execute(42); } execute(() => load());`, 'execute'), 'awaitly/step-require-id')).toHaveLength(1);
  });

  it('ignores locally shadowed dependency aliases', () => {
    expect(verify(wrap(`{ const d = { load: async () => 42 }; await d.load(); }`), 'awaitly/step-no-bare-await')).toEqual([]);
  });

  it('recognizes defaulted and quoted context properties', () => {
    for (const binding of ['step: execute = fallback', '"step": execute', '["step"]: execute']) {
      expect(verify(`run(deps, async ({ ${binding} }) => { execute(() => load()); });`, 'awaitly/step-require-id')).toHaveLength(1);
    }
  });

  it('does not treat a dynamic property key as the step property', () => {
    expect(verify(`const step = 'other'; run(deps, async ({ [step]: execute }) => { execute(42); });`, 'awaitly/step-require-id')).toEqual([]);
  });

  it('preserves aliases and helper methods in immediate-execution fixes', () => {
    for (const callee of ['execute', 'execute.retry']) {
      const result = linter.verifyAndFix(wrap(`${callee}(load());`, 'execute'), [
        { plugins: { awaitly: plugin }, rules: { 'awaitly/step-no-immediate-execution': 'error' } },
      ]);
      expect(result.output).toBe(wrap(`${callee}('load', () => load());`, 'execute'));
      expect(result.messages).toEqual([]);
    }
  });

  it.each([
    ['load()', 'load', ''],
    ['result', 'step', 'const result = load();'],
    ['result.value', 'step', 'const result = load();'],
    ['results[0]', 'step', ''],
    ['42', 'step', ''],
  ])('preserves the callee and cache options when fixing %s', (executor, id, setup) => {
    for (const callee of ['execute', 'execute.retry']) {
      const result = linter.verifyAndFix(wrap(`${setup} ${callee}(${executor}, { key: 'k' });`, 'execute'), [
        { plugins: { awaitly: plugin }, rules: { 'awaitly/step-require-thunk-for-key': 'error' } },
      ]);
      expect(result.output).toBe(wrap(`${setup} ${callee}('${id}', () => ${executor}, { key: 'k' });`, 'execute'));
      expect(result.messages).toEqual([]);
    }
  });

  it.each([
    ['step-no-immediate-execution', `execute('load', load());`],
    ['step-require-thunk-for-key', `execute('load', load(), { key: 'k' });`],
    ['result-no-floating', `execute('load', () => load());`],
    ['step-stable-cache-keys', `execute('load', () => load(), { key: Date.now() });`],
    ['step-no-try-catch-wrap', `try { execute('load', () => load()); } catch (e) {}`],
    ['result-require-handling', `const r = execute('load', () => load()); console.log(r.value);`],
  ])('%s respects a shadowed alias', (rule, body) => {
    expect(verify(wrap(`{ const execute = unrelated; ${body} }`, 'execute'), `awaitly/${rule}`)).toEqual([]);
  });

  it('step-require-id', () => {
    expectSameAsCanonical(
      'awaitly/step-require-id',
      wrap(`step(() => d.load());`),
      wrap(`s(() => d.load());`, 's')
    );
  });

  it('step-no-immediate-execution', () => {
    expectSameAsCanonical(
      'awaitly/step-no-immediate-execution',
      wrap(`step('load', d.load());`),
      wrap(`s('load', d.load());`, 's')
    );
  });

  it('step-require-thunk-for-key', () => {
    expectSameAsCanonical(
      'awaitly/step-require-thunk-for-key',
      wrap(`step('load', d.load(), { key: 'k' });`),
      wrap(`s('load', d.load(), { key: 'k' });`, 's')
    );
  });

  it('result-no-floating', () => {
    expectSameAsCanonical(
      'awaitly/result-no-floating',
      wrap(`step('load', () => d.load());`),
      wrap(`s('load', () => d.load());`, 's')
    );
  });

  it('step-stable-cache-keys', () => {
    expectSameAsCanonical(
      'awaitly/step-stable-cache-keys',
      wrap(`const r = step('load', () => d.load(), { key: \`k-\${Date.now()}\` });`),
      wrap(`const r = s('load', () => d.load(), { key: \`k-\${Date.now()}\` });`, 's')
    );
  });

  it('step-no-try-catch-wrap', () => {
    expectSameAsCanonical(
      'awaitly/step-no-try-catch-wrap',
      wrap(`try { const r = await step('load', () => d.load()); } catch (e) {}`),
      wrap(`try { const r = await s('load', () => d.load()); } catch (e) {}`, 's')
    );
  });

  it('step-no-bare-await resolves an aliased deps binding', () => {
    expectSameAsCanonical(
      'awaitly/step-no-bare-await',
      `run(deps, async ({ step, deps }) => { await deps.load('x'); });`,
      `run(deps, async ({ step: s, deps: d }) => { await d.load('x'); });`
    );
  });

  it('result-require-handling', () => {
    // Reading .value without checking .ok — assigning alone is fine.
    expectSameAsCanonical(
      'awaitly/result-require-handling',
      wrap(`const r = step('load', () => d.load()); console.log(r.value);`),
      wrap(`const r = s('load', () => d.load()); console.log(r.value);`, 's')
    );
  });
});
