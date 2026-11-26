/**
 * The OpenTelemetry features beyond plain spans: call sites, metrics, span
 * events, inherited attributes, typed-error exception events, incoming trace
 * context, and the span-tree test helper.
 */
import { context, metrics, propagation, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { annotateSpan } from './opentelemetry';
import { err, ok } from '../result';
import { run } from '../run-entry';
import { createWorkflow } from '../workflow-entry';
import { createEventHandler, createWebhookHandler } from '../webhook';
import { formatSpanTree } from '../testing';

/** Records every measurement; the metrics SDK isn't a dependency here. */
const measurements: Array<{ name: string; value: number; attributes: Attributes }> = [];
const instrument = (name: string) => ({
  record: (value: number, attributes: Attributes = {}) => measurements.push({ name, value, attributes }),
  add: (value: number, attributes: Attributes = {}) => measurements.push({ name, value, attributes }),
});
const meterProvider = {
  getMeter: () => ({ createHistogram: instrument, createCounter: instrument }),
} as unknown as Parameters<typeof metrics.setGlobalMeterProvider>[0];

describe('OpenTelemetry beyond spans', () => {
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
    metrics.setGlobalMeterProvider(meterProvider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  beforeEach(() => {
    exporter.reset();
    measurements.length = 0;
  });

  afterAll(async () => {
    await provider.shutdown();
    context.disable();
    trace.disable();
    metrics.disable();
    propagation.disable();
  });

  it('records the line of your code that started each run and step', async () => {
    const load = async () => ok('user');
    await run({ load }, async function profile(s) {
      return s.load(); // load-line
    }, { workflowName: 'profile' }); // run-line

    const spans = await finished();
    const source = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('\n');
    const lineOf = (marker: string) => source.findIndex((l) => l.includes(`// ${marker}`)) + 1;

    const step = spans.find((s) => s.name === 'step load');
    expect(step?.attributes['code.file.path']).toMatch(/opentelemetry-first\.test\.ts$/);
    expect(step?.attributes['code.line.number']).toBe(lineOf('load-line'));

    const runSpan = spans.find((s) => s.name === 'run profile');
    expect(runSpan?.attributes['code.file.path']).toMatch(/opentelemetry-first\.test\.ts$/);
    // Multi-line call: V8 reports the line the call expression starts on.
    expect(runSpan?.attributes['code.line.number']).toBeLessThanOrEqual(lineOf('run-line'));
  });

  it('names the function that called a step, not the callback awaitly called', async () => {
    const load = async () => ok('user');
    async function loadProfile(s: { load: typeof load }) {
      return s.load();
    }
    // V8 names this arrow `run.workflowName`, after the options object beside it.
    await run({ load }, async (s) => s.load(), { workflowName: 'inline' });
    await run({ load }, async (s) => loadProfile(s), { workflowName: 'helper' });

    const [inline, helper] = (await finished()).filter((s) => s.name === 'step load');
    expect(inline?.attributes['code.line.number']).toBeTypeOf('number');
    expect(inline?.attributes).not.toHaveProperty('code.function.name');
    expect(helper?.attributes['code.function.name']).toBe('loadProfile');
  });

  it('leaves the inline callback unnamed for a step after an await, in concurrent runs', async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
    const find = async () => { await tick(); return ok('user'); };
    const send = async () => { await tick(); return ok(undefined); };
    const sendTo = () =>
      run({ find, send }, async (s) => {
        await s.find();
        await s.send(); // send-line
      }, { workflowName: 'send_user' });

    for (let round = 0; round < 10; round++) {
      await run(async () => { await Promise.all([sendTo(), sendTo(), sendTo(), sendTo(), sendTo()]); }, { workflowName: 'batch' });
    }

    const source = (await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8').split('\n');
    const sendLine = source.findIndex((l) => l.includes('// send-line')) + 1;
    const sends = (await finished()).filter((s) => s.name === 'step send');
    expect(sends).toHaveLength(50);
    for (const span of sends) {
      expect(span.attributes['code.file.path']).toMatch(/opentelemetry-first\.test\.ts$/);
      expect(span.attributes['code.line.number']).toBe(sendLine);
      expect(span.attributes).not.toHaveProperty('code.function.name');
    }
  });

  it('names a helper that calls a step after an await', async () => {
    const load = async () => ok('user');
    async function loadProfile(s: { load: typeof load }) {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return s.load();
    }
    // Awaited, so the callback stays in V8's async frames between the helper and awaitly.
    await run({ load }, async (s) => { await loadProfile(s); }, { workflowName: 'helper' });

    const step = (await finished()).find((s) => s.name === 'step load');
    expect(step?.attributes['code.function.name']).toBe('loadProfile');
  });

  it('keeps the name of a function process.nextTick calls inside the run', async () => {
    const load = async () => ok('user');
    await run(
      { load },
      (s) => new Promise((resolve) => process.nextTick(function onTick() { resolve(s.load()); })),
      { workflowName: 'tick' },
    );

    const step = (await finished()).find((s) => s.name === 'step load');
    expect(step?.attributes['code.function.name']).toBe('onTick');
  });

  it('keeps the name of a function a built-in calls, like Array.map', async () => {
    const load = async () => ok('user');
    function loadEach(s: { load: typeof load }) {
      return s.load();
    }
    await run({ load }, async (s) => { await Promise.all([s].map(loadEach)); }, { workflowName: 'map' });

    const step = (await finished()).find((s) => s.name === 'step load');
    expect(step?.attributes['code.function.name']).toBe('loadEach');
  });

  it('keeps the name of a function a timer calls inside the run', async () => {
    const load = async () => ok('user');
    await run(
      { load },
      (s) => new Promise((resolve) => setTimeout(function onTick() { resolve(s.load()); }, 0)),
      { workflowName: 'timer' },
    );

    const step = (await finished()).find((s) => s.name === 'step load');
    expect(step?.attributes['code.function.name']).toContain('onTick');
  });

  it('keeps a method name', async () => {
    const load = async () => ok('user');
    class Profiles {
      async load() {
        return run({ load }, (s) => s.load(), { workflowName: 'method' });
      }
    }
    await new Profiles().load();

    const runSpan = (await finished()).find((s) => s.name === 'run method');
    expect(runSpan?.attributes['code.function.name']).toBe('Profiles.load');
  });

  it('records run and step durations and retries as metrics', async () => {
    let calls = 0;
    await run(
      async ({ step }) =>
        step(
          'charge',
          async () => (++calls === 1 ? err({ type: 'BUSY' }) : ok('paid')),
          { retry: { attempts: 2, initialDelay: 0, jitter: false } },
        ),
      { workflowName: 'checkout' },
    );
    await run(async ({ step }) => step('charge', async () => err({ type: 'DECLINED' })), {
      workflowName: 'checkout',
    });

    const byName = (name: string) => measurements.filter((m) => m.name === name);
    expect(byName('awaitly.workflow.duration').map((m) => m.attributes)).toEqual([
      { 'awaitly.workflow.name': 'checkout', 'awaitly.outcome': 'success' },
      { 'awaitly.workflow.name': 'checkout', 'awaitly.outcome': 'error', 'error.type': 'DECLINED' },
    ]);
    expect(byName('awaitly.step.duration').map((m) => m.attributes)).toEqual([
      { 'awaitly.workflow.name': 'checkout', 'awaitly.step.name': 'charge', 'awaitly.outcome': 'success' },
      {
        'awaitly.workflow.name': 'checkout',
        'awaitly.step.name': 'charge',
        'awaitly.outcome': 'error',
        'error.type': 'DECLINED',
      },
    ]);
    expect(byName('awaitly.step.retries')).toEqual([
      {
        name: 'awaitly.step.retries',
        value: 1,
        attributes: { 'awaitly.workflow.name': 'checkout', 'awaitly.step.name': 'charge', 'error.type': 'BUSY' },
      },
    ]);
    for (const m of byName('awaitly.workflow.duration')) expect(m.value).toBeGreaterThanOrEqual(0);
  });

  it('records a cache hit as a span event on the run', async () => {
    const cache = new Map();
    const wf = createWorkflow('cached', { load: async () => ok('v') }, { cache });
    await wf.run(async ({ step, deps }) => step('load', () => deps.load(), { key: 'user:1' }));
    exporter.reset();
    await wf.run(async ({ step, deps }) => step('load', () => deps.load(), { key: 'user:1' }));

    const cacheRun = (await finished()).find((s) => s.name === 'run cached');
    expect(cacheRun?.events.map((e) => [e.name, e.attributes])).toEqual([
      ['awaitly.step.cache_hit', { 'awaitly.step.name': 'load', 'awaitly.step.key': 'user:1' }],
    ]);
  });

  it('puts retry and decision events on the span they happened in', async () => {
    let calls = 0;
    await run(
      async ({ step }) => {
        if (step.if('big-order', 'total > 100', () => true)) {
          await step(
            'charge',
            async () => (++calls === 1 ? err({ type: 'BUSY' }) : ok('paid')),
            { retry: { attempts: 2, initialDelay: 0, jitter: false } },
          );
        }
      },
      { workflowName: 'checkout' },
    );

    const spans = await finished();
    const runSpan = spans.find((s) => s.name === 'run checkout');
    const step = spans.find((s) => s.name === 'step charge');
    expect(runSpan?.events.map((e) => [e.name, e.attributes])).toEqual([
      [
        'awaitly.decision',
        {
          'awaitly.decision.id': 'big-order',
          'awaitly.decision.branch': 'then',
          'awaitly.decision.label': 'total > 100',
        },
      ],
    ]);
    expect(step?.events.map((e) => e.name)).toContain('awaitly.step.retry');
    expect(step?.events.find((e) => e.name === 'awaitly.step.retry')?.attributes).toMatchObject({
      'awaitly.step.name': 'charge',
      // The attempt about to run.
      'awaitly.step.attempt': 2,
      'error.type': 'BUSY',
    });
  });

  it('gives every span in a run its attributes, nested runs included, and annotateSpan sets one span', async () => {
    const child = createWorkflow('child', { ping: async () => ok('pong') });
    await run(
      async ({ step }) => {
        await step('outer', async () => {
          annotateSpan({ 'payment.provider': 'stripe' });
          return ok(1);
        });
        await child.run(async ({ step, deps }) => step('ping', () => deps.ping()));
      },
      { workflowName: 'parent', attributes: { 'tenant.id': 't-1' } },
    );

    const spans = await finished();
    for (const name of ['run parent', 'step outer', 'run child', 'step ping']) {
      expect(spans.find((s) => s.name === name)?.attributes['tenant.id'], name).toBe('t-1');
    }
    expect(spans.find((s) => s.name === 'step outer')?.attributes['payment.provider']).toBe('stripe');
    expect(spans.find((s) => s.name === 'run parent')?.attributes['payment.provider']).toBeUndefined();
  });

  it('records a typed error as ERROR and its type, with no exception event', async () => {
    await run(
      async ({ step }) => step('charge', async () => err({ type: 'CARD_DECLINED', card: '4242' })),
      { workflowName: 'checkout' },
    );

    const step = (await finished()).find((s) => s.name === 'step charge');
    expect(step?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(step?.attributes['error.type']).toBe('CARD_DECLINED');
    expect(step?.events).toEqual([]);
  });

  it('records what your code threw, not the UnexpectedError wrapping it', async () => {
    class MongoServerSelectionError extends Error {
      override name = 'MongoServerSelectionError';
    }
    const thrown = new MongoServerSelectionError('Server selection timed out');
    const find = async (): Promise<string> => {
      throw thrown;
    };
    await run({ find }, async (s) => s.find(), { workflowName: 'lookup' });

    for (const name of ['run lookup', 'step find']) {
      const span = (await finished()).find((s) => s.name === name);
      expect(span?.attributes['error.type'], name).toBe('UnexpectedError');
      expect(span?.status.message, name).toBe('Server selection timed out');
      expect(span?.events[0]?.attributes, name).toEqual({
        'exception.type': 'MongoServerSelectionError',
        'exception.message': 'Server selection timed out',
        'exception.stacktrace': thrown.stack,
      });
    }
  });

  const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
  const traceparent = `00-${TRACE_ID}-00f067aa0ba902b7-01`;

  it('continues the caller trace from a webhook request traceparent header', async () => {
    const wf = createWorkflow('signup', { save: async () => ok('saved') });
    const handler = createWebhookHandler(wf, ({ step, deps }) => step('save', () => deps.save()), {
      validateInput: () => ok({}),
      mapResult: () => ({ status: 200, body: {} }),
    });

    await handler({ method: 'POST', path: '/', headers: { Traceparent: traceparent }, body: {}, query: {}, params: {} });

    const runSpan = (await finished()).find((s) => s.name === 'run signup');
    expect(runSpan?.spanContext().traceId).toBe(TRACE_ID);
    expect(runSpan?.parentSpanContext?.spanId).toBe('00f067aa0ba902b7');
  });

  it('continues the producer trace from event metadata, and keeps an active server span as parent', async () => {
    const wf = createWorkflow('on-order', { save: async () => ok('saved') });
    const handler = createEventHandler(wf, ({ step, deps }) => step('save', () => deps.save()), {
      validatePayload: (event) => ok(event.payload),
      mapResult: () => ({ success: true, ack: true }),
    });
    await handler({ id: '1', type: 'order', payload: {}, metadata: { traceparent } });
    expect((await finished()).find((s) => s.name === 'run on-order')?.spanContext().traceId).toBe(TRACE_ID);

    exporter.reset();
    await trace.getTracer('http').startActiveSpan('POST /orders', async (server) => {
      await handler({ id: '2', type: 'order', payload: {}, metadata: { traceparent } });
      server.end();
    });
    const spans = await finished();
    const server = spans.find((s) => s.name === 'POST /orders');
    const runSpan = spans.find((s) => s.name === 'run on-order');
    expect(runSpan?.parentSpanContext?.spanId).toBe(server?.spanContext().spanId);
  });

  it('formats the span tree for inline snapshots', async () => {
    await run(
      async ({ step }) => {
        await step('load', async () => ok(1));
        await step('charge', async () => err({ type: 'CARD_DECLINED' }));
      },
      { workflowName: 'checkout' },
    );

    expect(formatSpanTree(await finished())).toMatchInlineSnapshot(`
      "run checkout ✗ CARD_DECLINED
        step load
        step charge ✗ CARD_DECLINED"
    `);
  });

  it('gives each step.allSettled operation a span, inside a scope that succeeds', async () => {
    await run(
      async ({ step }) =>
        step.allSettled('checks', {
          name: async () => ok('Ada'),
          age: async () => err({ type: 'TOO_YOUNG' }),
        }),
      { workflowName: 'preview' },
    );

    expect(formatSpanTree(await finished())).toMatchInlineSnapshot(`
      "run preview
        allSettled checks
          step checks.name
          step checks.age ✗ TOO_YOUNG"
    `);
  });
});
