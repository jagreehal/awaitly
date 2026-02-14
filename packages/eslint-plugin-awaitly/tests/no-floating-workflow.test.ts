import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

const config = [
  {
    plugins: {
      awaitly: plugin,
    },
    rules: {
      'awaitly/no-floating-workflow': 'error',
    },
  },
];

describe('no-floating-workflow', () => {
  describe('valid cases', () => {
    it('allows awaited run()', () => {
      const code = `await run(async ({ step }) => { return 42; });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows assigned run()', () => {
      const code = `const result = run(async ({ step }) => { return 42; });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows returned run()', () => {
      const code = `function test() { return run(async ({ step }) => { return 42; }); }`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows chained run()', () => {
      const code = `run(async ({ step }) => { return 42; }).then(r => console.log(r));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows run() in array', () => {
      const code = `Promise.all([run(async ({ step }) => 1), run(async ({ step }) => 2)]);`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows run() in conditional', () => {
      const code = `const result = condition ? run(async ({ step }) => 1) : run(async ({ step }) => 2);`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows arrow function implicit return', () => {
      const code = `const fn = () => run(async ({ step }) => 42);`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('ignores non-workflow run functions', () => {
      const code = `run();`; // No callback, not a workflow pattern
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports floating run()', () => {
      const code = `run(async ({ step }) => { return 42; });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/no-floating-workflow');
      expect(messages[0].message).toContain('run');
    });

    it('reports floating run() with sync callback', () => {
      const code = `run(({ step }) => { return 42; });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports floating run() with function expression', () => {
      const code = `run(function({ step }) { return 42; });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports multiple floating runs', () => {
      const code = `
        run(async ({ step }) => 1);
        run(async ({ step }) => 2);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(2);
    });
  });
});
