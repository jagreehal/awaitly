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
    it(`${rule} sees the second context parameter in deps-first run`, () => {
      expect(verify(`run({ load }, async (s, { step: execute }) => { await ${call}; });`, rule)).toHaveLength(1);
    });
    it(`${rule} does not confuse a dependency named step with context`, () => {
      expect(verify(`run({ step: load }, async ({ step: execute }) => { await ${call}; });`, rule)).toHaveLength(0);
    });
    it(`${rule} flags it inside a workflow callback`, () => {
      const code = `run(async ({ step, deps: d }) => { await ${call}; });`;
      expect(verify(code, rule)).toHaveLength(1);
    });

    it(`${rule} flags it inside an aliased workflow callback`, () => {
      const code = `run(async ({ step: s, deps: d }) => { s('x', () => d.a()); await ${call}; });`;
      expect(verify(code, rule)).toHaveLength(1);
    });

    it(`${rule} leaves ordinary application code alone`, () => {
      const code = `async function bootstrap() { await ${call}; }`;
      expect(verify(code, rule)).toHaveLength(0);
    });

    it(`${rule} respects block shadowing and restores the outer binding`, () => {
      const code = `run(async ({ step: execute }) => {
        { const execute = unrelated; await ${call}; }
        await ${call};
      });`;
      expect(verify(code, rule)).toHaveLength(1);
    });

    it(`${rule} recognizes a defaulted context binding`, () => {
      expect(verify(`run(async ({ step: execute = fallback }) => { await ${call}; });`, rule)).toHaveLength(1);
    });
  }
});
