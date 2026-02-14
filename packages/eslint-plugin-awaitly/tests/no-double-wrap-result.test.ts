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
      'awaitly/no-double-wrap-result': 'error',
    },
  },
];

describe('no-double-wrap-result', () => {
  describe('valid cases', () => {
    it('allows returning raw object from run()', () => {
      const code = `run(async ({ step }) => {
        const user = await step(() => fetchUser());
        return { user };
      });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows returning raw value from run()', () => {
      const code = `run(async ({ step }) => {
        const count = await step(() => getCount());
        return count;
      });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows implicit return of raw value', () => {
      const code = `run(async ({ step }) => step(() => fetchUser()));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows ok() in non-executor context', () => {
      const code = `
        function createResult() {
          const result = ok({ data: 123 });
          return result;
        }
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows ok() inside step callback (not executor)', () => {
      const code = `run(async ({ step }) => {
        const user = await step(() => ok({ name: 'Alice' }));
        return { user };
      });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows ok() in nested function inside executor', () => {
      const code = `run(async ({ step }) => {
        const helper = () => ok({ nested: true });
        const result = await step(helper);
        return result;
      });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows returning raw value from createWorkflow executor', () => {
      const code = `createWorkflow('workflow', { fetchUser })(async ({ step }) => {
        const user = await step(fetchUser('1'));
        return { user };
      });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows run.strict with raw value', () => {
      const code = `run.strict(async ({ step }) => {
        const value = await step(() => fetchData());
        return { value };
      }, { catchUnexpected: () => 'ERROR' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('does not flag non-awaitly .run() calls', () => {
      const code = `
        const runner = {
          run: async (fn) => fn(),
        };

        runner.run(async () => ok({ value: 123 }));
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('does not flag non-awaitly .run() with params', () => {
      const code = `
        const runner = {
          run: async (fn) => fn(),
        };

        runner.run(async ({ step }) => ok({ value: step }));
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('does not flag non-awaitly .run() chained off a call', () => {
      const code = `
        const createRunner = () => ({
          run: async (fn) => fn(),
        });

        createRunner().run(async () => ok({ value: 1 }));
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports returning ok() from run() executor', () => {
      const code = `run(async ({ step }) => {
        const user = await step(() => fetchUser());
        return ok({ user });
      });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/no-double-wrap-result');
      expect(messages[0].message).toContain('ok()');
      expect(messages[0].message).toContain('double-wrapping');
    });

    it('reports returning err() from run() executor', () => {
      const code = `run(async ({ step }) => {
        const result = await step(() => fetchUser());
        return err('NOT_FOUND');
      });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('err()');
    });

    it('reports implicit return of ok() from arrow executor', () => {
      const code = `run(async ({ step }) => ok({ data: await step(() => fetchData()) }));`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports ok() in createWorkflow executor', () => {
      const code = `createWorkflow('workflow', { fetchUser })(async ({ step, deps: { fetchUser } }) => {
        const user = await step(fetchUser('1'));
        return ok({ user });
      });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports ok() in workflow with args', () => {
      const code = `workflow({ userId: '1' }, async ({ step, deps, args }) => {
        const user = await step(deps.fetchUser(args.userId));
        return ok({ user });
      });`;
      // Note: This won't match without 'workflow' in WORKFLOW_CALLERS
      // The pattern workflow(...) is typically the result of createWorkflow
      const messages = linter.verify(code, config);
      // This case depends on how we want to handle named workflow variables
      // For now, it won't be caught since 'workflow' isn't in WORKFLOW_CALLERS
      expect(messages).toHaveLength(0);
    });

    it('reports ok() in run.strict executor', () => {
      const code = `run.strict(async ({ step }) => {
        return ok({ value: 42 });
      }, { catchUnexpected: () => 'ERROR' });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports ok() in createWorkflow().run() chained call', () => {
      // Direct chain from createWorkflow can be detected
      const code = `
        createWorkflow('workflow', { fetchUser }).run(async ({ step }) => {
          const user = await step(() => fetchUser());
          return ok({ user });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports ok() in createWorkflow().with().run() chained call', () => {
      const code = `
        createWorkflow('workflow', { fetchUser })
          .with({ onEvent: () => {} })
          .run(async ({ step }) => {
            const user = await step(() => fetchUser());
            return ok({ user });
          });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
    });

    it('reports multiple violations', () => {
      const code = `
        run(async ({ step }) => { return ok(1); });
        run(async ({ step }) => { return err('ERROR'); });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(2);
    });
  });

  describe('autofix', () => {
    it('fixes ok(value) to value', () => {
      const code = `run(async ({ step }) => {
        return ok({ user: 'Alice' });
      });`;

      const result = linter.verifyAndFix(code, config);
      expect(result.fixed).toBe(true);
      expect(result.output).toContain('return { user: \'Alice\' }');
      expect(result.output).not.toContain('ok(');
    });

    it('fixes ok(value) in implicit return', () => {
      const code = `run(async ({ step }) => ok({ data: 123 }));`;

      const result = linter.verifyAndFix(code, config);
      expect(result.fixed).toBe(true);
      expect(result.output).toContain('{ data: 123 }');
      expect(result.output).not.toContain('ok(');
    });

    it('does not autofix err() (requires manual handling)', () => {
      const code = `run(async ({ step }) => {
        return err('NOT_FOUND');
      });`;

      const result = linter.verifyAndFix(code, config);
      // err() should not be autofixed - user needs to decide how to handle errors
      expect(result.output).toContain("err('NOT_FOUND')");
    });

    it('does not autofix ok() with multiple arguments', () => {
      const code = `run(async ({ step }) => {
        return ok(value, extra);
      });`;

      const result = linter.verifyAndFix(code, config);
      // Can't safely fix multi-arg calls
      expect(result.output).toContain('ok(value, extra)');
    });
  });

  describe('known limitations', () => {
    it('cannot detect workflow.run() when workflow is a variable (no data flow analysis)', () => {
      // This is a known limitation - we can't statically trace variable origins
      // The runtime warning will catch these cases
      const code = `
        const workflow = createWorkflow('workflow', { fetchUser });
        workflow.run(async ({ step }) => {
          return ok({ user: 'test' });
        });
      `;
      const messages = linter.verify(code, config);
      // Cannot detect - would require data flow analysis
      expect(messages).toHaveLength(0);
    });

    it('cannot detect workflowInstance() calls (variable-based)', () => {
      // Same limitation - variable-based workflow calls can't be traced
      const code = `
        const myWorkflow = createWorkflow('workflow', { fetchUser });
        myWorkflow(async ({ step }) => {
          return ok({ data: 123 });
        });
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });
});
