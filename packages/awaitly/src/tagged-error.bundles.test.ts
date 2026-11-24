/**
 * Each public entry is bundled on its own (tsup `splitting: false`), so every
 * entry carries its own copy of tagged-error.ts.
 */
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const dist = (entry: string) => new URL(`../dist/${entry}.js`, import.meta.url);

describe('TaggedError across module copies', () => {
  it('recognizes an error made by another copy, and nothing else', async () => {
    const first = await import('./tagged-error');
    vi.resetModules();
    const second = await import('./tagged-error');
    expect(second.TaggedError).not.toBe(first.TaggedError);

    class EmailTaken extends first.TaggedError('EmailTaken')<{ email: string }> {}
    const error = new EmailTaken({ email: 'a@b.c' });
    expect(second.TaggedError.isTaggedError(error)).toBe(true);
    expect(error).toBeInstanceOf(second.TaggedError);

    const lookalike = Object.assign(new Error('x'), { type: 'EmailTaken', _tag: 'EmailTaken' });
    expect(second.TaggedError.isTaggedError(lookalike)).toBe(false);
    expect(second.TaggedError.isTaggedError({ type: 'EmailTaken' })).toBe(false);
  });

  // Hermetic: run after build to enforce, like the bundle budgets.
  describe.skipIf(!existsSync(dist('durable')))('built entries', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

    beforeAll(() => {
      context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
      trace.setGlobalTracerProvider(provider);
    });
    afterAll(async () => {
      await provider.shutdown();
      context.disable();
      trace.disable();
    });

    it('knows across entries that an awaitly run remapped a returned error', async () => {
      exporter.reset();
      const { run, err } = (await import(dist('index').href)) as typeof import('./index');
      const { runSaga } = (await import(dist('durable').href)) as typeof import('./saga');
      class HandWritten extends Error {
        readonly type = 'HandWritten';
      }
      const child = () =>
        run(async ({ step }) =>
          step.fromResult('save', async () => err(new HandWritten('a@b.c is taken')), { error: { type: 'MAPPED' } }),
          { workflowName: 'child' });
      await runSaga(async ({ step }) => step('child', child));

      const spans = exporter.getFinishedSpans();
      expect(spans).toHaveLength(4);
      expect(spans.flatMap((s) => s.events)).toEqual([]);
      expect(JSON.stringify(spans.map((s) => s.status))).not.toContain('a@b.c');
    });

    it("keeps a nested awaitly TaggedError's message out of awaitly/durable spans", async () => {
      exporter.reset();
      const { TaggedError, err } = (await import(dist('index').href)) as typeof import('./index');
      const { runSaga } = (await import(dist('durable').href)) as typeof import('./saga');
      class EmailTaken extends TaggedError('EmailTaken', {
        message: (p: { email: string }) => `${p.email} is taken`,
      }) {}
      const cause = new EmailTaken({ email: 'a@b.c' });

      await runSaga(async ({ step }) => step('save', async () => err({ type: 'SAVE_FAILED', cause })));
      await runSaga(async ({ step }) => step('save', async () => { throw cause; }));

      const spans = exporter.getFinishedSpans();
      expect(spans.map((s) => s.name)).toEqual(['saga step save', 'saga', 'saga step save', 'saga']);
      const exported = spans.map((s) => ({ status: s.status, attributes: s.attributes, events: s.events }));
      expect(JSON.stringify(exported)).not.toContain('a@b.c');
    });
  });
});
