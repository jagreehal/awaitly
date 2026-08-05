import { defineConfig } from 'tsup';

export default defineConfig({
  // Four public entries. The root carries the 95% case (Results, run,
  // createWorkflow, policies); `result` keeps its zero-tree-shaking size
  // guarantee; `durable` holds the heavy production machinery; `testing` stays
  // separate so harness code never reaches a production bundle.
  entry: {
    index: 'src/index.ts',
    result: 'src/result/index.ts',
    durable: 'src/durable-bundle-entry.ts',
    testing: 'src/testing-entry.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
});
