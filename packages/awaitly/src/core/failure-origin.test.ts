/**
 * Which failures reach spans as exceptions, and whose message and stack they
 * export.
 */
import { context, metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UnexpectedError } from '../errors';
import { err, ok, type Result } from '../result';
import { run, type RunStep } from '../run-entry';
import { runSaga } from '../saga';
import { TaggedError } from '../tagged-error';
import { createWorkflow } from '../workflow-entry';
import { deserializeResumeState, serializeResumeState } from '../workflow/serialize-resume-state';

describe('failure origin', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const finished = async () => {
    await provider.forceFlush();
    return exporter.getFinishedSpans();
  };

  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    trace.setGlobalTracerProvider(provider);
  });

  beforeEach(() => exporter.reset());

  afterAll(async () => {
    await provider.shutdown();
    context.disable();
    trace.disable();
  });

  describe('errors whose message is built from their fields', () => {
    class EmailTaken extends TaggedError('EmailTaken', {
      message: (p: { email: string; cause?: unknown }) => `${p.email} is taken`,
    }) {}
    class HandWritten extends Error {
      readonly type = 'HandWritten';
      override name = 'HandWritten';
    }
    const exported = async () =>
      (await finished()).map((s) => ({ status: s.status, attributes: s.attributes, events: s.events }));

    it.each([
      ['TaggedError', () => new EmailTaken({ email: 'a@b.c' })],
      ['Error subclass with a type', () => new HandWritten('a@b.c is taken')],
      ['TaggedError caused by another', () => new EmailTaken({ email: 'a@b.c', cause: new EmailTaken({ email: 'a@b.c' }) })],
    ])('keeps the message and stack of a returned %s off every span', async (_label, make) => {
      const save = async () => err(make());
      await run({ save }, async (s) => s.save(), { workflowName: 'signup' });

      const spans = await exported();
      expect(spans).toHaveLength(2);
      for (const span of spans) {
        expect(span.status).toEqual({ code: SpanStatusCode.ERROR });
        expect(span.attributes['error.type']).toBe(make().name);
        expect(span.events).toEqual([]);
      }
      expect(JSON.stringify(spans)).not.toContain('a@b.c');
    });

    it('takes message and stack from the Error a TaggedError carries as cause', async () => {
      const cause = new Error('E11000 duplicate key');
      const save = async () => err(new EmailTaken({ email: 'a@b.c', cause }));
      await run({ save }, async (s) => s.save(), { workflowName: 'signup' });

      const spans = await exported();
      for (const span of spans) {
        expect(span.status.message).toBe('E11000 duplicate key');
        expect(span.events.map((e) => e.attributes)).toEqual([
          {
            'exception.type': 'EmailTaken',
            'exception.message': 'E11000 duplicate key',
            'exception.stacktrace': cause.stack,
          },
        ]);
      }
      expect(JSON.stringify(spans)).not.toContain('a@b.c');
    });

    it('keeps a thrown TaggedError an exception, by type alone', async () => {
      const save = async (): Promise<string> => {
        throw new EmailTaken({ email: 'a@b.c' });
      };
      const result = await run({ save }, async (s) => s.save(), { workflowName: 'signup' });
      expect(result.ok ? undefined : result.error).toBeInstanceOf(UnexpectedError);

      const spans = await exported();
      for (const span of spans) {
        expect(span.attributes['error.type']).toBe('UnexpectedError');
        expect(span.events.map((e) => e.attributes)).toEqual([{ 'exception.type': 'EmailTaken' }]);
      }
      expect(JSON.stringify(spans)).not.toContain('a@b.c');
    });

    it("treats a user's own error named UnexpectedError like any other", async () => {
      class MyUnexpected extends TaggedError('UnexpectedError', {
        message: (p: { email: string }) => `${p.email} is taken`,
      }) {}
      const save = async () => err(new MyUnexpected({ email: 'a@b.c' }));
      await run({ save }, async (s) => s.save(), { workflowName: 'signup' });

      const spans = await exported();
      expect(spans).toHaveLength(2);
      for (const span of spans) {
        expect(span.status).toEqual({ code: SpanStatusCode.ERROR });
        expect(span.events).toEqual([]);
      }
      expect(JSON.stringify(spans)).not.toContain('a@b.c');
    });

    describe('throws that a mapper turned into a typed error', () => {
      const thrown = Object.assign(new Error('socket hang up'), { type: 'system' });
      const boom = async (): Promise<string> => { throw thrown; };
      const boomResult = boom as unknown as () => Promise<Result<string, never>>;
      const MAPPED = { type: 'MAPPED' } as const;
      const retry = { attempts: 2, initialDelay: 1 };
      const child = () => run(async ({ step }) => step.try('inner', boom, { error: MAPPED }), { workflowName: 'child' });

      it.each<[string, () => Promise<unknown>]>([
        ['run catchUnexpected, in a step', () => run(async ({ step }) => step('a', boomResult), { workflowName: 'w', catchUnexpected: () => MAPPED })],
        ['run catchUnexpected, outside a step', () => run(boom, { workflowName: 'w', catchUnexpected: () => MAPPED })],
        ['createWorkflow catchUnexpected', () => createWorkflow('w', {}, { catchUnexpected: () => MAPPED }).run(async ({ step }) => step('a', boomResult))],
        ['step.try', () => run(async ({ step }) => step.try('a', boom, { error: MAPPED }), { workflowName: 'w' })],
        ['step.try onError', () => run(async ({ step }) => step.try('a', boom, { onError: () => MAPPED }), { workflowName: 'w' })],
        ['step.try with retry', () => run(async ({ step }) => step.try('a', boom, { error: MAPPED, retry }), { workflowName: 'w' })],
        ['workflow step.try', () => createWorkflow('w', {}).run(async ({ step }) => step.try('a', boom, { error: MAPPED }))],
        ['a nested run', () => run(async ({ step }) => step('a', child), { workflowName: 'w' })],
        ['saga step.try', () => runSaga(async ({ step }) => step.try('a', boom, { error: MAPPED }))],
      ])('records the exception on every span: %s', async (_label, act) => {
        await act();
        const spans = await finished();
        expect(spans.length).toBeGreaterThan(0);
        for (const span of spans) {
          expect(span.attributes['error.type'], span.name).toBe('MAPPED');
          expect(span.status.message, span.name).toBe('socket hang up');
          expect(span.events.filter((e) => e.name === 'exception').map((e) => e.attributes), span.name).toEqual([
            {
              'exception.type': 'MAPPED',
              'exception.message': 'socket hang up',
              'exception.stacktrace': thrown.stack,
            },
          ]);
        }
      });

      it('keeps a thrown TaggedError message out when a mapper replaces it', async () => {
        const fail = async (): Promise<string> => { throw new EmailTaken({ email: 'a@b.c' }); };
        await run(async ({ step }) => step.try('a', fail, { error: MAPPED }), { workflowName: 'w' });
        const spans = await exported();
        for (const span of spans) expect(span.events.map((e) => e.attributes)).toEqual([{ 'exception.type': 'MAPPED' }]);
        expect(JSON.stringify(spans)).not.toContain('a@b.c');
      });

      it.each<[string, Parameters<typeof createWorkflow>[2]]>([
        ['shouldRun', { shouldRun: () => false }],
        ['onBeforeStart', { onBeforeStart: () => false }],
        ['shouldRun, mapped with its cause', { shouldRun: () => false, catchUnexpected: (cause: unknown) => ({ type: 'SKIPPED', cause }) as never }],
      ])('records no exception when a hook skips the run: %s', async (_label, options) => {
        const child = createWorkflow('w', {}, options);
        await child.run(async () => 1);
        await run(async ({ step }) => step('child', () => child.run(async () => 1)), { workflowName: 'parent' });

        const spans = await finished();
        expect(spans.map((s) => s.name)).toEqual(['run w', 'run w', 'step child', 'run parent']);
        for (const span of spans) {
          expect(span.status.code, span.name).toBe(SpanStatusCode.ERROR);
          expect(span.events, span.name).toEqual([]);
        }
      });

      it.each<[string, (onError: () => never) => Promise<unknown>]>([
        ['catchUnexpected', (onError) => run(async ({ step }) => step('a', boomResult), { workflowName: 'w', catchUnexpected: onError })],
        ['step.try', (onError) => run(async ({ step }) => step.try('a', boom, { onError }), { workflowName: 'w' })],
      ])("prefers what was thrown over the cause a mapper adds: %s", async (_label, act) => {
        await act(() => ({ type: 'MAPPED', cause: new Error('another error') }) as never);
        const spans = await finished();
        expect(spans).toHaveLength(2);
        for (const span of spans) {
          expect(span.status.message, span.name).toBe('socket hang up');
          expect(span.events.map((e) => e.attributes?.['exception.stacktrace']), span.name).toEqual([thrown.stack]);
        }
      });

      it('keeps a thrown TaggedError type-only when the mapper adds a cause', async () => {
        const fail = async (): Promise<string> => { throw new EmailTaken({ email: 'a@b.c' }); };
        const onError = () => ({ type: 'MAPPED', cause: new Error('another error') }) as never;
        await run(async ({ step }) => step.try('a', fail, { onError }), { workflowName: 'w' });
        for (const span of await finished()) {
          expect(span.events.map((e) => e.attributes)).toEqual([{ 'exception.type': 'MAPPED' }]);
        }
      });

      const sdkError = thrown;
      const throwString = async (): Promise<string> => { throw 'boom'; };
      const withOther = () => ({ type: 'MAPPED', cause: new Error('another error') }) as never;
      it.each<[string, () => Promise<Result<unknown, { type: string }>>, string]>([
        ['a throw step.try mapped', () => child() as never, 'socket hang up'],
        ['a Result cause', async () => err({ type: 'CHILD' }, { cause: sdkError }), 'socket hang up'],
        ['an error cause', async () => err({ type: 'CHILD', cause: sdkError }), 'socket hang up'],
        ['an UnexpectedError', () => run(async ({ step }) => step('inner', boomResult), { workflowName: 'child' }) as never, 'socket hang up'],
      ])('keeps the exception when step.fromResult remaps %s', async (_label, operation, message) => {
        await run(async ({ step }) => step.fromResult('a', operation, { error: MAPPED }), { workflowName: 'parent' });
        const parents = (await finished()).filter((s) => ['step a', 'run parent'].includes(s.name));
        expect(parents).toHaveLength(2);
        for (const span of parents) {
          expect(span.attributes['error.type'], span.name).toBe('MAPPED');
          expect(span.events.map((e) => e.attributes?.['exception.message']), span.name).toEqual([message]);
        }
      });

      it('records an SDK error given as a Result cause like one on the error itself', async () => {
        await run(async ({ step }) => step('a', async () => err({ type: 'X' }, { cause: sdkError })), { workflowName: 'w' });
        await run(async ({ step }) => step('a', async () => err({ type: 'X', cause: sdkError })), { workflowName: 'w' });
        const spans = await finished();
        expect(spans).toHaveLength(4);
        for (const span of spans) {
          expect(span.events.map((e) => e.attributes), span.name).toEqual([
            { 'exception.type': 'X', 'exception.message': 'socket hang up', 'exception.stacktrace': sdkError.stack },
          ]);
        }
      });

      it.each<[string, { error: typeof MAPPED } | { onError: (e: HandWritten) => { type: 'MAPPED'; cause: unknown } }]>([
        ['dropped', { error: MAPPED }],
        ['kept as a cause', { onError: (cause) => ({ type: 'MAPPED', cause }) }],
      ])('keeps a returned error out of live, cached and resumed runs when step.fromResult maps it: %s', async (_label, opts) => {
        const save = async () => err(new HandWritten('a@b.c is taken'));
        const cache = new Map();
        const wf = createWorkflow('w', { save }, { cache });
        const body = async ({ step }: { step: { fromResult: (...args: never[]) => Promise<unknown> } }) =>
          (step.fromResult as (...args: unknown[]) => Promise<unknown>)('a', save, opts);
        const { resumeState } = await wf.runWithState(body as never);
        await wf.run(body as never);
        await createWorkflow('w', { save }, { resumeState }).run(body as never);
        const restored = deserializeResumeState(JSON.parse(JSON.stringify(serializeResumeState(resumeState))));
        await createWorkflow('w', { save }, { resumeState: restored }).run(body as never);

        const spans = await exported();
        expect(spans).toHaveLength(5);
        expect(spans.flatMap((s) => s.events).filter((e) => e.name === 'exception')).toEqual([]);
        expect(JSON.stringify(spans)).not.toContain('a@b.c');
      });

      it('keeps a TaggedError message out of a run resumed from a snapshot', async () => {
        const save = async (): Promise<string> => { throw new EmailTaken({ email: 'a@b.c' }); };
        const body = async ({ step }: { step: unknown }) =>
          (step as { try: (...args: unknown[]) => Promise<unknown> }).try('a', save, { error: MAPPED });
        const { resumeState } = await createWorkflow('w', {}).runWithState(body as never);
        const restored = deserializeResumeState(JSON.parse(JSON.stringify(serializeResumeState(resumeState))));
        exporter.reset();
        const result = await createWorkflow('w', {}, { resumeState: restored }).run(body as never);

        expect(result).toMatchObject({ ok: false, error: MAPPED });
        const spans = await exported();
        expect(spans).toHaveLength(1);
        expect(JSON.stringify(spans)).not.toContain('a@b.c');
      });

      it.each([false, true])('leaves the outcome alone when a getter on the error throws (telemetry: %s)', async (telemetry) => {
        const hostile = () => {
          const error = { type: 'HOSTILE' } as const;
          Object.defineProperty(error, 'cause', { get: () => { throw new Error('getter'); } });
          return error;
        };
        const remapped = await run(
          async ({ step }) => step.fromResult('a', async () => err(hostile()), { error: MAPPED }),
          { workflowName: 'w', telemetry },
        );
        expect(remapped).toMatchObject({ ok: false, error: { type: 'MAPPED' } });
        const passed = await run({ a: async () => err(hostile()) }, async (s) => s.a(), { workflowName: 'w', telemetry });
        expect(passed.ok ? undefined : passed.error.type).toBe('HOSTILE');
        const spans = await finished();
        expect(spans).toHaveLength(telemetry ? 4 : 0);
        for (const span of spans) expect(span.status.code, span.name).toBe(SpanStatusCode.ERROR);
      });

      /** Throws on every trap, or only on symbol reads so its fields stay readable. */
      const proxied = (hostile: 'all' | 'symbols') => {
        let armed = true;
        const trap = <A extends unknown[], R>(read: (...args: A) => R, guards: (...args: A) => boolean) => (...args: A): R => {
          if (armed && guards(...args)) throw new Error('trap');
          return read(...args);
        };
        const always = () => hostile === 'all';
        const error = new Proxy({ type: 'MAPPED' } as const, {
          get: trap(Reflect.get, (_t, key) => hostile === 'all' || typeof key === 'symbol'),
          has: trap(Reflect.has, always),
          getPrototypeOf: trap(Reflect.getPrototypeOf, always),
        });
        return { error, disarm: () => { armed = false; } };
      };

      it.each(['all', 'symbols'] as const)('keeps a Proxy error an Err with telemetry on: %s traps throw', async (hostile) => {
        const { error, disarm } = proxied(hostile);
        const acts: Array<(telemetry: boolean) => Promise<{ ok: boolean; error?: unknown }>> = [
          (telemetry) => run(boom, { workflowName: 'w', telemetry, catchUnexpected: () => error }),
          (telemetry) => run(async ({ step }) => step('a', boomResult), { workflowName: 'w', telemetry, catchUnexpected: () => error }),
          (telemetry) => run(async ({ step }) => step.try('a', boom, { error }), { workflowName: 'w', telemetry }),
          (telemetry) => run(async ({ step }) => step.fromResult('a', async () => err({ type: 'X' }), { error }), { workflowName: 'w', telemetry }),
          (telemetry) => createWorkflow('w', {}, { catchUnexpected: () => error }).run(boom, { telemetry }),
          (telemetry) => runSaga(async ({ step }) => step.try('a', boom, { error }), { telemetry }),
        ];
        for (const act of acts) {
          const settle = async (telemetry: boolean) => {
            try {
              const result = await act(telemetry);
              return { ok: result.ok, same: result.error === error };
            } catch {
              return 'rejected';
            }
          };
          exporter.reset();
          expect(await settle(true), act.toString()).toEqual(await settle(false));
          for (const span of await finished()) {
            expect(span.status.code, span.name).toBe(SpanStatusCode.ERROR);
            if (hostile === 'symbols') expect(span.attributes['error.type'], span.name).toBe('MAPPED');
          }
        }
        disarm();
      });

      it('still records the throw behind a Proxy error, and labels its metrics', async () => {
        const measured: unknown[] = [];
        const instrument = { record: (_v: number, attributes: unknown) => measured.push(attributes), add: () => {} };
        metrics.setGlobalMeterProvider({
          getMeter: () => ({ createHistogram: () => instrument, createCounter: () => instrument }),
        } as unknown as Parameters<typeof metrics.setGlobalMeterProvider>[0]);
        const { error, disarm } = proxied('symbols');
        await run(boom, { workflowName: 'w', catchUnexpected: () => error });
        metrics.disable();
        disarm();

        const [span] = await finished();
        expect(span?.status.message).toBe('socket hang up');
        expect(span?.events.map((e) => e.attributes?.['exception.message'])).toEqual(['socket hang up']);
        expect(measured).toEqual([expect.objectContaining({ 'awaitly.outcome': 'error', 'error.type': 'MAPPED' })]);
      });

      it.each([false, true])('keeps the cause when a listener changes the metadata it received (telemetry: %s)', async (telemetry) => {
        const cause = new Error('original');
        const failing = async (): Promise<Result<never, { type: 'X' }, Error>> => err({ type: 'X' } as const, { cause });
        const throwing = async (): Promise<string> => { throw cause; };
        const returned = { type: 'RETURNED' } as const;
        const acts: Array<[string, unknown, (step: RunStep<unknown>) => Promise<unknown>]> = [
          ['step', cause, (step) => step('a', failing, { key: 'a' })],
          ['step.retry', cause, (step) => step.retry('a', failing, { attempts: 1, key: 'a' })],
          ['step.try', cause, (step) => step.try('a', throwing, { error: MAPPED })],
          ['step.fromResult', returned, (step) => step.fromResult('a', async () => err(returned), { error: MAPPED })],
          ['step.withFallback, not matched', cause, (step) => step.withFallback('a', failing, { on: 'OTHER' as never, fallback: failing, key: 'a' })],
          ['step.withFallback, fallback fails', cause, (step) => step.withFallback('a', async () => err({ type: 'FIRST' }), { fallback: failing, key: 'a' })],
          ['step.withFallback after a throw', cause, (step) => step.withFallback('a', boomResult, { fallback: failing, key: 'a' })],
          ['step.withResource, acquire fails', cause, (step) => step.withResource('a', { acquire: failing, use: async () => ok(1), release: () => {} })],
          ['step.withResource, use fails', cause, (step) => step.withResource('a', { acquire: async () => ok(1), use: failing, release: () => {} })],
        ];
        for (const [label, expected, act] of acts) {
          let changed = 0;
          const onEvent = (event: { type: string; meta?: unknown }) => {
            if (event.type !== 'step_complete' || !event.meta) return;
            Object.assign(event.meta, { resultCause: 'redacted', thrown: 'redacted' });
            changed++;
          };
          const body = async ({ step }: { step: unknown }) => act(step as RunStep<unknown>);
          const plain = await run(body as never, { workflowName: 'w', telemetry, onEvent } as never) as Result<unknown, unknown>;
          const workflow = await createWorkflow('w', {}, { onEvent: onEvent as never }).run(body as never, { telemetry });
          for (const result of [plain, workflow]) {
            expect(result.ok, label).toBe(false);
            expect(result.ok ? undefined : result.cause, label).toBe(expected);
          }
          expect(changed, label).toBeGreaterThanOrEqual(2);
        }
      });

      it('traces an error the same way after another run remapped it', async () => {
        const asCause = () => run(async ({ step }) => step('a', async () => err({ type: 'X' }, { cause: sdkError })), { workflowName: 'w' });
        const messages = async () => (await finished()).map((s) => s.events.map((e) => e.attributes?.['exception.message']));
        await asCause();
        const before = await messages();
        exporter.reset();
        await run(async ({ step }) => step.fromResult('a', async () => err(sdkError), { error: MAPPED }), { workflowName: 'w' });
        exporter.reset();
        await asCause();

        expect(before).toEqual([['socket hang up'], ['socket hang up']]);
        expect(await messages()).toEqual(before);
      });

      it.each<[string, () => Promise<unknown>]>([
        ['typed error, step.try', () => run(async ({ step }) => step.try('a', throwString, { onError: () => withOther() }), { workflowName: 'w' })],
        ['typed error, catchUnexpected', () => run(async ({ step }) => step('a', throwString as never), { workflowName: 'w', catchUnexpected: () => withOther() })],
        ['UnexpectedError', () => run(async ({ step }) => step('a', throwString as never), { workflowName: 'w', catchUnexpected: () => new UnexpectedError({ cause: new Error('another error') }) })],
      ])("keeps a mapper's own cause off the spans of a thrown string: %s", async (_label, act) => {
        await act();
        const spans = await exported();
        expect(spans).toHaveLength(2);
        for (const span of spans) {
          expect(span.status).toEqual({ code: SpanStatusCode.ERROR });
          expect(span.events.map((e) => e.attributes)).toEqual([{ 'exception.type': span.attributes['error.type'] }]);
        }
      });

      it('shows a thrown string through the UnexpectedError awaitly wraps it in', async () => {
        await run(async ({ step }) => step('a', throwString as never), { workflowName: 'w' });
        for (const span of await finished()) expect(span.status.message).toBe('UnexpectedError: boom');
      });

      it('keeps a nested remap of a returned error out of a resumed parent', async () => {
        const inner = () => run(
          async ({ step }) => step.fromResult('b', async () => err(new HandWritten('a@b.c is taken')), { error: MAPPED }),
          { workflowName: 'child' },
        );
        const body = async ({ step }: { step: unknown }) =>
          (step as (...args: unknown[]) => Promise<unknown>)('a', inner, { key: 'a' });
        const { resumeState } = await createWorkflow('w', {}).runWithState(body as never);
        await createWorkflow('w', {}, { resumeState }).run(body as never);

        const spans = await exported();
        expect(spans).toHaveLength(5);
        expect(spans.flatMap((s) => s.events).filter((e) => e.name === 'exception')).toEqual([]);
        expect(JSON.stringify(spans)).not.toContain('a@b.c');
      });

      it('still records an exception when a hook throws', async () => {
        const boomHook = () => { throw thrown; };
        await createWorkflow('w', {}, { shouldRun: boomHook, catchUnexpected: () => MAPPED }).run(async () => 1);
        const [span] = await finished();
        expect(span?.events.map((e) => e.attributes?.['exception.message'])).toEqual(['socket hang up']);
      });

      it('records a thrown object with an error field on every attempt', async () => {
        const fail = (async () => { throw { error: { type: 'INNER' } }; }) as () => Promise<Result<string, never>>;
        await run(
          async ({ step }) => step('a', fail, { retry: { ...retry, shouldRetry: () => true } }),
          { workflowName: 'w' },
        );
        const spans = await finished();
        expect(spans.filter((s) => s.name === 'attempt a')).toHaveLength(2);
        for (const span of spans) {
          expect(span.events.filter((e) => e.name === 'exception'), span.name).toHaveLength(1);
        }
      });

      it.each<[string, boolean]>([
        ['with no compensation', false],
        ['when a compensation fails', true],
      ])('keeps the cause a saga step returned on the saga span %s', async (_label, compensate) => {
        const cause = new Error('smtp down');
        const result = await runSaga(async ({ step }) => {
          if (compensate) await step('first', async () => ok(1), { compensate: async () => err({ type: 'UNDO_FAILED' }) });
          return step('send', async () => err({ type: 'SEND_FAILED' } as const, { cause }));
        });
        expect(result).toMatchObject({ ok: false, cause });

        const failed = (await finished()).filter((s) => ['saga', 'saga step send'].includes(s.name));
        expect(failed).toHaveLength(2);
        for (const span of failed) {
          expect(span.events.map((e) => e.attributes?.['exception.message']), span.name).toEqual(['smtp down']);
        }
      });

      it('records no exception for a returned error that step.fromResult maps', async () => {
        const save = async () => err(new HandWritten('a@b.c is taken'));
        await run(
          async ({ step }) => step.fromResult('a', save, { onError: () => MAPPED }),
          { workflowName: 'w' },
        );
        const spans = await exported();
        expect(spans).toHaveLength(2);
        for (const span of spans) expect(span.events).toEqual([]);
        expect(JSON.stringify(spans)).not.toContain('a@b.c');
      });
    });

    it('records a thrown SDK error on every attempt span, whatever its type field says', async () => {
      const thrown = Object.assign(new Error('Your card was declined'), { type: 'StripeCardError' });
      await run(
        async ({ step }) =>
          step('charge', async (): Promise<Result<string, never>> => { throw thrown; }, {
            retry: { attempts: 2, initialDelay: 1, shouldRetry: () => true },
          }),
        { workflowName: 'pay' },
      );

      const spans = await finished();
      const attempts = spans.filter((s) => s.name === 'attempt charge');
      expect(attempts).toHaveLength(2);
      for (const span of spans) {
        expect(span.status.message, span.name).toBe('Your card was declined');
        expect(span.events.find((e) => e.name === 'exception')?.attributes, span.name).toMatchObject({
          'exception.message': 'Your card was declined',
          'exception.stacktrace': thrown.stack,
        });
      }
    });

    it('keeps a returned typed error and a timeout off attempt span exceptions', async () => {
      const retry = { attempts: 2, initialDelay: 1, shouldRetry: () => true };
      await run(
        async ({ step }) => step('save', async () => err(new HandWritten('a@b.c is taken')), { retry }),
        { workflowName: 'signup' },
      );
      await run(
        async ({ step }) =>
          step('slow', () => new Promise<Result<string, never>>(() => {}), { retry, timeout: { ms: 5 } }),
        { workflowName: 'slow' },
      );

      const attempts = (await finished()).filter((s) => s.name.startsWith('attempt '));
      expect(attempts).toHaveLength(4);
      for (const span of attempts) {
        expect(span.status, span.name).toEqual({ code: SpanStatusCode.ERROR });
        expect(span.events, span.name).toEqual([]);
      }
    });

    it("keeps a thrown SDK error's message when the error has its own type field", async () => {
      const charge = async (): Promise<string> => {
        throw Object.assign(new Error('Your card was declined'), { type: 'StripeCardError' });
      };
      await run({ charge }, async (s) => s.charge(), { workflowName: 'pay' });

      for (const span of await finished()) expect(span.status.message).toBe('Your card was declined');
    });
  });

  it("records a typed error's Error cause: message and stack, still no payload", async () => {
    const cause = new Error('550 mailbox unavailable');
    await run(
      async ({ step }) => step('send', async () => err({ type: 'SEND_FAILED', email: 'a@b.c', cause })),
      { workflowName: 'mail' },
    );

    const step = (await finished()).find((s) => s.name === 'step send');
    expect(step?.status.message).toBe('550 mailbox unavailable');
    expect(step?.attributes['error.type']).toBe('SEND_FAILED');
    const [event] = step?.events ?? [];
    expect(event?.attributes).toEqual({
      'exception.type': 'SEND_FAILED',
      'exception.message': '550 mailbox unavailable',
      'exception.stacktrace': cause.stack,
    });
    expect(JSON.stringify(step?.attributes)).not.toContain('a@b.c');
  });
});
