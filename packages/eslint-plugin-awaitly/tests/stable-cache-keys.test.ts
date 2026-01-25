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
  });
});
