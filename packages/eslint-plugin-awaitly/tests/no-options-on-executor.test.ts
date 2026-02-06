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
      'awaitly/no-options-on-executor': 'error',
    },
  },
];

describe('no-options-on-executor', () => {
  describe('valid cases', () => {
    it('allows workflow with just a callback', () => {
      const code = `workflow(async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows workflow with args that are not options', () => {
      const code = `workflow({ userId: '123' }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows workflow args with option-like keys when mixed with non-option keys', () => {
      const code = `workflow({ cache: 'user-cache', userId: '123' }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows workflow with function args', () => {
      const code = `workflow(requestFactory, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows createWorkflow with options', () => {
      const code = `const workflow = createWorkflow('workflow', deps, { cache: new Map() });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it('allows arbitrary function calls with options object', () => {
      const code = `someFunction({ cache: true }, (data) => data);`;
      const messages = linter.verify(code, config);
      // Only workflow-like calls are checked, so this passes
      expect(messages).toHaveLength(0);
    });

    it('allows non-workflow calls even with option keys', () => {
      const code = `configureApp({ cache: new Map(), onEvent: handler }, (app) => app);`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe('invalid cases', () => {
    it('reports cache option passed to executor', () => {
      const code = `workflow({ cache: new Map() }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe('awaitly/no-options-on-executor');
      expect(messages[0].message).toContain('cache');
    });

    it('reports onEvent option passed to executor', () => {
      const code = `workflow({ onEvent: (e) => console.log(e) }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('onEvent');
    });

    it('reports resumeState option passed to executor', () => {
      const code = `workflow({ resumeState: savedState }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('resumeState');
    });

    it('reports snapshot option passed to executor', () => {
      const code = `workflow({ snapshot: loadedSnapshot }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('snapshot');
    });

    it('reports multiple options passed to executor', () => {
      const code = `workflow({ cache: new Map(), onEvent: handler }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('cache');
      expect(messages[0].message).toContain('onEvent');
    });

    it('reports signal option passed to executor', () => {
      const code = `workflow({ signal: controller.signal }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('signal');
    });

    it('reports strict option passed to executor', () => {
      const code = `workflow({ strict: true, catchUnexpected: mapError }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('strict');
      expect(messages[0].message).toContain('catchUnexpected');
    });

    it('reports shouldRun option passed to executor', () => {
      const code = `workflow({ shouldRun: () => true }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('shouldRun');
    });

    it('reports createContext option passed to executor', () => {
      const code = `workflow({ createContext: () => ({ requestId: '123' }) }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('createContext');
    });

    it('reports streamStore option passed to executor', () => {
      const code = `workflow({ streamStore }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('streamStore');
    });

    it('reports with regular function expression', () => {
      const code = `workflow({ cache: new Map() }, function(step) { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('cache');
    });

    it('reports options on myWorkflow executor', () => {
      const code = `myWorkflow({ cache: new Map() }, async (step) => { return step(fn()); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('cache');
    });

    it('reports options on userWorkflow executor', () => {
      const code = `userWorkflow({ onEvent: handler }, async (step) => { return step(fn()); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('onEvent');
    });

    it('reports options on run executor', () => {
      const code = `run({ cache: new Map() }, async (step) => { return step(fn()); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('cache');
    });

    it('reports options on member expression workflow call', () => {
      const code = `this.workflow({ cache: new Map() }, async (step) => { return step(fn()); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('cache');
    });

    it('reports options when callback is a function identifier', () => {
      const code = `
        const handler = async (step) => { return step(fn()); };
        workflow({ cache: new Map() }, handler);
      `;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('cache');
    });
  });

  describe('error message clarity', () => {
    it('explains options are ignored and suggests createWorkflow', () => {
      const code = `workflow({ cache: new Map() }, async (step) => { return step(fetchUser('1')); });`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain('ignored');
      expect(messages[0].message).toContain('createWorkflow');
    });
  });
});
