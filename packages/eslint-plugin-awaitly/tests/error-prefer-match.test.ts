import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

const config = [
  {
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { awaitly: plugin },
    rules: { 'awaitly/error-prefer-match': 'error' },
  },
];

const lint = (code: string) => linter.verify(code, config);

/**
 * Hand-normalising `result.error` (typeof + ternary, or `switch (true)`)
 * reimplements what `match` already does, without the exhaustiveness check.
 */
describe('error-prefer-match', () => {
  describe('valid cases', () => {
    it('allows match on the result', () => {
      expect(
        lint(`match(result, {
          ok: (v) => v,
          NOT_FOUND: () => 404,
          ValidationError: (e) => e.field,
          UnexpectedError: () => 500,
        });`),
      ).toHaveLength(0);
    });

    it('allows matchError on the error', () => {
      expect(
        lint(`matchError(result.error, { NOT_FOUND: () => 404, UnexpectedError: () => 500 });`),
      ).toHaveLength(0);
    });

    it('allows a plain switch on result.error (all-string unions)', () => {
      expect(
        lint(`switch (result.error) {
          case 'NOT_FOUND': return 404;
          case 'ORDER_FAILED': return 400;
        }`),
      ).toHaveLength(0);
    });

    it('allows a plain switch on result.error.type', () => {
      expect(
        lint(`switch (result.error.type) {
          case 'NOT_FOUND': return 404;
        }`),
      ).toHaveLength(0);
    });

    it('allows isUnexpectedError guard', () => {
      expect(
        lint(`if (isUnexpectedError(result.error)) { console.error(result.error.cause); }`),
      ).toHaveLength(0);
    });

    it('allows typeof on something other than .error', () => {
      expect(lint(`if (typeof input === 'string') { parse(input); }`)).toHaveLength(0);
      expect(lint(`if (typeof result.value === 'string') { parse(result.value); }`)).toHaveLength(0);
    });

    it('allows typeof result.error compared to a non-string type', () => {
      // Checking for an object is not the normalise-then-switch pattern.
      expect(lint(`if (typeof result.error === 'object') { log(result.error); }`)).toHaveLength(0);
    });

    it('allows switch (true) that never touches result.error', () => {
      expect(
        lint(`switch (true) {
          case count > 10: return 'many';
          case count > 0: return 'some';
          default: return 'none';
        }`),
      ).toHaveLength(0);
    });

    it('allows switch on a non-true literal', () => {
      expect(
        lint(`switch (false) {
          case result.error === 'X': return 1;
        }`),
      ).toHaveLength(0);
    });

    it('allows typeof on a caught exception (not a Result)', () => {
      expect(
        lint(`try { f(); } catch (error) { if (typeof error === 'string') log(error); }`),
      ).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('flags the typeof-ternary normalisation', () => {
      const messages = lint(
        `const code = typeof result.error === 'string' ? result.error : result.error.type;`,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/error-prefer-match');
      expect(messages[0].message).toContain('match(result');
    });

    it('flags typeof result.error !== "string"', () => {
      expect(lint(`if (typeof result.error !== 'string') { log(result.error.type); }`)).toHaveLength(1);
    });

    it('flags loose equality', () => {
      expect(lint(`if (typeof result.error == 'string') {}`)).toHaveLength(1);
      expect(lint(`if (typeof result.error != 'string') {}`)).toHaveLength(1);
    });

    it('flags the yoda operand order', () => {
      expect(lint(`if ('string' === typeof result.error) {}`)).toHaveLength(1);
    });

    it('flags typeof on any expression ending in .error', () => {
      expect(lint(`if (typeof outcome.error === 'string') {}`)).toHaveLength(1);
      expect(lint(`if (typeof this.state.result.error === 'string') {}`)).toHaveLength(1);
    });

    it('flags switch (true) whose cases test result.error', () => {
      const messages = lint(`switch (true) {
        case typeof result.error === 'string': return 400;
        case result.error instanceof ValidationError: return 422;
        default: return 500;
      }`);
      // switch(true) itself, plus the typeof case inside it
      expect(messages).toHaveLength(2);
      expect(messages.every((m) => m.ruleId === 'awaitly/error-prefer-match')).toBe(true);
    });

    it('flags switch (true) that only uses instanceof on result.error', () => {
      const messages = lint(`switch (true) {
        case result.error instanceof ValidationError: return 422;
        case result.error instanceof NotFoundError: return 404;
      }`);
      expect(messages).toHaveLength(1);
      expect(messages[0].line).toBe(1);
    });

    it('flags switch (true) when result.error is nested deeper in a case test', () => {
      expect(
        lint(`switch (true) {
          case isUnexpectedError(result.error): return 500;
          default: return 400;
        }`),
      ).toHaveLength(1);
    });

    it('flags the pattern inside a boundary handler', () => {
      const messages = lint(`export async function handler(req) {
        const result = await workflow.run(req.body);
        if (!result.ok) {
          if (isUnexpectedError(result.error)) return { status: 500 };
          const code = typeof result.error === 'string' ? result.error : result.error.type;
          switch (code) {
            case 'NOT_FOUND': return { status: 404 };
          }
        }
        return { status: 200, body: result.value };
      }`);
      expect(messages).toHaveLength(1);
      expect(messages[0].line).toBe(5);
    });
  });
});
