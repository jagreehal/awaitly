import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

function verify(code: string) {
  return linter.verify(code, [
    {
      languageOptions: { parserOptions: { ecmaVersion: 2022, sourceType: 'module' } },
      plugins: { awaitly: plugin },
      rules: { 'awaitly/step-no-deps-bypass': 'error' },
    },
  ]);
}

describe('step-no-deps-bypass', () => {
  describe('createWorkflow assigned to a variable', () => {
    it('flags a dep called directly inside a step thunk', () => {
      const bad = `
        const wf = createWorkflow('checkout', { validateCart, chargeCard });
        wf.run(async ({ step }) => {
          const cart = await step('validateCart', () => validateCart(input));
          return cart;
        });
      `;
      const errors = verify(bad);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('validateCart');
      expect(errors[0].message).toContain('deps.validateCart');
    });

    it('allows the dep called through deps', () => {
      const good = `
        const wf = createWorkflow('checkout', { validateCart, chargeCard });
        wf.run(async ({ step, deps }) => {
          const cart = await step('validateCart', () => deps.validateCart(input));
          return cart;
        });
      `;
      expect(verify(good)).toHaveLength(0);
    });

    it('flags every bypassed dep, not only the first', () => {
      const bad = `
        const wf = createWorkflow('checkout', { validateCart, chargeCard });
        wf.run(async ({ step }) => {
          await step('validateCart', () => validateCart(input));
          await step('chargeCard', () => chargeCard(input));
        });
      `;
      expect(verify(bad)).toHaveLength(2);
    });

    it('ignores calls to functions that are not registered deps', () => {
      const good = `
        const wf = createWorkflow('checkout', { validateCart });
        wf.run(async ({ step, deps }) => {
          const total = computeTotal(items);
          return await step('validateCart', () => deps.validateCart(total));
        });
      `;
      expect(verify(good)).toHaveLength(0);
    });

    it('accepts the run id overload', () => {
      const bad = `
        const wf = createWorkflow('checkout', { validateCart });
        wf.run('checkout', async ({ step }) => {
          await step('validateCart', () => validateCart(input));
        });
      `;
      expect(verify(bad)).toHaveLength(1);
    });
  });

  describe('other workflow shapes', () => {
    it('flags a bypass in the chained createWorkflow().run() form', () => {
      const bad = `
        createWorkflow('checkout', { validateCart }).run(async ({ step }) => {
          await step('validateCart', () => validateCart(input));
        });
      `;
      expect(verify(bad)).toHaveLength(1);
    });

    it('flags a bypass in the deps-first run(deps, fn) form', () => {
      const bad = `
        run({ fetchUser, fetchPosts }, async (s) => {
          const user = await fetchUser('1');
          return await s.fetchPosts(user.id);
        });
      `;
      expect(verify(bad)).toHaveLength(1);
    });

    it('allows the bound steps parameter in run(deps, fn)', () => {
      const good = `
        run({ fetchUser, fetchPosts }, async (s) => {
          const user = await s.fetchUser('1');
          return await s.fetchPosts(user.id);
        });
      `;
      expect(verify(good)).toHaveLength(0);
    });

    it('flags a bypass in createSagaWorkflow', () => {
      const bad = `
        const saga = createSagaWorkflow('checkout', { reserveInventory, releaseInventory });
        saga.run(async ({ step }) => {
          await step('reserveInventory', () => reserveInventory(items));
        });
      `;
      expect(verify(bad)).toHaveLength(1);
    });
  });

  describe('does not fire where it should not', () => {
    it('ignores a dep name shadowed by a callback parameter', () => {
      const good = `
        const wf = createWorkflow('checkout', { validateCart });
        wf.run(async ({ step, validateCart }) => {
          await step('validateCart', () => validateCart(input));
        });
      `;
      expect(verify(good)).toHaveLength(0);
    });

    it('ignores calls outside any workflow callback', () => {
      const good = `
        const wf = createWorkflow('checkout', { validateCart });
        const eager = validateCart(input);
      `;
      expect(verify(good)).toHaveLength(0);
    });

    it('skips deps objects it cannot enumerate (spread)', () => {
      const good = `
        const wf = createWorkflow('checkout', { ...baseDeps, validateCart });
        wf.run(async ({ step }) => {
          await step('validateCart', () => validateCart(input));
        });
      `;
      expect(verify(good)).toHaveLength(0);
    });

    it('ignores a run() call with no deps object', () => {
      const good = `
        run(async ({ step }) => {
          await step.sleep('delay', '5s');
          return validateCart(input);
        });
      `;
      expect(verify(good)).toHaveLength(0);
    });

    it('does not flag the deps object literal itself', () => {
      const good = `
        const wf = createWorkflow('checkout', { validateCart: validateCart });
        wf.run(async ({ step, deps }) => step('validateCart', () => deps.validateCart(input)));
      `;
      expect(verify(good)).toHaveLength(0);
    });
  });
});
