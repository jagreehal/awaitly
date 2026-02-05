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
      'awaitly/require-step-id': 'error',
    },
  },
];

describe('require-step-id', () => {
  describe('valid cases - step()', () => {
    it('allows step with string literal id and thunk', () => {
      const code = `step('fetchUser', () => fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step with string id and options', () => {
      const code = `step('fetchUser', () => fetchUser('1'), { key: 'user:1' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step with string id and direct result', () => {
      const code = `step('create', ok({ id: '1' }));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - step.sleep()', () => {
    it('allows step.sleep with string literal id', () => {
      const code = `step.sleep('delay', '5s');`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.sleep with string id and options', () => {
      const code = `step.sleep('rate-limit', '1s', { key: 'user:123' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - step.retry()', () => {
    it('allows step.retry with string literal id', () => {
      const code = `step.retry('fetchData', () => fetchData(), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - step.withTimeout()', () => {
    it('allows step.withTimeout with string literal id', () => {
      const code = `step.withTimeout('slowOp', () => slowOp(), { ms: 5000 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - step.try()', () => {
    it('allows step.try with string literal id', () => {
      const code = `step.try('parse', () => JSON.parse(str), { error: 'PARSE_ERROR' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - step.fromResult()', () => {
    it('allows step.fromResult with string literal id', () => {
      const code = `step.fromResult('callProvider', () => callProvider(), { onError: e => ({ type: 'FAILED' }) });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - step.parallel()', () => {
    it('allows step.parallel with name and object', () => {
      const code = `step.parallel('Fetch data', { a: () => fetchA(), b: () => fetchB() });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows step.parallel with name and callback (array form)', () => {
      const code = `step.parallel('Fetch all', () => allAsync([fetchUser(), fetchPosts()]));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - step.race()', () => {
    it('allows step.race with name and callback', () => {
      const code = `step.race('Fastest API', () => anyAsync([primary(), fallback()]));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - step.allSettled()', () => {
    it('allows step.allSettled with name and callback', () => {
      const code = `step.allSettled('Fetch all', () => allSettledAsync([fetchA(), fetchB()]));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('valid cases - saga.step / saga.tryStep', () => {
    it('allows saga.step with name first and options', () => {
      const code = `
        orderSaga(async (saga, deps) => {
          saga.step('createOrder', () => deps.createOrder(), { compensate: (o) => deps.cancelOrder(o) });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows saga.tryStep with name first and options', () => {
      const code = `
        orderSaga(async (saga, deps) => {
          saga.tryStep('riskyOp', () => deps.riskyOp(), { error: 'FAILED', compensate: () => deps.undo() });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows ctx.step with name first', () => {
      const code = `
        orderSaga(async (ctx, deps) => {
          ctx.step('reserve', () => reserve());
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows destructured tryStep with name first', () => {
      const code = `tryStep('riskyOp', () => deps.riskyOp(), { error: 'FAILED', compensate: () => deps.undo() });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('does not flag unrelated local tryStep function', () => {
      const code = `
        const tryStep = (fn) => fn();
        tryStep(() => doSomething());
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('does not flag tryStep when it is a plain function parameter (not saga context)', () => {
      const code = `
        function run(tryStep) {
          tryStep(() => doSomething());
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('does not flag s.tryStep for unrelated local object', () => {
      const code = `
        const s = { tryStep: (fn) => fn() };
        s.tryStep(() => doSomething());
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases - step()', () => {
    it('reports when step has no arguments', () => {
      const code = `step();`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });

    it('reports when first argument is thunk (missing id)', () => {
      const code = `step(() => fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });

    it('reports when first argument is call expression', () => {
      const code = `step(fetchUser('1'));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });

    it('reports when first argument is identifier', () => {
      const code = `step(myThunk);`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });

    it('reports when first argument is template literal with expressions', () => {
      const code = `step(\`step-\${i}\`, () => fetchUser(i));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });
  });

  describe('invalid cases - step.sleep()', () => {
    it('reports when step.sleep has no arguments', () => {
      const code = `step.sleep();`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('step.sleep()');
    });

    it('reports when step.sleep is missing duration (old API)', () => {
      const code = `step.sleep('5s');`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('step.sleep()');
    });

    it('reports when step.sleep first argument is identifier', () => {
      const code = `step.sleep(delayId, '5s');`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });
  });

  describe('invalid cases - step.retry()', () => {
    it('reports when step.retry first argument is function (old API)', () => {
      const code = `step.retry(() => fetchData(), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('step.retry()');
    });

    it('reports when step.retry first argument is identifier', () => {
      const code = `step.retry(myId, () => fetchData(), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });
  });

  describe('invalid cases - step.withTimeout()', () => {
    it('reports when step.withTimeout first argument is function (old API)', () => {
      const code = `step.withTimeout(() => slowOp(), { ms: 5000 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('step.withTimeout()');
    });
  });

  describe('invalid cases - step.try()', () => {
    it('reports when step.try first argument is function (old API)', () => {
      const code = `step.try(() => JSON.parse(str), { error: 'PARSE_ERROR' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('step.try()');
    });
  });

  describe('invalid cases - step.fromResult()', () => {
    it('reports when step.fromResult first argument is function (old API)', () => {
      const code = `step.fromResult(() => callProvider(), { onError: e => ({ type: 'FAILED' }) });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('step.fromResult()');
    });
  });

  describe('invalid cases - saga.step / saga.tryStep', () => {
    it('reports when saga.step has operation first (missing name)', () => {
      const code = `
        orderSaga(async (saga, deps) => {
          saga.step(() => deps.createOrder(), { compensate: () => deps.cancelOrder() });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('saga.step()');
    });

    it('reports when saga.tryStep has operation first (missing name)', () => {
      const code = `
        orderSaga(async (saga, deps) => {
          saga.tryStep(() => deps.riskyOp(), { error: 'FAILED' });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('saga.tryStep()');
    });

    it('reports when saga.step has no arguments', () => {
      const code = `
        orderSaga(async (saga, deps) => {
          saga.step();
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });

    it('reports when destructured tryStep has operation first (missing name)', () => {
      const code = `
        orderSaga(async ({ step, tryStep }, deps) => {
          tryStep(() => deps.riskyOp(), { error: 'FAILED' });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('tryStep');
    });

    it('reports when saga.step has empty string name', () => {
      const code = `
        orderSaga(async (saga, deps) => {
          saga.step('', () => deps.createOrder(), { compensate: () => deps.cancelOrder() });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('saga.step()');
    });

    it('reports when tryStep has empty string name', () => {
      const code = `
        orderSaga(async ({ step, tryStep }, deps) => {
          tryStep('', () => deps.riskyOp(), { error: 'FAILED' });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('tryStep');
    });
  });

  describe('invalid cases - step.parallel()', () => {
    it('reports when step.parallel first argument is object (legacy form)', () => {
      const code = `step.parallel({ a: () => fetchA(), b: () => fetchB() });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('step.parallel()');
    });

    it('reports when step.parallel has no arguments', () => {
      const code = `step.parallel();`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });

    it('reports when step.parallel first argument is identifier', () => {
      const code = `step.parallel(myName, { a: () => fetchA() });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });
  });

  describe('invalid cases - step.race()', () => {
    it('reports when step.race first argument is function', () => {
      const code = `step.race(() => anyAsync([a(), b()]));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
      expect(messages[0].message).toContain('step.race()');
    });
  });

  describe('supports step aliases', () => {
    it('works with s alias for step.sleep', () => {
      const code = `s.sleep(delayId, '5s');`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });

    it('allows s alias with valid string literal', () => {
      const code = `s.sleep('delay', '5s');`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('works with runStep alias', () => {
      const code = `runStep.retry(() => fetchData(), { attempts: 3 });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/require-step-id');
    });
  });
});
