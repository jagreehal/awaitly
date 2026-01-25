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
    browser: 'src/browser.ts',
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

    // Copy TypeScript grammar WASM
    const tsSrc = resolve(wasmSrc, 'tree-sitter-typescript.wasm');
    const tsDest = resolve(wasmDest, 'tree-sitter-typescript.wasm');
    if (existsSync(tsSrc)) {
      copyFileSync(tsSrc, tsDest);
      console.log('Copied tree-sitter-typescript.wasm to dist/wasm/');
    }

    // Copy web-tree-sitter core WASM (required for browser usage)
    // Try to find it in node_modules
    const webTsWasmPaths = [
      resolve(__dirname, 'node_modules/web-tree-sitter/web-tree-sitter.wasm'),
      resolve(__dirname, '../../node_modules/web-tree-sitter/web-tree-sitter.wasm'),
      resolve(__dirname, '../../node_modules/.pnpm/web-tree-sitter@0.26.3/node_modules/web-tree-sitter/web-tree-sitter.wasm'),
    ];

    for (const webTsSrc of webTsWasmPaths) {
      if (existsSync(webTsSrc)) {
        const webTsDest = resolve(wasmDest, 'web-tree-sitter.wasm');
        copyFileSync(webTsSrc, webTsDest);
        console.log('Copied web-tree-sitter.wasm to dist/wasm/');
        break;
      }
    }
  },
});
