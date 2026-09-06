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
  // Optional dependencies are not automatically externalized by tsup. Bundling
  // Slack's CommonJS SDK into ESM leaves Node built-ins behind dynamic require.
  external: ["@slack/web-api"],
  sourcemap: true,
  minify: true,
});
