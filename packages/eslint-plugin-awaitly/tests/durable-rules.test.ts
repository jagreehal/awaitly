import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import plugin from '../src/index.js';

const linter = new Linter({ configType: 'flat' });

const lint = (code: string, rule: string) =>
  linter.verify(code, [{ plugins: { awaitly: plugin }, rules: { [`awaitly/${rule}`]: 'error' } }]);

const ruleIds = (code: string, rule: string) => lint(code, rule).map((m) => m.messageId);

/** Wrap a handler body in a native durable function. */
const durable = (body: string, source = '@aws/durable-execution-sdk-js') => `
import { withDurableExecution } from '${source}';
export const handler = withDurableExecution(async (event, context) => {
${body}
});`;

describe('durable-no-nondeterminism', () => {
  const rule = 'durable-no-nondeterminism';

  it.each([
    ['Date.now()', 'const t = Date.now();'],
    ['new Date()', 'const t = new Date();'],
    ['Date()', 'const t = Date();'],
    ['Math.random()', 'const r = Math.random();'],
    ['crypto.randomUUID()', 'const id = crypto.randomUUID();'],
    ['performance.now()', 'const t = performance.now();'],
  ])('flags %s in the handler body', (_api, body) => {
    expect(ruleIds(durable(body), rule)).toEqual(['nondeterministic']);
  });

  it('names the API in the message', () => {
    expect(lint(durable('const t = Date.now();'), rule)[0]?.message).toContain('Date.now() returns a different value');
  });

  it('flags randomUUID imported from node:crypto', () => {
    const code = `import { randomUUID } from 'node:crypto';\n${durable('const id = randomUUID();')}`;
    expect(ruleIds(code, rule)).toEqual(['nondeterministic']);
  });

  it('flags nondeterminism in a nested helper and in a child context', () => {
    const code = durable(`
      const stamp = () => Date.now();
      await context.runInChildContext('group', async (child) => {
        const r = Math.random();
      });`);
    expect(ruleIds(code, rule)).toEqual(['nondeterministic', 'nondeterministic']);
  });

  it('flags it in parallel branches, plain and named', () => {
    const code = durable(`
      await context.parallel('fanout', [
        async (ctx) => Date.now(),
        { name: 'b', func: async (ctx) => Math.random() },
      ]);`);
    expect(ruleIds(code, rule)).toEqual(['nondeterministic', 'nondeterministic']);
  });

  it('allows them inside a step, where the value is checkpointed', () => {
    const code = durable(`
      const t = await context.step('now', async () => Date.now());
      const id = await context.step(async () => crypto.randomUUID());`);
    expect(lint(code, rule)).toEqual([]);
  });

  it('allows deterministic Date use and a shadowed Date', () => {
    const code = durable(`
      const parsed = new Date(event.createdAt);
      const Date = { now: () => 1 };
      const fake = Date.now();`);
    expect(lint(code, rule)).toEqual([]);
  });

  it('works with the awaitly-durable-lambda drop-in and a namespace import', () => {
    expect(ruleIds(durable('Date.now();', 'awaitly-durable-lambda'), rule)).toEqual(['nondeterministic']);
    const code = `
      import * as durable from '@aws/durable-execution-sdk-js';
      export const handler = durable.withDurableExecution(async (event, context) => { Math.random(); });`;
    expect(ruleIds(code, rule)).toEqual(['nondeterministic']);
  });

  it('ignores code outside durable functions', () => {
    expect(lint('const t = Date.now();', rule)).toEqual([]);
    const local = `
      function withDurableExecution(fn) { return fn; }
      withDurableExecution(async (event, context) => { Date.now(); });`;
    expect(lint(local, rule)).toEqual([]);
  });
});

describe('durable-context-scope', () => {
  const rule = 'durable-context-scope';

  it('flags durable operations inside a step function', () => {
    const code = durable(`
      await context.step('outer', async () => {
        await context.wait({ seconds: 1 });
        await context.step('inner', async () => 1);
      });`);
    expect(ruleIds(code, rule)).toEqual(['operationInStep', 'operationInStep']);
  });

  it('flags operations inside a waitForCallback submitter', () => {
    const code = durable(`
      await context.waitForCallback('approve', async (callbackId) => {
        await context.step('notify', async () => send(callbackId));
      }, { timeout: { hours: 1 } });`);
    expect(ruleIds(code, rule)).toEqual(['operationInStep']);
  });

  it('flags using the parent context inside a child context', () => {
    const code = durable(`
      await context.runInChildContext('group', async (child) => {
        await child.step('ok', async () => 1);
        await context.step('wrong', async () => 2);
      });
      await context.map('items', event.items, async (ctx, item) => {
        await context.step('wrong', async () => item);
      });`);
    const messages = lint(code, rule);
    expect(messages.map((m) => m.messageId)).toEqual(['outerContext', 'outerContext']);
    expect(messages[0]?.message).toContain('Use this callback\'s own context parameter "child"');
  });

  it('flags parent context use in parallel branches and context.promise combinators', () => {
    const code = durable(`
      await context.parallel([
        async (branch) => context.wait({ seconds: 1 }),
      ]);
      await context.step('s', async () => context.promise.all([]));`);
    expect(ruleIds(code, rule)).toEqual(['outerContext', 'operationInStep']);
  });

  it('allows operations on the right context and config callbacks', () => {
    const code = durable(`
      const user = await context.step('getUser', async () => getUser(event.id), {
        retryStrategy: (error, attempt) => ({ shouldRetry: attempt < 3, delay: { seconds: 1 } }),
      });
      await context.wait({ seconds: 5 });
      await context.runInChildContext(async (child) => {
        await child.step('x', async () => 1);
        await child.map('nested', [1, 2], async (grandchild, n) => grandchild.step(async () => n));
      });`);
    expect(lint(code, rule)).toEqual([]);
  });
});

describe('durable-callback-timeout', () => {
  const rule = 'durable-callback-timeout';

  it.each([
    ['waitForCallback without config', "await context.waitForCallback('approve', async (id) => {});"],
    ['waitForCallback without a name or config', 'await context.waitForCallback(async (id) => {});'],
    ['waitForCallback with config but no timeout', "await context.waitForCallback('a', async () => {}, { heartbeatTimeout: { minutes: 5 } });"],
    ['createCallback without config', "const [p, id] = await context.createCallback('a');"],
    ['createCallback with no arguments', 'const [p, id] = await context.createCallback();'],
  ])('flags %s', (_case, body) => {
    expect(ruleIds(durable(body), rule)).toEqual(['missingTimeout']);
  });

  it.each([
    ['a timeout', "await context.waitForCallback('a', async () => {}, { timeout: { hours: 24 } });"],
    ['createCallback with a timeout', "await context.createCallback('a', { timeout: { days: 2 } });"],
    ['a config we cannot see into', "await context.waitForCallback('a', async () => {}, config);"],
    ['a spread config', "await context.createCallback({ ...defaults });"],
  ])('allows %s', (_case, body) => {
    expect(lint(durable(body), rule)).toEqual([]);
  });
});

describe('durable-no-step-closure-mutation', () => {
  const rule = 'durable-no-step-closure-mutation';

  it('flags writes to orchestration variables from inside a step', () => {
    const code = durable(`
      let total = 0;
      const seen = { count: 0 };
      await context.step('add', async () => {
        total += 1;
        seen.count++;
      });`);
    const messages = lint(code, rule);
    expect(messages.map((m) => m.messageId)).toEqual(['closureMutation', 'closureMutation']);
    expect(messages[0]?.message).toContain('Writing to "total" inside a step is lost on replay');
  });

  it('allows step-local state and writes outside steps', () => {
    const code = durable(`
      let total = await context.step('sum', async () => {
        let acc = 0;
        for (let i = 0; i < 3; i++) acc += i;
        return acc;
      });
      total += 1;`);
    expect(lint(code, rule)).toEqual([]);
  });
});

describe('durable rules on TypeScript sources', () => {
  it('detect typed handlers, typed child contexts, and Result-returning steps', () => {
    const code = `
      import { withDurableExecution, type DurableContext } from 'awaitly-durable-lambda';
      import type { AsyncResult } from 'awaitly';
      declare function charge(id: string): AsyncResult<{ receipt: string }, 'DECLINED'>;

      export const handler = withDurableExecution(async (event: { id: string }, context: DurableContext) => {
        const at = Date.now();
        const receipt = await context.step('charge', (): AsyncResult<{ receipt: string }, 'DECLINED'> => charge(event.id));
        await context.runInChildContext('group', async (child: DurableContext) => {
          await context.wait({ seconds: 1 });
        });
        await context.waitForCallback('approve', async (callbackId: string) => {});
        return receipt;
      });`;
    const messages = linter.verify(code, [
      {
        files: ['**/*.ts'],
        languageOptions: { parser: tsParser },
        ...plugin.configs?.durable?.[0],
      },
    ], 'handler.ts');
    expect(messages.map((m) => m.ruleId)).toEqual([
      'awaitly/durable-no-nondeterminism',
      'awaitly/durable-context-scope',
      'awaitly/durable-callback-timeout',
    ]);
  });
});

describe('handlers wrapped in validateEvent', () => {
  const wrapped = (body: string, imports = "import { validateEvent, withDurableExecution } from 'awaitly-durable-lambda';") => `
${imports}
export const handler = withDurableExecution(validateEvent(schema, async (event, context) => {
${body}
}));`;

  it('applies the durable rules inside the wrapped handler', () => {
    expect(ruleIds(wrapped('const t = Date.now();'), 'durable-no-nondeterminism')).toEqual(['nondeterministic']);
    expect(
      ruleIds(wrapped("await context.step('s', async () => context.wait({ seconds: 1 }));"), 'durable-context-scope')
    ).toEqual(['operationInStep']);
    expect(ruleIds(wrapped("await context.waitForCallback('a', async () => {});"), 'durable-callback-timeout')).toEqual([
      'missingTimeout',
    ]);
  });

  it('unwraps an aliased or namespaced validateEvent', () => {
    const aliased = "import { validateEvent as validated, withDurableExecution } from 'awaitly-durable-lambda';";
    expect(
      ruleIds(wrapped('Math.random();', aliased).replace('validateEvent(schema', 'validated(schema'), 'durable-no-nondeterminism')
    ).toEqual(['nondeterministic']);
    const namespaced = `
      import * as durable from 'awaitly-durable-lambda';
      export const handler = durable.withDurableExecution(durable.validateEvent(schema, async (event, context) => { Math.random(); }));`;
    expect(ruleIds(namespaced, 'durable-no-nondeterminism')).toEqual(['nondeterministic']);
  });

  it('ignores a local binding that shadows the imported validateEvent', () => {
    const shadowed = `
      import { validateEvent, withDurableExecution } from 'awaitly-durable-lambda';
      export function make(validateEvent) {
        return withDurableExecution(validateEvent(schema, async (event, context) => { Date.now(); }));
      }`;
    expect(lint(shadowed, 'durable-no-nondeterminism')).toEqual([]);
  });

  it('ignores a validateEvent from another module', () => {
    const other = `
      import { withDurableExecution } from 'awaitly-durable-lambda';
      import { validateEvent } from './somewhere-else';
      export const handler = withDurableExecution(validateEvent(schema, async (event, context) => { Date.now(); }));`;
    expect(lint(other, 'durable-no-nondeterminism')).toEqual([]);
  });
});

