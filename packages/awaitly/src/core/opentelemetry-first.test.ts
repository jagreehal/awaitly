/**
 * The OpenTelemetry features beyond plain spans: call sites, metrics, span
 * events, inherited attributes, typed-error exception events, incoming trace
 * context, and the span-tree test helper.
 */
import { context, metrics, propagation, trace, type Attributes } from '@opentelemetry/api';
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
    expect(step?.attributes['code.function.name']).toBe('profile');

    const runSpan = spans.find((s) => s.name === 'run profile');
    expect(runSpan?.attributes['code.file.path']).toMatch(/opentelemetry-first\.test\.ts$/);
    // Multi-line call: V8 reports the line the call expression starts on.
    expect(runSpan?.attributes['code.line.number']).toBeLessThanOrEqual(lineOf('run-line'));
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

  it('records a typed error as an exception event carrying only its type', async () => {
    await run(
      async ({ step }) => step('charge', async () => err({ type: 'CARD_DECLINED', card: '4242' })),
      { workflowName: 'checkout' },
    );

    const step = (await finished()).find((s) => s.name === 'step charge');
    expect(step?.events).toEqual([
      expect.objectContaining({ name: 'exception', attributes: { 'exception.type': 'CARD_DECLINED' } }),
    ]);
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
});
