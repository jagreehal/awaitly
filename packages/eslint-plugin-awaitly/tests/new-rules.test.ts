import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

function verify(code: string, rules: Record<string, 'error' | 'warn'>) {
  return linter.verify(
    code,
    [
      {
        languageOptions: { parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
        plugins: { awaitly: plugin },
        rules,
      },
    ]
  );
}

describe('new slug rules', () => {
  describe('step-no-bare-await', () => {
    it('flags bare await deps.fn() outside step()', () => {
      const bad = `async function x({ step, deps }) { await deps.fetchUser('1'); }`;
      expect(verify(bad, { 'awaitly/step-no-bare-await': 'error' })).toHaveLength(1);
    });
    it('allows await on a step() that wraps deps.fn()', () => {
      const good = `async function x({ step, deps }) { await step('fetchUser', () => deps.fetchUser('1')); }`;
      expect(verify(good, { 'awaitly/step-no-bare-await': 'error' })).toHaveLength(0);
    });
  });

  describe('step-no-try-catch-wrap', () => {
    it('flags try/catch around step()', () => {
      const bad = `async function x({ step }) { try { await step('a', () => deps.fn()); } catch {} }`;
      expect(verify(bad, { 'awaitly/step-no-try-catch-wrap': 'error' })).toHaveLength(1);
    });
    it('does not flag try/catch with no step() inside', () => {
      const good = `async function x() { try { JSON.parse('{}'); } catch {} }`;
      expect(verify(good, { 'awaitly/step-no-try-catch-wrap': 'error' })).toHaveLength(0);
    });
  });

  describe('concurrency-no-promise-*', () => {
    // These rules say "use step.all()/step.map() instead", which is only
    // actionable inside a workflow callback, so that is where they fire.
    // See tests/concurrency-scope.test.ts for the out-of-workflow cases.
    const inWorkflow = (call: string) =>
      `run(async ({ step }) => { await ${call}; });`;

    it('flags Promise.all in a workflow', () => {
      expect(
        verify(inWorkflow('Promise.all([a(), b()])'), {
          'awaitly/concurrency-no-promise-all': 'error',
        })
      ).toHaveLength(1);
    });
    it('flags Promise.race in a workflow', () => {
      expect(
        verify(inWorkflow('Promise.race([a(), b()])'), {
          'awaitly/concurrency-no-promise-race': 'error',
        })
      ).toHaveLength(1);
    });
    it('flags Promise.allSettled in a workflow', () => {
      expect(
        verify(inWorkflow('Promise.allSettled([a(), b()])'), {
          'awaitly/concurrency-no-promise-allsettled': 'error',
        })
      ).toHaveLength(1);
    });
  });

  describe('result-no-manual-propagation (scoped to workflow callbacks)', () => {
    it('flags `return ok(...)` inside a workflow callback', () => {
      const bad = `workflow.run(async ({ step }) => { return ok({ id: 1 }); });`;
      expect(
        verify(bad, { 'awaitly/result-no-manual-propagation': 'error' })
      ).toHaveLength(1);
    });
    it('does not flag `return ok(...)` in a deps function', () => {
      const good = `async function fetchUser() { return ok({ id: 1 }); }`;
      expect(
        verify(good, { 'awaitly/result-no-manual-propagation': 'error' })
      ).toHaveLength(0);
    });
    it('does not flag `return ok(...)` from a step thunk', () => {
      const good = `workflow.run(async ({ step }) => { await step('a', () => ok(1)); return null; });`;
      expect(
        verify(good, { 'awaitly/result-no-manual-propagation': 'error' })
      ).toHaveLength(0);
    });
  });

  describe('result-no-direct-ok-err (scoped to workflow callbacks)', () => {
    it('flags ok() inside a workflow callback', () => {
      const bad = `workflow.run(async ({ step }) => { const a = ok(1); return a; });`;
      expect(
        verify(bad, { 'awaitly/result-no-direct-ok-err': 'error' })
      ).toHaveLength(1);
    });
    it('flags both ok() and err() inside a workflow callback', () => {
      const bad = `workflow.run(async ({ step }) => {
        if (cond) { return ok(1); }
        return err({ type: 'X' });
      });`;
      expect(
        verify(bad, { 'awaitly/result-no-direct-ok-err': 'error' })
      ).toHaveLength(2);
    });
    it('does not flag ok() inside a deps function', () => {
      const good = `async function fetchUser() { const a = ok(1); return a; }`;
      expect(
        verify(good, { 'awaitly/result-no-direct-ok-err': 'error' })
      ).toHaveLength(0);
    });
    it('does not flag ok() inside a step thunk', () => {
      const good = `workflow.run(async ({ step }) => { await step('a', () => ok(1)); });`;
      expect(
        verify(good, { 'awaitly/result-no-direct-ok-err': 'error' })
      ).toHaveLength(0);
    });
  });

  describe('workflow-no-callable-form', () => {
    it.each(['"step": execute', '["step"]: execute', 'step: execute = fallback'])('detects static binding %s', binding => {
      expect(verify(`workflow(async ({ ${binding} } = {}) => {});`, { 'awaitly/workflow-no-callable-form': 'error' })).toHaveLength(1);
    });
    it('ignores a dynamic property named step', () => {
      expect(verify(`consume(({ [step]: value }) => value);`, { 'awaitly/workflow-no-callable-form': 'error' })).toHaveLength(0);
    });
    it('flags workflow(callback) where the callback destructures step', () => {
      const bad = `workflow(async ({ step }) => { await step('a', () => deps.fn()); });`;
      expect(
        verify(bad, { 'awaitly/workflow-no-callable-form': 'error' })
      ).toHaveLength(1);
    });
    it('does not flag setTimeout-style identifier calls', () => {
      const good = `setTimeout(() => { console.log('hi'); }, 1000);`;
      expect(
        verify(good, { 'awaitly/workflow-no-callable-form': 'error' })
      ).toHaveLength(0);
    });
    it('does not flag describe/it/test patterns', () => {
      const good = `describe('x', () => { it('y', () => {}); });`;
      expect(
        verify(good, { 'awaitly/workflow-no-callable-form': 'error' })
      ).toHaveLength(0);
    });
    it('does not flag run(callback) — that is the supported entry point', () => {
      const good = `run(async ({ step }) => { await step('a', () => deps.fn()); });`;
      expect(
        verify(good, { 'awaitly/workflow-no-callable-form': 'error' })
      ).toHaveLength(0);
    });
  });

  describe('workflow-callback-shape', () => {
    it.each(['"step": execute', '["step"]: execute', 'step: execute = fallback'])('accepts static context binding %s', binding => {
      expect(verify(`run(async ({ ${binding} } = {}) => {});`, { 'awaitly/workflow-callback-shape': 'error' })).toHaveLength(0);
    });
    it('rejects a dynamic context key named step', () => {
      expect(verify(`run(async ({ [step]: execute }) => {});`, { 'awaitly/workflow-callback-shape': 'error' })).toHaveLength(1);
    });
    it('ignores a dynamically selected method named run', () => {
      expect(verify(`obj[run](async (value) => value);`, { 'awaitly/workflow-callback-shape': 'error' })).toHaveLength(0);
    });
    it('checks a statically quoted run method', () => {
      expect(verify(`wf['run'](async (ctx) => ctx);`, { 'awaitly/workflow-callback-shape': 'error' })).toHaveLength(1);
    });

    it('flags non-destructured single param', () => {
      const bad = `workflow.run(async (ctx) => { return ctx; });`;
      expect(
        verify(bad, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(1);
    });
    it('accepts ({ step })', () => {
      const good = `workflow.run(async ({ step }) => { });`;
      expect(
        verify(good, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(0);
    });
    it('accepts ({ step, deps })', () => {
      const good = `workflow.run(async ({ step, deps }) => { });`;
      expect(
        verify(good, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(0);
    });
    it('accepts ({ step, deps, ctx })', () => {
      const good = `workflow.run(async ({ step, deps, ctx }) => ctx);`;
      expect(
        verify(good, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(0);
    });
    it('flags a non-destructured context in callback-only run()', () => {
      const bad = `run(async (ctx) => ctx);`;
      expect(
        verify(bad, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(1);
    });
    it('accepts deps-first run(deps, (s) => ...) - the first param is the steps object', () => {
      const good = `run({ getUser }, async (s) => s.getUser('1'));`;
      expect(
        verify(good, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(0);
    });
    it('accepts deps-first run(deps, (s, { step }) => ...)', () => {
      const good = `run({ getUser }, async (s, { step }) => step('x', () => s.getUser('1')));`;
      expect(
        verify(good, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(0);
    });
    it('flags deps-first run() whose context param is not destructured', () => {
      const bad = `run({ getUser }, async (s, ctx) => ctx);`;
      expect(
        verify(bad, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(1);
    });
    it('still requires durable.run(deps, fn) to destructure its context', () => {
      expect(
        verify(`durable.run({ a }, async ({ step, deps }) => {});`, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(0);
      expect(
        verify(`durable.run({ a }, async (ctx) => ctx);`, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(1);
    });
    it('ignores curried calls that are not workflows, like it.each(rows)(name, fn)', () => {
      const good = [
        `it.each(rows)('parses $name', ({ body }) => {});`,
        `describe.skipIf(!uri)('mongo', () => {});`,
        `it.skipIf(!exists)('reads the pdf', async () => {});`,
      ].join('\n');
      expect(
        verify(good, { 'awaitly/workflow-callback-shape': 'error' })
      ).toHaveLength(0);
    });
  });

  describe('error-check-unexpected-first', () => {
    it('flags result.error._tag check without an isUnexpectedError guard', () => {
      const bad = `if (result.error._tag === 'X') {}`;
      expect(
        verify(bad, { 'awaitly/error-check-unexpected-first': 'warn' })
      ).toHaveLength(1);
    });
    it('flags result.error.type check without a guard', () => {
      const bad = `if (result.error.type === 'X') {}`;
      expect(
        verify(bad, { 'awaitly/error-check-unexpected-first': 'warn' })
      ).toHaveLength(1);
    });
    it('accepts a check guarded by isUnexpectedError', () => {
      const good = `if (isUnexpectedError(result.error) || result.error._tag === 'X') {}`;
      expect(
        verify(good, { 'awaitly/error-check-unexpected-first': 'warn' })
      ).toHaveLength(0);
    });
    it('does not flag unrelated _tag access (not on result.error)', () => {
      const good = `if (someOtherShape._tag === 'X') {}`;
      expect(
        verify(good, { 'awaitly/error-check-unexpected-first': 'warn' })
      ).toHaveLength(0);
    });
  });
});
