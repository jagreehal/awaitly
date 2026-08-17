import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { isTelemetryEnabled, setTelemetryEnabled } from './opentelemetry';
import { err, ok } from '../result';
import { run } from '../run-entry';
import { runSaga } from '../saga-entry';
import { createWorkflow } from '../workflow-entry';

describe('automatic OpenTelemetry tracing', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager();

  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
    trace.setGlobalTracerProvider(provider);
  });

  beforeEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await provider.shutdown();
    context.disable();
    trace.disable();
  });

  it('parents instrumented work under the active step and run spans', async () => {
    const childTracer = trace.getTracer('awaitly-test-child');

    const result = await run(
      async ({ step }) => {
        return step('load-user', () =>
          childTracer.startActiveSpan('database query', async (span) => {
            await Promise.resolve();
            span.end();
            return ok({ id: 'user-1' });
          }),
        );
      },
      { workflowId: 'run-1', workflowName: 'load-profile' },
    );

    expect(result).toEqual(ok({ id: 'user-1' }));
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find((span) => span.name === 'run load-profile');
    const stepSpan = spans.find((span) => span.name === 'step load-user');
    const childSpan = spans.find((span) => span.name === 'database query');

    expect(runSpan?.attributes).toMatchObject({
      'awaitly.workflow.id': 'run-1',
      'awaitly.workflow.name': 'load-profile',
      'awaitly.outcome': 'success',
    });
    expect(stepSpan?.parentSpanContext?.spanId).toBe(
      runSpan?.spanContext().spanId,
    );
    expect(childSpan?.parentSpanContext?.spanId).toBe(
      stepSpan?.spanContext().spanId,
    );
  });

  it('records each physical retry attempt and preserves the typed error', async () => {
    let attempts = 0;

    const result = await run(
      async ({ step }) =>
        step(
          'fetch-user',
          async () => {
            attempts++;
            return attempts === 1
              ? err({ type: 'UPSTREAM_BUSY', retryable: true })
              : ok({ id: 'user-1' });
          },
          {
            retry: {
              attempts: 2,
              initialDelay: 0,
              jitter: false,
            },
          },
        ),
      { workflowId: 'retry-1', workflowName: 'retry-profile' },
    );

    expect(result).toEqual(ok({ id: 'user-1' }));
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const stepSpan = spans.find((span) => span.name === 'step fetch-user');
    const attemptSpans = spans
      .filter((span) => span.name === 'attempt fetch-user')
      .sort(
        (left, right) =>
          Number(left.attributes['awaitly.step.attempt']) -
          Number(right.attributes['awaitly.step.attempt']),
      );

    expect(attemptSpans).toHaveLength(2);
    expect(attemptSpans[0]?.attributes).toMatchObject({
      'awaitly.step.attempt': 1,
      'awaitly.step.max_attempts': 2,
      'awaitly.outcome': 'error',
      'error.type': 'UPSTREAM_BUSY',
    });
    expect(attemptSpans[1]?.attributes).toMatchObject({
      'awaitly.step.attempt': 2,
      'awaitly.outcome': 'success',
    });
    expect(attemptSpans[0]?.parentSpanContext?.spanId).toBe(
      stepSpan?.spanContext().spanId,
    );
    expect(attemptSpans[1]?.parentSpanContext?.spanId).toBe(
      stepSpan?.spanContext().spanId,
    );
  });

  it('marks typed Result failures on both step and run spans', async () => {
    const result = await run(
      async ({ step }) =>
        step('load-user', async () => err({ type: 'USER_NOT_FOUND' })),
      { workflowId: 'error-1', workflowName: 'error-profile' },
    );

    expect(result).toEqual(err({ type: 'USER_NOT_FOUND' }));
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find((span) => span.name === 'run error-profile');
    const stepSpan = spans.find((span) => span.name === 'step load-user');

    expect(runSpan?.attributes).toMatchObject({
      'awaitly.outcome': 'error',
      'error.type': 'USER_NOT_FOUND',
    });
    expect(stepSpan?.attributes).toMatchObject({
      'awaitly.outcome': 'error',
      'error.type': 'USER_NOT_FOUND',
    });
  });

  it('lets a run opt out without changing the execution API', async () => {
    const result = await run(
      async ({ step }) => step('quiet-step', async () => ok('done')),
      {
        workflowId: 'quiet-1',
        workflowName: 'quiet-run',
        telemetry: false,
      },
    );

    expect(result).toEqual(ok('done'));
    await provider.forceFlush();
    expect(exporter.getFinishedSpans()).toEqual([]);
  });

  it('records cancellation as a distinct outcome instead of an error', async () => {
    const controller = new AbortController();
    let markStepStarted: (() => void) | undefined;
    const stepStarted = new Promise<void>((resolve) => {
      markStepStarted = resolve;
    });
    const workflow = createWorkflow('cancel-profile', {});

    const pending = workflow.run(
      async ({ step, ctx }) =>
        step(
          'wait-for-abort',
          async () => {
            markStepStarted?.();
            await new Promise<void>((_resolve, reject) => {
              ctx.signal?.addEventListener(
                'abort',
                () => reject(new DOMException('cancelled', 'AbortError')),
                { once: true },
              );
            });
            return ok('unreachable');
          },
          { retry: { attempts: 2, initialDelay: 0 } },
        ),
      { signal: controller.signal },
    );

    await stepStarted;
    controller.abort('request closed');
    const result = await pending;

    expect(result.ok).toBe(false);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const runSpan = spans.find((span) => span.name === 'run cancel-profile');
    const stepSpan = spans.find((span) => span.name === 'step wait-for-abort');
    const attemptSpan = spans.find(
      (span) => span.name === 'attempt wait-for-abort',
    );

    expect(runSpan?.attributes['awaitly.outcome']).toBe('cancelled');
    expect(stepSpan?.attributes['awaitly.outcome']).toBe('cancelled');
    expect(runSpan?.status.code).toBe(0);
    expect(stepSpan?.status.code).toBe(0);
    expect(attemptSpan?.attributes['awaitly.outcome']).toBe('cancelled');
    expect(attemptSpan?.status.code).toBe(0);
  });

  it('traces low-level saga steps and compensation in rollback order', async () => {
    const result = await runSaga(async ({ step }) => {
      await step('reserve', async () => ok('reservation-1'), {
        compensate: async () => ok(undefined),
      });
      return step('charge', async () => err({ type: 'CARD_DECLINED' }));
    });

    expect(result.ok).toBe(false);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const sagaSpan = spans.find((span) => span.name === 'saga');
    const reserveSpan = spans.find((span) => span.name === 'saga step reserve');
    const chargeSpan = spans.find((span) => span.name === 'saga step charge');
    const compensateSpan = spans.find(
      (span) => span.name === 'compensate reserve',
    );

    expect(sagaSpan?.attributes).toMatchObject({
      'awaitly.outcome': 'error',
      'error.type': 'CARD_DECLINED',
    });
    expect(reserveSpan?.parentSpanContext?.spanId).toBe(
      sagaSpan?.spanContext().spanId,
    );
    expect(chargeSpan?.attributes['error.type']).toBe('CARD_DECLINED');
    expect(compensateSpan?.attributes['awaitly.outcome']).toBe('success');
    expect(compensateSpan?.parentSpanContext?.spanId).toBe(
      sagaSpan?.spanContext().spanId,
    );
  });

  it('keeps workflow compensation inside the run span', async () => {
    const workflow = createWorkflow('workflow-saga', {});

    const result = await workflow.run(async ({ step }) => {
      await step('reserve-stock', async () => ok('reservation-1'), {
        compensate: async () => ok(undefined),
      });
      return step('charge-card', async () => err({ type: 'CARD_DECLINED' }));
    });

    expect(result.ok).toBe(false);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const runSpans = spans.filter((span) => span.name === 'run workflow-saga');
    const compensateSpan = spans.find(
      (span) => span.name === 'compensate reserve-stock',
    );

    expect(runSpans).toHaveLength(1);
    expect(compensateSpan?.parentSpanContext?.spanId).toBe(
      runSpans[0]?.spanContext().spanId,
    );
  });

  it('makes parallel scopes the parent of work started inside them', async () => {
    const childTracer = trace.getTracer('awaitly-test-parallel');

    const result = await run(
      async ({ step }) =>
        step.all('load-dashboard', {
          profile: () =>
            childTracer.startActiveSpan('fetch profile', (span) => {
              span.end();
              return ok('profile');
            }),
          activity: () => ok('activity'),
        }),
      { workflowId: 'parallel-1', workflowName: 'dashboard' },
    );

    expect(result.ok).toBe(true);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const scopeSpan = spans.find(
      (span) => span.name === 'parallel load-dashboard',
    );
    const childSpan = spans.find((span) => span.name === 'fetch profile');

    expect(scopeSpan?.attributes).toMatchObject({
      'awaitly.scope.type': 'parallel',
      'awaitly.scope.name': 'load-dashboard',
      'awaitly.outcome': 'success',
    });
    expect(childSpan?.parentSpanContext?.spanId).toBe(
      scopeSpan?.spanContext().spanId,
    );
  });

  it('keeps concurrent runs in separate trace trees', async () => {
    const childTracer = trace.getTracer('awaitly-test-concurrency');
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const execute = (workflowId: string) =>
      run(
        async ({ step }) =>
          step('shared-name', async () => {
            await gate;
            return childTracer.startActiveSpan(
              `child ${workflowId}`,
              (span) => {
                span.end();
                return ok(workflowId);
              },
            );
          }),
        { workflowId, workflowName: 'concurrent' },
      );

    const first = execute('run-a');
    const second = execute('run-b');
    release?.();
    await Promise.all([first, second]);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    for (const workflowId of ['run-a', 'run-b']) {
      const runSpan = spans.find(
        (span) =>
          span.attributes['awaitly.workflow.id'] === workflowId &&
          span.name === 'run concurrent',
      );
      const stepSpan = spans.find(
        (span) =>
          span.attributes['awaitly.workflow.id'] === workflowId &&
          span.name === 'step shared-name',
      );
      const childSpan = spans.find(
        (span) => span.name === `child ${workflowId}`,
      );

      expect(stepSpan?.parentSpanContext?.spanId).toBe(
        runSpan?.spanContext().spanId,
      );
      expect(childSpan?.parentSpanContext?.spanId).toBe(
        stepSpan?.spanContext().spanId,
      );
    }
  });

  it('traces error-mapping step variants as normal steps', async () => {
    const result = await run(
      async ({ step }) => {
        const parsed = await step.try('parse', async () => 42, {
          error: { type: 'PARSE_FAILED' as const },
        });
        return step.fromResult('validate', async () => ok(parsed), {
          onError: () => ({ type: 'INVALID' as const }),
        });
      },
      { workflowId: 'variants-1', workflowName: 'variants' },
    );

    expect(result).toEqual(ok(42));
    await provider.forceFlush();
    const names = exporter.getFinishedSpans().map((span) => span.name);
    expect(names).toContain('step parse');
    expect(names).toContain('step validate');
  });

  it('leaves span status UNSET on success so callers can set it themselves', async () => {
    await run(async ({ step }) => step('fine', async () => ok('yes')), {
      workflowId: 'status-1',
      workflowName: 'status',
    });
    await provider.forceFlush();

    const runSpan = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'run status');

    // SpanStatusCode.UNSET. The spec reserves OK for the application, and a
    // status set by instrumentation cannot be overridden afterwards.
    expect(runSpan?.status.code).toBe(0);
    expect(runSpan?.attributes['awaitly.outcome']).toBe('success');
  });

  describe('turning tracing off for the whole process', () => {
    afterEach(() => {
      setTelemetryEnabled(true);
    });

    it('stops emitting spans after setTelemetryEnabled(false)', async () => {
      setTelemetryEnabled(false);

      const result = await run(
        async ({ step }) => step('silent', async () => ok('done')),
        { workflowId: 'off-1', workflowName: 'off' },
      );

      expect(result).toEqual(ok('done'));
      await provider.forceFlush();
      expect(exporter.getFinishedSpans()).toEqual([]);
    });

    it('lets a single run opt back in while the process default is off', async () => {
      setTelemetryEnabled(false);

      await run(async ({ step }) => step('loud', async () => ok('done')), {
        workflowId: 'on-1',
        workflowName: 'on',
        telemetry: true,
      });

      await provider.forceFlush();
      const names = exporter.getFinishedSpans().map((span) => span.name);
      expect(names).toContain('run on');
      expect(names).toContain('step loud');
    });

    it('reports the current setting', () => {
      expect(isTelemetryEnabled()).toBe(true);
      setTelemetryEnabled(false);
      expect(isTelemetryEnabled()).toBe(false);
    });
  });
});
