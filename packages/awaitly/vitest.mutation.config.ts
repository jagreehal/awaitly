import { defineConfig } from 'vitest/config';

/**
 * Test selection for mutation runs.
 *
 * Stryker re-runs the suite once per mutant, so tests that shell out are
 * ruinous here: the bundle budgets spawn esbuild and the skill snippets spawn
 * tsc, each taking longer than a whole mutant's useful work. Neither observes
 * runtime behaviour, so neither can kill a mutant anyway.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/node-examples/**',
      '**/_analyze/**',
      // Spawn a compiler; cannot kill a mutant.
      '**/index.bundle-size.test.ts',
      '**/skill-snippets.test.ts',
      // Assert on the shape of dist, not on behaviour.
      '**/public-surface.test.ts',
      '**/index.named-exports.test.ts',
      '**/entrypoints.test.ts',
      '**/docs-import-paths.test.ts',
    ],
  },
});
