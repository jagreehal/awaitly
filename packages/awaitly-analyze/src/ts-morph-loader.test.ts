import { describe, expect, it } from "vitest";
import { loadTsMorph, loadTypescript } from "./ts-morph-loader";

describe("loadTypescript", () => {
  it("returns the compiler bundled with ts-morph", () => {
    const ts = loadTypescript();

    expect(ts).toBe(loadTsMorph().ts);
    expect(ts.TypeFlags.Never).toBeTypeOf("number");
    expect(ts.SyntaxKind.ArrowFunction).toBeTypeOf("number");
  });
});
