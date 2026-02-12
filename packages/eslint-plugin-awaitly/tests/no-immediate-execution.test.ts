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
    it('allows step with id and thunk (arrow function)', () => {
      const code = `step('fetchUser', () => fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step with id and regular function', () => {
      const code = `step('fetchUser', function() { return fetchUser('1'); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step with id and deps thunk', () => {
      const code = `step('fetchUser', () => deps.fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step with id, thunk and key option', () => {
      const code = `step('fetchUser', () => fetchUser('1'), { key: 'user:1' });`;
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

    it('allows step.run with getter (thunk)', () => {
      const code = `step.run('fetchUser', () => fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.retry with id and thunk', () => {
      const code = `step.retry('fetchData', () => fetchData(), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports immediate execution (legacy step(fn()))', () => {
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

    it('reports immediate execution with id but no thunk', () => {
      const code = `step('fetchUser', fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/no-immediate-execution');
    });

    it('reports immediate execution with id and key option', () => {
      const code = `step('fetchUser', fetchUser('1'), { key: 'user:1' });`;
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

    it('reports immediate execution with step.run (second arg)', () => {
      const code = `step.run('fetchUser', fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/no-immediate-execution');
      expect(messages[0].message).toContain('fetchUser');
    });

    it('reports immediate execution with step.retry id-first and immediate second arg', () => {
      const code = `step.retry('fetchData', fetchData(), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });
  });

  describe('autofix', () => {
    it('wraps legacy immediate execution in thunk and adds id', () => {
      const code = `step(fetchUser('1'));`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step('fetchUser', () => fetchUser('1'));`);
    });

    it('wraps legacy deps call in thunk and adds id', () => {
      const code = `step(deps.fetchUser('1'));`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step('fetchUser', () => deps.fetchUser('1'));`);
    });

    it('wraps immediate execution when id present', () => {
      const code = `step('fetchUser', fetchUser('1'));`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step('fetchUser', () => fetchUser('1'));`);
    });

    it('wraps call with key option in thunk and adds id', () => {
      const code = `step(fetchUser('1'), { key: 'user:1' });`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step('fetchUser', () => fetchUser('1'), { key: 'user:1' });`);
    });

    it('wraps step.run second arg in thunk', () => {
      const code = `step.run('fetchUser', fetchUser('1'));`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step.run('fetchUser', () => fetchUser('1'));`);
    });
  });
});
