import { describe, it, expect } from 'vitest';
import plugin from '../../eslint-plugin-awaitly/src/index';
import { STRICT_RULE_TO_SLUG } from '../../awaitly-analyze/src/strict-diagnostics';
import { createVisualizer } from '../../awaitly-visualizer/src/index';
import { ALL_SLUGS, isAwaitlySlug } from './slugs';

function expectSetEqual(actual: Set<string>, expected: Set<string>, label: string): void {
  expect(Array.from(actual).sort(), `${label} set mismatch`).toEqual(
    Array.from(expected).sort()
  );
}

const EXPECTED_LINT_SLUGS = new Set([
  'step-require-id',
  'step-no-immediate-execution',
  'step-require-thunk-for-key',
  'step-stable-cache-keys',
  'step-no-bare-await',
  'step-no-try-catch-wrap',
  'workflow-no-floating',
  'workflow-options-position',
  'workflow-callback-shape',
  'workflow-no-callable-form',
  'workflow-no-dynamic-import',
  'result-no-floating',
  'result-require-handling',
  'result-no-double-wrap',
  'result-no-manual-propagation',
  'result-no-direct-ok-err',
  'concurrency-no-promise-all',
  'concurrency-no-promise-race',
  'concurrency-no-promise-allsettled',
  'error-check-unexpected-first',
]);

describe('spine cross-surface parity', () => {
  it('plugin canonical rule IDs exactly match expected lint slugs', () => {
    const pluginCanonical = new Set(
      Object.keys(plugin.rules ?? {}).filter((k) => isAwaitlySlug(k))
    );
    expectSetEqual(pluginCanonical, EXPECTED_LINT_SLUGS, 'plugin canonical lint slugs');
  });

  it('analyzer strict diagnostic codes are canonical and exactly expected', () => {
    const analyzerCodes = new Set(Object.values(STRICT_RULE_TO_SLUG));
    for (const code of analyzerCodes) {
      expect(isAwaitlySlug(code)).toBe(true);
    }
    // After the strict-diagnostics slug remap, the analyzer's range is the
    // three core spine slugs that genuinely apply to its diagnostics. The
    // earlier mapping forced loop/conditional concepts onto
    // `workflow-callback-shape`, which was a poor semantic fit.
    const expectedAnalyzerCodes = new Set([
      'step-require-id',
      'result-require-handling',
      'workflow-options-position',
    ]);
    expectSetEqual(analyzerCodes, expectedAnalyzerCodes, 'analyzer strict codes');
  });

  it('visualizer preserves every runtime-* slug code through workflow_error events', () => {
    const runtimeSlugs = ALL_SLUGS.filter((s) => s.startsWith('runtime-'));
    const seen = new Set<string>();

    for (const slug of runtimeSlugs) {
      const viz = createVisualizer({ workflowName: 'wf' });
      const now = Date.now();
      viz.handleEvent({ type: 'workflow_start', workflowId: `wf-${slug}`, ts: now });
      viz.handleEvent({
        type: 'workflow_error',
        workflowId: `wf-${slug}`,
        ts: now + 1,
        durationMs: 1,
        error: {
          _tag: 'SyntheticRuntimeError',
          code: slug,
          hint: 'Synthetic hint',
          docsUrl: `https://jagreehal.github.io/awaitly/rules/#`,
        },
      });

      const ir = viz.getIR();
      const code = (ir.root.error as { code?: string } | undefined)?.code;
      if (code) seen.add(code);
    }

    expectSetEqual(seen, new Set(runtimeSlugs), 'visualizer runtime slug coverage');
  });

  it('all cross-surface codes are contained in slugs.ts', () => {
    const pluginCanonical = Object.keys(plugin.rules ?? {}).filter((k) => isAwaitlySlug(k));
    const analyzerCodes = Object.values(STRICT_RULE_TO_SLUG);

    for (const code of [...pluginCanonical, ...analyzerCodes]) {
      expect(isAwaitlySlug(code)).toBe(true);
    }
  });
});
