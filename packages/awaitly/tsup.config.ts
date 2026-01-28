import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    // Main entry point (slimmed down - core workflow + results)
    index: 'src/index.ts',

    // =========================================================================
    // Core entry points
    // =========================================================================
    core: 'src/core-entry.ts',
    run: 'src/run-entry.ts',
    result: 'src/result.ts',
    workflow: 'src/workflow-entry.ts',

    // =========================================================================
    // Feature entry points
    // =========================================================================
    visualize: 'src/visualize/index.ts',
    'visualize.browser': 'src/visualize/index.browser.ts',
    batch: 'src/batch.ts',
    resource: 'src/resource.ts',
    retry: 'src/retry-entry.ts',

    // =========================================================================
    // Reliability umbrella + granular
    // =========================================================================
    reliability: 'src/reliability.ts',
    'circuit-breaker': 'src/circuit-breaker-entry.ts',
    ratelimit: 'src/ratelimit-entry.ts',
    saga: 'src/saga-entry.ts',
    policies: 'src/policies-entry.ts',

    // =========================================================================
    // Persistence
    // =========================================================================
    persistence: 'src/persistence-entry.ts',

    // =========================================================================
    // Integrations (split from old "integrations" grab-bag)
    // =========================================================================
    hitl: 'src/hitl-entry.ts',
    webhook: 'src/webhook-entry.ts',
    otel: 'src/otel-entry.ts',

    // =========================================================================
    // Tools
    // =========================================================================
    devtools: 'src/devtools-entry.ts',
    testing: 'src/testing-entry.ts',

    // =========================================================================
    // Utility entry points (optional granular imports)
    // =========================================================================
    conditional: 'src/conditional-entry.ts',
    duration: 'src/duration-entry.ts',
    match: 'src/match-entry.ts',
    'tagged-error': 'src/tagged-error-entry.ts',
    errors: 'src/errors-entry.ts',
    cache: 'src/cache-entry.ts',
    'bind-deps': 'src/bind-deps-entry.ts',
    fetch: 'src/fetch-entry.ts',

    // =========================================================================
    // Glue library utilities
    // =========================================================================
    singleflight: 'src/singleflight-entry.ts',
    adapters: 'src/adapters-entry.ts',

    // =========================================================================
    // Durable execution
    // =========================================================================
    durable: 'src/durable-entry.ts',

    // =========================================================================
    // Streaming
    // =========================================================================
    streaming: 'src/streaming-entry.ts',

    // =========================================================================
    // Functional programming utilities
    // =========================================================================
    functional: 'src/functional-entry.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: true,
});
