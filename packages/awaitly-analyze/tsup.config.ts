import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: true,

  // Copy WASM files to dist after build
  onSuccess: async () => {
    const wasmSrc = resolve(__dirname, 'src/wasm');
    const wasmDest = resolve(__dirname, 'dist/wasm');

    // Create dest directory
    if (!existsSync(wasmDest)) {
      mkdirSync(wasmDest, { recursive: true });
    }

    // Copy TypeScript grammar WASM (core WASM is bundled in web-tree-sitter v0.26+)
    const src = resolve(wasmSrc, 'tree-sitter-typescript.wasm');
    const dest = resolve(wasmDest, 'tree-sitter-typescript.wasm');
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log('Copied tree-sitter-typescript.wasm to dist/wasm/');
    }
  },
});
