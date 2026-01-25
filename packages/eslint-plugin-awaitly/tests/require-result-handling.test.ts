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
      'awaitly/require-result-handling': 'error',
    },
  },
];

describe('require-result-handling', () => {
  describe('valid cases', () => {
    it('allows .value access after .ok check in if statement', () => {
      const code = `
        const result = await run(async (step) => 42);
        if (result.ok) {
          console.log(result.value);
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .error access after !.ok check', () => {
      const code = `
        const result = await run(async (step) => 42);
        if (!result.ok) {
          console.log(result.error);
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .value in && expression', () => {
      const code = `
        const result = await run(async (step) => 42);
        const val = result.ok && result.value;
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .value in ternary when .ok is checked', () => {
      const code = `
        const result = await run(async (step) => 42);
        const val = result.ok ? result.value : 'default';
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .error in ternary alternate when .ok is checked', () => {
      const code = `
        const result = await run(async (step) => 42);
        const val = result.ok ? result.value : result.error;
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .error in ternary consequent when !.ok is checked', () => {
      const code = `
        const result = await run(async (step) => 42);
        const val = !result.ok ? result.error : result.value;
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .ok access without restriction', () => {
      const code = `
        const result = await run(async (step) => 42);
        console.log(result.ok);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('ignores non-Result variables', () => {
      const code = `
        const result = { value: 42, ok: true };
        console.log(result.value);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .value after early return on error', () => {
      const code = `
        function test() {
          const result = run((step) => 42);
          if (!result.ok) {
            return result;
          }
          console.log(result.value);
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .value after early return in else branch', () => {
      const code = `
        function test() {
          const result = run((step) => 42);
          if (result.ok) {
            console.log('ok');
          } else {
            return result;
          }
          console.log(result.value);
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows .value access in single-statement if branch', () => {
      const code = `
        const result = await run(async (step) => 42);
        if (result.ok) console.log(result.value);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports .value access without .ok check from run()', () => {
      const code = `
        const result = await run(async (step) => 42);
        console.log(result.value);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-result-handling');
      expect(messages[0].message).toContain('result');
      expect(messages[0].message).toContain('value');
    });

    it('reports .error access without .ok check', () => {
      const code = `
        const result = await run(async (step) => 42);
        console.log(result.error);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('error');
    });

    it('reports .value access without .ok check from step()', () => {
      const code = `
        const result = step(() => fetchUser());
        console.log(result.value);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports .value access without .ok check from step.retry()', () => {
      const code = `
        const result = await step.retry(() => fetchUser(), { attempts: 3 });
        console.log(result.value);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports multiple unsafe accesses', () => {
      const code = `
        const result = await run(async (step) => 42);
        console.log(result.value);
        console.log(result.error);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(2);
    });

    it('reports unsafe .value access in else branch after result.ok check', () => {
      const code = `
        const result = await run(async (step) => 42);
        if (result.ok) {
          console.log('ok');
        } else {
          console.log(result.value);
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('value');
    });

    it('reports unsafe .value access after if without early return', () => {
      const code = `
        const result = await run(async (step) => 42);
        if (result.ok) {
          console.log('ok');
        }
        console.log(result.value);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('value');
    });

    it('reports unsafe .value access when early return is conditional', () => {
      const code = `
        function test() {
          const result = run((step) => 42);
          if (!result.ok) {
            if (Math.random() > 0.5) {
              return result;
            }
          }
          console.log(result.value);
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('value');
    });

    it('reports unsafe .value access inside nested function in ok branch', () => {
      const code = `
        const result = await run(async (step) => 42);
        if (result.ok) {
          const getValue = () => result.value;
          console.log(getValue);
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('value');
    });
  });
});
