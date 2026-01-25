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
      'awaitly/no-immediate-execution': 'error',
    },
  },
];

describe('no-immediate-execution', () => {
  describe('valid cases', () => {
    it('allows thunk with arrow function', () => {
      const code = `step(() => fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows thunk with regular function', () => {
      const code = `step(function() { return fetchUser('1'); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows thunk with deps', () => {
      const code = `step(() => deps.fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows thunk with key option', () => {
      const code = `step(() => fetchUser('1'), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.retry with thunk', () => {
      const code = `step.retry(() => fetchUser('1'), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.withTimeout with thunk', () => {
      const code = `step.withTimeout(() => fetchUser('1'), { ms: 5000 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.try with thunk', () => {
      const code = `step.try(() => JSON.parse(str), { error: 'PARSE_ERROR' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports immediate execution', () => {
      const code = `step(fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/no-immediate-execution');
      expect(messages[0].message).toContain('fetchUser');
    });

    it('reports immediate execution with deps', () => {
      const code = `step(deps.fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('fetchUser');
    });

    it('reports immediate execution with key option', () => {
      const code = `step(fetchUser('1'), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports immediate execution with step.retry', () => {
      const code = `step.retry(fetchUser('1'), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports immediate execution with step.withTimeout', () => {
      const code = `step.withTimeout(slowOperation(), { ms: 5000 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });
  });

  describe('autofix', () => {
    it('wraps immediate execution in thunk', () => {
      const code = `step(fetchUser('1'));`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step(() => fetchUser('1'));`);
    });

    it('wraps deps call in thunk', () => {
      const code = `step(deps.fetchUser('1'));`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step(() => deps.fetchUser('1'));`);
    });

    it('wraps call with key option in thunk', () => {
      const code = `step(fetchUser('1'), { key: 'user:1' });`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step(() => fetchUser('1'), { key: 'user:1' });`);
    });
  });
});
