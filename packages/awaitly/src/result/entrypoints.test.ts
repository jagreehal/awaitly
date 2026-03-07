import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("result extra entrypoints", () => {
  it("publishes awaitly/result/retry subpath export", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as {
      exports?: Record<
        string,
        { types?: string; import?: string; require?: string } | string
      >;
    };

    expect(pkg.exports?.["./result/retry"]).toEqual({
      types: "./dist/result/retry.d.ts",
      import: "./dist/result/retry.js",
      require: "./dist/result/retry.cjs",
    });
  });

  it("builds result/retry output", () => {
    const tsupConfig = readFileSync(
      new URL("../../tsup.config.ts", import.meta.url),
      "utf8"
    );

    expect(tsupConfig).toContain("'result/retry': 'src/result/retry.ts'");
  });
});
