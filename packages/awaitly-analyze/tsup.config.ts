import { defineConfig } from 'tsup';

export default defineConfig([
  // Main library
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    minify: true,
    external: ['ts-morph'],
  },
  // CLI
  {
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['esm'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
    minify: true,
    external: ['ts-morph'],
    banner: {
      js: `#!/usr/bin/env node
import { createRequire as __cr } from 'module'; import { fileURLToPath as __ftp } from 'url'; import { dirname as __dn } from 'path'; const require = __cr(import.meta.url); const __filename = __ftp(import.meta.url); const __dirname = __dn(__filename);`,
    },
  },
]);
