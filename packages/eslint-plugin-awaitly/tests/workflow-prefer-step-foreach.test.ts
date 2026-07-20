import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

const config = [
  {
    plugins: { awaitly: plugin },
    rules: { 'awaitly/workflow-prefer-step-foreach': 'error' },
  },
];

const verify = (code: string) => linter.verify(code, config);

describe('workflow-prefer-step-foreach', () => {
  describe('valid cases', () => {
    it('ignores a loop with no steps inside', () => {
      const code = `
        function f(items) {
          for (const item of items) { total += item; }
        }
      `;
      expect(verify(code)).toHaveLength(0);
    });

    it('ignores step.forEach usage', () => {
      const code = `
        async function wf({ step }) {
          await step.forEach('process', items, {
            stepIdPattern: 'item-{i}',
            run: (item) => step('processItem', () => process(item)),
          });
        }
      `;
      expect(verify(code)).toHaveLength(0);
    });

    it('ignores a .map that does not run steps', () => {
      const code = `const ids = users.map((u) => u.id);`;
      expect(verify(code)).toHaveLength(0);
    });

    it('ignores unrelated callable parameters named step', () => {
      const code = `
        function process(step, items) {
          for (const item of items) step(item);
        }
      `;
      expect(verify(code)).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('flags a for-of loop containing a step', () => {
      const code = `
        async function wf({ step }) {
          for (const item of items) {
            await step('processItem', () => process(item));
          }
        }
      `;
      const messages = verify(code);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('preferStepForEach');
    });

    it('flags a classic for loop containing a step', () => {
      const code = `
        async function wf({ step }) {
          for (let i = 0; i < items.length; i++) {
            await step('processItem', () => process(items[i]));
          }
        }
      `;
      expect(verify(code)).toHaveLength(1);
    });

    it('flags a while loop containing a step', () => {
      const code = `
        async function wf({ step }) {
          while (hasNext()) {
            await step('processNext', () => processNext());
          }
        }
      `;
      expect(verify(code)).toHaveLength(1);
    });

    it('flags arr.forEach whose callback runs a step', () => {
      const code = `
        async function wf({ step }) {
          items.forEach((item) => {
            step('processItem', () => process(item));
          });
        }
      `;
      expect(verify(code)).toHaveLength(1);
    });

    it('recognizes an aliased workflow step binding', () => {
      const code = `
        async function wf({ step: runStep }) {
          for (const item of items) {
            await runStep('processItem', () => process(item));
          }
        }
      `;
      expect(verify(code)).toHaveLength(1);
    });
  });
});
