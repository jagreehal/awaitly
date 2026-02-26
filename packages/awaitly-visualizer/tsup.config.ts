import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "tsup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = (...p: string[]) => path.resolve(__dirname, "src", ...p);

export default defineConfig({
  entry: {
    // Main entry points (browser/node split)
    index: src("index.ts"),
    "index.browser": src("index.browser.ts"),
    devtools: src("devtools-entry.ts"),
    // Kroki fetch (Node-only)
    "kroki/fetch": src("kroki", "fetch.ts"),
    // Notifiers (separate subpaths to avoid bundling optional deps)
    "notifiers/slack": src("notifiers", "slack.ts"),
    "notifiers/discord": src("notifiers", "discord.ts"),
    "notifiers/webhook": src("notifiers", "webhook.ts"),
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: true,
});
