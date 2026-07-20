import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

const config = [
  {
    plugins: { awaitly: plugin },
    rules: { 'awaitly/workflow-prefer-step-if': 'error' },
  },
];

const verify = (code: string) => linter.verify(code, config);

describe('workflow-prefer-step-if', () => {
  describe('valid cases', () => {
    it('ignores a plain if with no steps inside', () => {
      const code = `
        async function f(x) {
          if (x > 0) { return 'positive'; }
          return 'other';
        }
      `;
      expect(verify(code)).toHaveLength(0);
    });

    it('ignores step.if usage', () => {
      const code = `
        async function wf({ step }) {
          await step.if('is-admin', () => user.role === 'admin', () =>
            step('grant', () => grant())
          );
        }
      `;
      // step.if itself contains a step call but is not an IfStatement.
      expect(verify(code)).toHaveLength(0);
    });

    it('ignores a guard around ordinary (non-step) code', () => {
      const code = `
        async function wf({ step }) {
          const user = await step('fetchUser', () => fetchUser());
          if (user.premium) { log('premium'); }
          return user;
        }
      `;
      expect(verify(code)).toHaveLength(0);
    });

    it('ignores unrelated callable parameters named step', () => {
      const code = `
        function calculate(step, enabled) {
          if (enabled) step(1);
        }
      `;
      expect(verify(code)).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('flags a raw if whose body contains a step', () => {
      const code = `
        async function wf({ step }) {
          if (premium) {
            await step('sendPremiumEmail', () => sendEmail());
          }
        }
      `;
      const messages = verify(code);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('preferStepIf');
    });

    it('flags a step in the else branch', () => {
      const code = `
        async function wf({ step }) {
          if (premium) { log('x'); }
          else { await step('freeTier', () => freeTier()); }
        }
      `;
      expect(verify(code)).toHaveLength(1);
    });

    it('recognizes an aliased workflow step binding', () => {
      const code = `
        async function wf({ step: runStep }) {
          if (premium) {
            await runStep('sendPremiumEmail', () => sendEmail());
          }
        }
      `;
      expect(verify(code)).toHaveLength(1);
    });

    it('reports an if/else-if ladder once, not per rung', () => {
      const code = `
        async function wf({ step }) {
          if (a) { await step('a', () => a()); }
          else if (b) { await step('b', () => b()); }
          else { await step('c', () => c()); }
        }
      `;
      expect(verify(code)).toHaveLength(1);
    });
  });
});
