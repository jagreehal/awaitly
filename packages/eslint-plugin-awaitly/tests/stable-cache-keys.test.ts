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
      'awaitly/stable-cache-keys': 'error',
    },
  },
];

describe('stable-cache-keys', () => {
  describe('valid cases', () => {
    it('allows stable string key', () => {
      const code = `step(() => fetchUser(id), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows template literal with stable variable', () => {
      const code = `step(() => fetchUser(id), { key: \`user:\${userId}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows idempotency key pattern', () => {
      const code = `step(() => charge(amount), { key: \`charge:\${idempotencyKey}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step without key option', () => {
      const code = `step(() => fetchUser(id));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports Date.now() in key', () => {
      const code = `step(() => fetchUser(id), { key: \`user:\${Date.now()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/stable-cache-keys');
      expect(messages[0].message).toContain('Date.now');
    });

    it('reports Math.random() in key', () => {
      const code = `step(() => fetchUser(id), { key: \`user:\${Math.random()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('Math.random');
    });

    it('reports crypto.randomUUID() in key', () => {
      const code = `step(() => fetchUser(id), { key: \`user:\${crypto.randomUUID()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('crypto.randomUUID');
    });

    it('reports uuid() call in key', () => {
      const code = `step(() => fetchUser(id), { key: \`user:\${uuid()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('uuid');
    });

    it('reports nanoid() call in key', () => {
      const code = `step(() => fetchUser(id), { key: \`user:\${nanoid()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('nanoid');
    });

    it('reports Date.now() in step.run key', () => {
      const code = `step.run('fetchUser', () => fetchUser(id), { key: \`user:\${Date.now()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('Date.now');
    });

    it('reports Math.random() in step.andThen key', () => {
      const code = `step.andThen('enrich', user, (u) => enrichUser(u), { key: \`enrich:\${Math.random()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('Math.random');
    });

    it('reports Date.now() in step.match key', () => {
      const code = `step.match('handle', result, { ok: (v) => v, err: (e) => e }, { key: \`handle:\${Date.now()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('Date.now');
    });

    it('reports Math.random() in step.map key', () => {
      const code = `step.map('fetchUsers', userIds, (id) => fetchUser(id), { key: \`users:\${Math.random()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('Math.random');
    });

    it('reports Date.now() in step.all key', () => {
      const code = `step.all('fetchAll', { a: () => fetchA(), b: () => fetchB() }, { key: \`all:\${Date.now()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('Date.now');
    });

    it('reports uuid() in step.allSettled key', () => {
      const code = `step.allSettled('fetchAll', () => allSettledAsync([fetchA(), fetchB()]), { key: \`all:\${uuid()}\` });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('uuid');
    });
  });
});
