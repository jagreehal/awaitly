import js from "@eslint/js";
import tseslint from "typescript-eslint";
import awaitly from "eslint-plugin-awaitly";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...awaitly.configs.durable,
  {
    ignores: ["dist/**", "node_modules/**", "e2e/.build/**"],
  }
);
