import { describe, it, expect } from "vitest";
import { Linter } from "eslint";
import plugin from "../src/index.js";

const linter = new Linter({ configType: "flat" });

const config = [
  {
    plugins: {
      awaitly: plugin,
    },
    rules: {
      "awaitly/no-dynamic-import": "error",
    },
  },
];

describe("no-dynamic-import", () => {
  describe("valid cases", () => {
    it("allows static import", () => {
      const code = `import foo from 'foo';`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });

    it("allows static named import", () => {
      const code = `import { bar } from 'bar';`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(0);
    });
  });

  describe("dynamic import()", () => {
    it("reports dynamic import()", () => {
      const code = `const m = await import('pkg');`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe("awaitly/no-dynamic-import");
      expect(messages[0].messageId).toBe("dynamicImport");
    });
  });

  describe("require()", () => {
    it("reports require()", () => {
      const code = `const m = require('pkg');`;
      const messages = linter.verify(code, config);
      expect(messages).toHaveLength(1);
      expect(messages[0].ruleId).toBe("awaitly/no-dynamic-import");
      expect(messages[0].messageId).toBe("require");
    });
  });
});
