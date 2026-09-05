/**
 * The concurrency rules tell you to use step.all()/step.map() instead of
 * Promise.all(). That advice is only actionable where `step` exists — inside a
 * workflow callback. They reported every Promise.all in a linted file, so
 * ordinary application code (bootstrap, scripts, test setup) was flagged with a
 * fix the author could not apply.
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

const cases = [
  ['awaitly/concurrency-no-promise-all', 'Promise.all([a(), b()])'],
  ['awaitly/concurrency-no-promise-race', 'Promise.race([a(), b()])'],
  ['awaitly/concurrency-no-promise-allsettled', 'Promise.allSettled([a(), b()])'],
] as const;

describe('concurrency rules are scoped to workflows', () => {
  for (const [rule, call] of cases) {
    it(`${rule} flags it inside a workflow callback`, () => {
      const code = `run(deps, async ({ step, deps: d }) => { await ${call}; });`;
      expect(verify(code, rule)).toHaveLength(1);
    });

    it(`${rule} flags it inside an aliased workflow callback`, () => {
      const code = `run(deps, async ({ step: s, deps: d }) => { s('x', () => d.a()); await ${call}; });`;
      expect(verify(code, rule)).toHaveLength(1);
    });

    it(`${rule} leaves ordinary application code alone`, () => {
      const code = `async function bootstrap() { await ${call}; }`;
      expect(verify(code, rule)).toHaveLength(0);
    });

    it(`${rule} respects block shadowing and restores the outer binding`, () => {
      const code = `run(deps, async ({ step: execute }) => {
        { const execute = unrelated; await ${call}; }
        await ${call};
      });`;
      expect(verify(code, rule)).toHaveLength(1);
    });

    it(`${rule} recognizes a defaulted context binding`, () => {
      expect(verify(`run(deps, async ({ step: execute = fallback }) => { await ${call}; });`, rule)).toHaveLength(1);
    });
  }
});
