import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // .stryker-tmp holds mutation sandboxes: copies of src with a broken
    // path back to the workspace, and nothing to lint.
    ignores: ["lib/**", "dist/**", "docs-site/**", ".stryker-tmp/**", "reports/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly", URL: "readonly", performance: "readonly" },
    },
  },
  {
    rules: {
      // Allow underscore-prefixed variables to be unused (common TS convention)
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // Ban dynamic import() and require() - use static imports for predictable bundling and tree-shaking
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Dynamic import() is not allowed. Use static import instead.",
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: "require() is not allowed. Use static import instead.",
        },
      ],
    },
  },
);
