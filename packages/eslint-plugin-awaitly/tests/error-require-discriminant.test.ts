import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

// Error classes are written in TypeScript, with `readonly` modifiers and
// type-only declarations espree cannot parse. Linting them through the
// TypeScript parser is the only way this rule gets tested on real input.
const config = [
  {
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: {
      awaitly: plugin,
    },
    rules: {
      'awaitly/error-require-discriminant': 'error',
    },
  },
];

/**
 * TypeScript compares types by structure. Two error classes that add nothing
 * to `Error` are the same type, so a union of them collapses to one and an
 * error disappears from the signature without anything failing to compile.
 */
describe('error-require-discriminant', () => {
  describe('valid cases', () => {
    it('allows a class carrying a literal type', () => {
      const code = `class NotFoundError extends Error {
        readonly type = 'NotFoundError';
      }`;
      expect(linter.verify(code, config)).toHaveLength(0);
    });

    it('allows a class carrying the deprecated _tag', () => {
      const code = `class NotFoundError extends Error {
        readonly _tag = 'NotFoundError';
      }`;
      expect(linter.verify(code, config)).toHaveLength(0);
    });

    it('allows a class built by the TaggedError factory', () => {
      const code = `class NotFoundError extends TaggedError('NotFoundError')<{ id: string }> {}`;
      expect(linter.verify(code, config)).toHaveLength(0);
    });

    it('allows an explicit literal type annotation', () => {
      const code = `class NotFoundError extends Error {
        readonly type: 'NotFoundError';
      }`;
      expect(linter.verify(code, config)).toHaveLength(0);
    });

    it('allows a const assertion', () => {
      const code = `class NotFoundError extends Error {
        type = 'NotFoundError' as const;
      }`;
      expect(linter.verify(code, config)).toHaveLength(0);
    });

    it('allows a getter with a literal return type', () => {
      const code = `class NotFoundError extends Error {
        get type(): 'NotFoundError' { return 'NotFoundError'; }
      }`;
      expect(linter.verify(code, config)).toHaveLength(0);
    });

    it('ignores classes that are not errors', () => {
      const code = `class UserRepository extends BaseRepository {}`;
      expect(linter.verify(code, config)).toHaveLength(0);
    });

    it('ignores a class extending nothing', () => {
      const code = `class Plain {}`;
      expect(linter.verify(code, config)).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports a bare error class', () => {
      const code = `class NotFoundError extends Error {}`;
      const messages = linter.verify(code, config);

      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('NotFoundError');
    });

    it('reports a class that only adds data', () => {
      const code = `class NotFoundError extends Error {
        readonly id: string;
        constructor(id: string) { super('missing ' + id); this.id = id; }
      }`;
      expect(linter.verify(code, config)).toHaveLength(1);
    });

    it('reports a non-literal discriminant annotation', () => {
      const code = `class NotFoundError extends Error {
        readonly type: string = 'NotFoundError';
      }`;
      expect(linter.verify(code, config)).toHaveLength(1);
    });

    it('reports a mutable property whose inferred type widens to string', () => {
      const code = `class NotFoundError extends Error {
        type = 'NotFoundError';
      }`;
      expect(linter.verify(code, config)).toHaveLength(1);
    });

    it('reports a constructor-only assignment', () => {
      const code = `class NotFoundError extends Error {
        constructor() { super(); this.type = 'NotFoundError'; }
      }`;
      expect(linter.verify(code, config)).toHaveLength(1);
    });

    it('reports a static discriminant because instances do not carry it', () => {
      const code = `class NotFoundError extends Error {
        static readonly type = 'NotFoundError';
      }`;
      expect(linter.verify(code, config)).toHaveLength(1);
    });

    it('reports each colliding class so the pair is visible', () => {
      const code = `class FirstError extends Error {}
        class SecondError extends Error {}`;
      expect(linter.verify(code, config)).toHaveLength(2);
    });

    it('reports a class expression assigned to a name', () => {
      const code = `const NotFoundError = class extends Error {};`;
      expect(linter.verify(code, config)).toHaveLength(1);
    });
  });
});
