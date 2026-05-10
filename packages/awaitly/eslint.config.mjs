import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
// Relative import avoids a workspace dependency on eslint-plugin-awaitly (breaks turbo
// build cycle: awaitly <-> eslint-plugin-awaitly). Requires `eslint-plugin-awaitly` dist
// (built by `^build` before lint). Not published — monorepo-only.
import awaitlyPlugin from "../eslint-plugin-awaitly/dist/index.js";

export default tseslint.config(
  {
    ignores: ["lib/**", "dist/**", "docs-site/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      awaitly: awaitlyPlugin,
    },
    rules: {
      // Allow underscore-prefixed variables to be unused (common TS convention)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // Awaitly rules - dogfood our own plugin (canonical slug rule ids)
      "awaitly/step-require-id": "warn",
      "awaitly/step-no-immediate-execution": "warn",
      "awaitly/result-no-floating": "warn",
      "awaitly/workflow-no-floating": "warn",
      "awaitly/result-require-handling": "warn",
      "awaitly/step-stable-cache-keys": "warn",
      "awaitly/step-require-thunk-for-key": "warn",
      "awaitly/workflow-options-position": "warn",
      "awaitly/result-no-double-wrap": "warn",
    },
  },
  // Relax rules for test files - tests intentionally access .value/.error directly
  // and use patterns that would be flagged in production code
  {
    files: ["**/*.test.ts", "**/*.test-d.ts"],
    rules: {
      "awaitly/result-require-handling": "off",
      "awaitly/result-no-floating": "off",
      "awaitly/workflow-no-floating": "off",
      "awaitly/step-no-immediate-execution": "off",
      "awaitly/step-require-thunk-for-key": "off",
      "awaitly/result-no-double-wrap": "off",
      "awaitly/step-require-id": "off",
    },
  },
);
