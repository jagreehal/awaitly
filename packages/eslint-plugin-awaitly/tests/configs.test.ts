import type { Linter } from 'eslint';
import { describe, it, expect } from 'vitest';
import plugin from '../src/index.js';

describe('plugin configs', () => {
  it('exposes canonical slug rule keys', () => {
    const keys = Object.keys(plugin.rules ?? {});
    const canonical = [
      'step-no-immediate-execution',
      'step-require-id',
      'step-require-thunk-for-key',
      'step-stable-cache-keys',
      'step-no-bare-await',
      'step-no-try-catch-wrap',
      'workflow-no-floating',
      'workflow-no-callable-form',
      'workflow-callback-shape',
      'result-no-floating',
      'result-require-handling',
      'workflow-options-position',
      'result-no-double-wrap',
      'workflow-no-dynamic-import',
      'result-no-manual-propagation',
      'result-no-direct-ok-err',
      'concurrency-no-promise-all',
      'concurrency-no-promise-race',
      'concurrency-no-promise-allsettled',
      'error-check-unexpected-first',
    ];
    for (const key of canonical) {
      expect(keys).toContain(key);
    }
  });

  it('exports recommended-strict with all rules set to error', () => {
    const strict = plugin.configs?.['recommended-strict'] as
      | Linter.Config[]
      | undefined;
    expect(strict).toBeDefined();
    expect(Array.isArray(strict)).toBe(true);

    const first = strict?.[0];
    const rules = first?.rules as Record<string, string> | undefined;

    expect(rules['awaitly/step-require-id']).toBe('error');
    expect(rules['awaitly/step-no-immediate-execution']).toBe('error');
    expect(rules['awaitly/step-require-thunk-for-key']).toBe('error');
    expect(rules['awaitly/step-stable-cache-keys']).toBe('error');
    expect(rules['awaitly/workflow-no-floating']).toBe('error');
    expect(rules['awaitly/result-no-floating']).toBe('error');
    expect(rules['awaitly/result-require-handling']).toBe('error');
    expect(rules['awaitly/workflow-options-position']).toBe('error');
    expect(rules['awaitly/result-no-double-wrap']).toBe('error');
    expect(rules['awaitly/workflow-no-dynamic-import']).toBe('error');
  });

  it('does not enable error-check-unexpected-first in recommended (heuristic, opt-in only)', () => {
    const recommended = plugin.configs?.recommended as Linter.Config[] | undefined;
    const strict = plugin.configs?.['recommended-strict'] as
      | Linter.Config[]
      | undefined;
    const recommendedRules = (recommended?.[0]?.rules ?? {}) as Record<
      string,
      string
    >;
    const strictRules = (strict?.[0]?.rules ?? {}) as Record<string, string>;
    expect(recommendedRules['awaitly/error-check-unexpected-first']).toBeUndefined();
    expect(strictRules['awaitly/error-check-unexpected-first']).toBeUndefined();
  });
});
