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
      'awaitly/no-floating-result': 'error',
    },
  },
];

describe('no-floating-result', () => {
  describe('valid cases', () => {
    it('allows assigned step()', () => {
      const code = `const result = step(() => fetchUser());`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows awaited and assigned step()', () => {
      const code = `const result = await step(() => fetchUser());`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows returned step()', () => {
      const code = `function test() { return step(() => fetchUser()); }`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step() in array', () => {
      const code = `[step(() => fetch1()), step(() => fetch2())];`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.retry with assignment', () => {
      const code = `const result = step.retry(() => fetchUser(), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.withTimeout with assignment', () => {
      const code = `const result = step.withTimeout(() => fetchUser(), { ms: 5000 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.parallel with assignment', () => {
      const code = `const results = await step.parallel('Fetch', { a: () => fetch1(), b: () => fetch2() });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.run with assignment', () => {
      const code = `const user = await step.run('fetchUser', () => fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.all with assignment', () => {
      const code = `const data = await step.all('fetchAll', { user: () => fetchUser('1'), posts: () => fetchPosts('1') });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.map with assignment', () => {
      const code = `const users = await step.map('fetchUsers', ['1', '2'], (id) => fetchUser(id));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows chained step()', () => {
      const code = `step(() => fetchUser()).value;`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows arrow function implicit return', () => {
      const code = `const fn = () => step(() => fetchUser());`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports floating step()', () => {
      const code = `step(() => fetchUser());`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/no-floating-result');
      expect(messages[0].message).toContain('step');
    });

    it('reports floating awaited step()', () => {
      const code = `await step(() => fetchUser());`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports floating step.retry()', () => {
      const code = `step.retry(() => fetchUser(), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('step.retry');
    });

    it('reports floating step.withTimeout()', () => {
      const code = `step.withTimeout(() => fetchUser(), { ms: 5000 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('step.withTimeout');
    });

    it('reports floating step.parallel()', () => {
      const code = `step.parallel('Fetch', { a: () => fetch1(), b: () => fetch2() });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('step.parallel');
    });

    it('reports floating step.run()', () => {
      const code = `step.run('fetchUser', () => fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('step.run');
    });

    it('reports floating step.all()', () => {
      const code = `step.all('fetchAll', { user: () => fetchUser('1') });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('step.all');
    });

    it('reports floating step.map()', () => {
      const code = `step.map('fetchUsers', ['1', '2'], (id) => fetchUser(id));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('step.map');
    });

    it('reports multiple floating steps', () => {
      const code = `
        step(() => fetch1());
        step(() => fetch2());
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(2);
    });
  });
});
