/**
 * Tests for const inliner
 */
import { describe, it, expect } from "vitest";
import { loadTsMorph } from "../../ts-morph-loader";
import {
  createConstCache,
  resolveConst,
  constValueToJS,
  extractStringArray,
} from "../../const-inliner";

function createSourceFile(code: string) {
  const { Project } = loadTsMorph();
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("test.ts", code);
}

describe("Const Inliner", () => {
  describe("resolveConst", () => {
    it("resolves string const", () => {
      const sourceFile = createSourceFile(`const name = "hello";`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("name", cache);

      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toBe("hello");
    });

    it("resolves number const", () => {
      const sourceFile = createSourceFile(`const count = 42;`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("count", cache);

      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toBe(42);
    });

    it("resolves boolean const", () => {
      const sourceFile = createSourceFile(`const flag = true;`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("flag", cache);

      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toBe(true);
    });

    it("resolves array const", () => {
      const sourceFile = createSourceFile(`const items = ['a', 'b', 'c'];`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("items", cache);

      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toEqual(["a", "b", "c"]);
    });

    it("resolves object const", () => {
      const sourceFile = createSourceFile(`const config = { name: 'test', count: 5 };`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("config", cache);

      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toEqual({ name: "test", count: 5 });
    });

    it("resolves tags() helper", () => {
      const sourceFile = createSourceFile(`const errors = tags('NOT_FOUND', 'UNAUTHORIZED');`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("errors", cache);

      expect(result.resolved).toBe(true);
      expect(extractStringArray(result.value!)).toEqual(["NOT_FOUND", "UNAUTHORIZED"]);
    });

    it("resolves err() helper", () => {
      const sourceFile = createSourceFile(`const errors = err('ERROR_A', 'ERROR_B');`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("errors", cache);

      expect(result.resolved).toBe(true);
      expect(extractStringArray(result.value!)).toEqual(["ERROR_A", "ERROR_B"]);
    });

    it("resolves reference to another const", () => {
      const sourceFile = createSourceFile(`
        const base = ['A', 'B'];
        const derived = base;
      `);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("derived", cache);

      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toEqual(["A", "B"]);
    });

    it("fails for let declaration", () => {
      const sourceFile = createSourceFile(`let name = "hello";`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("name", cache);

      expect(result.resolved).toBe(false);
      expect(result.reason).toContain("not a const");
    });

    it("fails for spread in array", () => {
      const sourceFile = createSourceFile(`
        const base = ['A'];
        const extended = [...base, 'B'];
      `);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("extended", cache);

      expect(result.resolved).toBe(false);
      expect(result.reason).toContain("spread");
    });

    it("fails for spread in object", () => {
      const sourceFile = createSourceFile(`
        const base = { a: 1 };
        const extended = { ...base, b: 2 };
      `);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("extended", cache);

      expect(result.resolved).toBe(false);
      expect(result.reason).toContain("spread");
    });

    it("fails for function call (non-helper)", () => {
      const sourceFile = createSourceFile(`const value = getConfig();`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("value", cache);

      expect(result.resolved).toBe(false);
      expect(result.reason).toContain("function call");
    });

    it("fails for template literal with expressions", () => {
      const sourceFile = createSourceFile(`const name = \`hello \${world}\`;`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("name", cache);

      expect(result.resolved).toBe(false);
      expect(result.reason).toContain("template literal");
    });

    it("handles as const assertions", () => {
      const sourceFile = createSourceFile(`const items = ['a', 'b'] as const;`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("items", cache);

      expect(result.resolved).toBe(true);
      expect(constValueToJS(result.value!)).toEqual(["a", "b"]);
    });

    it("caches results", () => {
      const sourceFile = createSourceFile(`const name = "hello";`);
      const cache = createConstCache(sourceFile);

      // First call
      const result1 = resolveConst("name", cache);
      // Second call should use cache
      const result2 = resolveConst("name", cache);

      expect(result1).toBe(result2); // Same object reference
    });
  });

  describe("extractStringArray", () => {
    it("extracts string array", () => {
      const sourceFile = createSourceFile(`const items = ['a', 'b', 'c'];`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("items", cache);
      const strings = extractStringArray(result.value!);

      expect(strings).toEqual(["a", "b", "c"]);
    });

    it("returns undefined for non-array", () => {
      const sourceFile = createSourceFile(`const name = "hello";`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("name", cache);
      const strings = extractStringArray(result.value!);

      expect(strings).toBeUndefined();
    });

    it("returns undefined for mixed array", () => {
      const sourceFile = createSourceFile(`const items = ['a', 1, 'b'];`);
      const cache = createConstCache(sourceFile);

      const result = resolveConst("items", cache);
      const strings = extractStringArray(result.value!);

      expect(strings).toBeUndefined();
    });
  });
});
