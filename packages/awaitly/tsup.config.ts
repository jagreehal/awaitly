import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    result: 'src/result/index.ts',
    workflow: 'src/workflow-entry.ts',
    testing: 'src/testing-entry.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
});
