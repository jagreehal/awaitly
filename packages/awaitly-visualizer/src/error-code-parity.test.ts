import { describe, it, expect } from 'vitest';
import { createVisualizer } from './index';
import { isAwaitlySlug } from '../../awaitly/src/slugs';

describe('visualizer error code parity', () => {
  it('preserves awaitly error code on step_error nodes', () => {
    const viz = createVisualizer({ workflowName: 'wf' });
    const now = Date.now();

    viz.handleEvent({ type: 'workflow_start', workflowId: 'wf-1', ts: now });
    viz.handleEvent({ type: 'step_start', workflowId: 'wf-1', stepId: 's1', name: 'step1', ts: now + 1 });
    viz.handleEvent({
      type: 'step_error',
      workflowId: 'wf-1',
      stepId: 's1',
      name: 'step1',
      ts: now + 2,
      durationMs: 1,
      error: {
        _tag: 'TimeoutError',
        code: 'runtime-step-timeout',
        hint: 'Increase timeout.',
        docsUrl: 'https://jagreehal.github.io/awaitly/rules/#runtime-step-timeout',
      },
    });

    const ir = viz.getIR();
    const step = ir.root.children.find((n) => n.type === 'step' && n.id === 's1');
    expect(step).toBeDefined();
    if (step && step.type === 'step') {
      const err = step.error as { code?: string } | undefined;
      expect(err?.code).toBe('runtime-step-timeout');
      expect(isAwaitlySlug(err!.code!)).toBe(true);
    }
  });

  it('preserves awaitly error code on workflow_error root', () => {
    const viz = createVisualizer({ workflowName: 'wf' });
    const now = Date.now();

    viz.handleEvent({ type: 'workflow_start', workflowId: 'wf-1', ts: now });
    viz.handleEvent({
      type: 'workflow_error',
      workflowId: 'wf-1',
      ts: now + 5,
      durationMs: 5,
      error: {
        _tag: 'UnexpectedError',
        code: 'runtime-unexpected',
        hint: 'Check cause and normalize.',
        docsUrl: 'https://jagreehal.github.io/awaitly/rules/#runtime-unexpected',
      },
    });

    const ir = viz.getIR();
    const err = ir.root.error as { code?: string } | undefined;
    expect(err?.code).toBe('runtime-unexpected');
    expect(isAwaitlySlug(err!.code!)).toBe(true);
  });
});
