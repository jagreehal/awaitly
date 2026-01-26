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
      'awaitly/require-thunk-for-key': 'error',
    },
  },
];

describe('require-thunk-for-key', () => {
  describe('valid cases', () => {
    it('allows thunk with key option', () => {
      const code = `step(() => fetchUser('1'), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows function identifier as thunk with key option', () => {
      const code = `step(fetchUser, { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows member function identifier as thunk with key option', () => {
      const code = `step(deps.fetchUser, { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows member function identifier when base object is precomputed', () => {
      const code = `
        const deps = getDeps();
        step(deps.fetchUser, { key: 'user:1' });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows destructured function reference from precomputed object', () => {
      const code = `
        const { fetchUser } = getDeps();
        step(fetchUser, { key: 'user:1' });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows member function identifier on precomputed object with non-utility name', () => {
      const code = `
        const repo = createRepo();
        step(repo.fetchUser, { key: 'user:1' });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows member function identifier on precomputed object with unusual name', () => {
      const code = `
        const userApi = createUserApi();
        step(userApi.fetchUser, { key: 'user:1' });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows shadowed identifier not tied to precomputed value', () => {
      const code = `
        const result = fetchUser('1');
        function run(result) {
          step(result, { key: 'user:1' });
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows reassigned identifier when overwritten with function reference', () => {
      const code = `
        let result = fetchUser('1');
        result = fetchUser;
        step(result, { key: 'user:1' });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows thunk with key and name options', () => {
      const code = `step(() => fetchUser('1'), { key: 'user:1', name: 'fetchUser' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows immediate execution WITHOUT key option (no caching)', () => {
      const code = `step(fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows immediate execution with name but no key', () => {
      const code = `step(fetchUser('1'), { name: 'fetchUser' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.retry with thunk and key', () => {
      const code = `step.retry(() => fetchUser('1'), { attempts: 3, key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.withTimeout with thunk and key', () => {
      const code = `step.withTimeout(() => slowOp(), { ms: 5000, key: 'slow:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.try with thunk and key', () => {
      const code = `step.try(() => JSON.parse(str), { error: 'PARSE_ERROR', key: 'parse:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.fromResult with thunk and key', () => {
      const code = `step.fromResult(() => validate(input), { error: 'INVALID', key: 'validate:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports immediate execution with key option', () => {
      const code = `step(fetchUser('1'), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-thunk-for-key');
      expect(messages[0].message).toContain('thunk');
      expect(messages[0].message).toContain('cache');
    });

    it('reports immediate execution with key and name options', () => {
      const code = `step(fetchUser('1'), { key: 'user:1', name: 'fetchUser' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports immediate execution with deps and key', () => {
      const code = `step(deps.fetchUser('1'), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports immediate execution with step.retry and key', () => {
      const code = `step.retry(fetchUser('1'), { attempts: 3, key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports immediate execution with step.withTimeout and key', () => {
      const code = `step.withTimeout(slowOp(), { ms: 5000, key: 'slow:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports immediate execution with step.try and key', () => {
      const code = `step.try(JSON.parse(str), { error: 'PARSE_ERROR', key: 'parse:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports immediate execution with step.fromResult and key', () => {
      const code = `step.fromResult(validate(input), { error: 'INVALID', key: 'validate:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports non-thunk identifier with key option', () => {
      const code = `const result = fetchUser('1'); step(result, { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports reassigned identifier with key option', () => {
      const code = `let result; result = fetchUser('1'); step(result, { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports precomputed identifier referenced from inner scope', () => {
      const code = `
        const result = fetchUser('1');
        function run() {
          step(result, { key: 'user:1' });
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports member expression with key option', () => {
      const code = `const result = fetchUser('1'); step(result.value, { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports member expression on utility-named object when property is data', () => {
      const code = `
        const deps = fetchUser('1');
        step(deps.id, { key: 'user:1' });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports member expression from zero-arg call with key option', () => {
      const code = `const result = fetchUser(); step(result.value, { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports array element access with key option', () => {
      const code = `const result = fetchUser('1'); step(result[0], { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports destructured precomputed value with key option', () => {
      const code = `const { user } = fetchUser('1'); step(user, { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports computed member access with key option', () => {
      const code = `const result = fetchUser('1'); step(result['value'], { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports nested computed member access with key option', () => {
      const code = `const result = fetchUser('1'); step(result.meta['value'], { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

  });

  describe('autofix', () => {
    it('wraps immediate execution in thunk when key is present', () => {
      const code = `step(fetchUser('1'), { key: 'user:1' });`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step(() => fetchUser('1'), { key: 'user:1' });`);
    });

    it('wraps deps call in thunk when key is present', () => {
      const code = `step(deps.fetchUser('1'), { key: 'user:1' });`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step(() => deps.fetchUser('1'), { key: 'user:1' });`);
    });

    it('wraps complex call in thunk when key is present', () => {
      const code = `step(api.users.fetch(id), { key: \`user:\${id}\` });`;
      const result = linter.verifyAndFix(code, config);
      expect(result.output).toBe(`step(() => api.users.fetch(id), { key: \`user:\${id}\` });`);
    });
  });

  describe('error message clarity', () => {
    it('explains that cache will still be populated', () => {
      const code = `step(fetchUser('1'), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      // The message should clarify that cache IS populated but execution happens regardless
      expect(messages[0].message).toContain('cache will still be populated');
    });

    it('explains that step_complete events will fire', () => {
      const code = `step(fetchUser('1'), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('step_complete');
    });
  });
});
