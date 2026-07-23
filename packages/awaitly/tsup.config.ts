import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    result: 'src/result/index.ts',
    run: 'src/run-entry.ts',
    workflow: 'src/workflow-entry.ts',
    reliability: 'src/reliability-entry.ts',
    durable: 'src/durable-entry.ts',
    persistence: 'src/persistence-entry.ts',
    saga: 'src/saga-entry.ts',
    hitl: 'src/hitl-entry.ts',
    streaming: 'src/streaming-entry.ts',
    webhook: 'src/webhook-entry.ts',
    engine: 'src/engine-entry.ts',
    testing: 'src/testing-entry.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
});
