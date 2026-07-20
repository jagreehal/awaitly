import { describe, it, expect } from 'vitest';
import plugin from '../src/index.js';
import { ALL_SLUGS, isAwaitlySlug } from '../../awaitly/src/slugs';
import { STRICT_RULE_TO_SLUG } from '../../awaitly-analyze/src/strict-diagnostics';

const CANONICAL_LINT_SLUGS = [
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
  'workflow-prefer-step-if',
  'workflow-prefer-step-foreach',
  'result-no-floating',
  'result-require-handling',
  'result-no-double-wrap',
  'result-no-manual-propagation',
  'result-no-direct-ok-err',
  'concurrency-no-promise-all',
  'concurrency-no-promise-race',
  'concurrency-no-promise-allsettled',
  'error-check-unexpected-first',
] as const;

describe('spine parity', () => {
  it('canonical lint slugs are all registered in awaitly slugs.ts', () => {
    for (const slug of CANONICAL_LINT_SLUGS) {
      expect(isAwaitlySlug(slug), `${slug} missing from awaitly slugs`).toBe(true);
    }
  });

  it('plugin exports canonical lint rule keys for each canonical lint slug', () => {
    const keys = Object.keys(plugin.rules ?? {});
    for (const slug of CANONICAL_LINT_SLUGS) {
      expect(keys).toContain(slug);
    }
  });

  it('analyzer strict diagnostics map only to canonical registered slugs', () => {
    const analyzerCodes = Object.values(STRICT_RULE_TO_SLUG);
    for (const code of analyzerCodes) {
      expect(isAwaitlySlug(code), `analyzer code not in slugs.ts: ${code}`).toBe(true);
    }
  });

  it('slugs namespace still includes runtime slugs (sanity)', () => {
    expect(ALL_SLUGS.some((s) => s.startsWith('runtime-'))).toBe(true);
  });
});
