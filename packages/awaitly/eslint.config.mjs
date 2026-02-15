import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import awaitlyPlugin from "eslint-plugin-awaitly";

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
      // Awaitly rules - dogfood our own plugin
      "awaitly/require-step-id": "warn",
      "awaitly/no-immediate-execution": "warn",
      "awaitly/no-floating-result": "warn",
      "awaitly/no-floating-workflow": "warn",
      "awaitly/require-result-handling": "warn",
      "awaitly/stable-cache-keys": "warn",
      "awaitly/require-thunk-for-key": "warn",
      "awaitly/no-options-on-executor": "warn",
      "awaitly/no-double-wrap-result": "warn",
    },
  },
  // Relax rules for test files - tests intentionally access .value/.error directly
  // and use patterns that would be flagged in production code
  {
    files: ["**/*.test.ts", "**/*.test-d.ts"],
    rules: {
      "awaitly/require-result-handling": "off",
      "awaitly/no-floating-result": "off",
      "awaitly/no-floating-workflow": "off",
      "awaitly/no-immediate-execution": "off",
      "awaitly/require-thunk-for-key": "off",
      "awaitly/no-double-wrap-result": "off",
      "awaitly/require-step-id": "off",
    },
  },
);
