import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "tsup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: [path.resolve(__dirname, "src", "index.ts"), path.resolve(__dirname, "src", "testing.ts")],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: true,
});
