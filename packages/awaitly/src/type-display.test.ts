/**
 * Guards how public types PRINT, not just what they resolve to.
 *
 * Internal inference machinery (`NoInfer<…>`) is structurally identical to the
 * type it wraps, so tsd and every structural assertion pass while the hover
 * reads `Result<User, UnexpectedError | NoInfer<UserNotFound>>`. That is what
 * users see, so it is what this asserts.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/hover-display.ts"
);

// ponytail: one Program for the whole file — creating it is the slow part
// (~3s). Split into per-test Programs only if the assertions diverge.
const checker = (() => {
  const program = ts.createProgram([fixture], {
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  });
  return { checker: program.getTypeChecker(), program };
})();

function displayedTypeOf(exportName: string): string {
  const source = checker.program.getSourceFile(fixture);
  if (!source) throw new Error(`fixture not found: ${fixture}`);
  const symbol = checker.checker
    .getExportsOfModule(checker.checker.getSymbolAtLocation(source)!)
    .find((s) => s.getName() === exportName);
  if (!symbol) throw new Error(`no export named ${exportName}`);
  return checker.checker.typeToString(
    checker.checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!)
  );
}

describe("public type display", () => {
  it("run(deps, fn) prints the plain error union, not NoInfer", () => {
    const t = displayedTypeOf("runResult");
    expect(t).toBe("Result<User, UnexpectedError | UserNotFound>");
    // Result has no cause slot, so no trailing `, unknown` in any hover.
    expect(t).not.toContain("unknown");
  });

  it("createWorkflow(deps) prints the plain error union, not NoInfer", () => {
    expect(displayedTypeOf("workflow")).toContain("Workflow<UserNotFound,");
  });
});

describe("error literals survive inference without `as const`", () => {
  it("keeps a string returned from an onError callback literal", () => {
    expect(displayedTypeOf("stringMapper")).toContain('"PARSE_ERROR"');
    expect(displayedTypeOf("stringMapper")).not.toContain("Err<string");
  });

  it("keeps a string returned from an async onError callback literal", () => {
    expect(displayedTypeOf("asyncStringMapper")).toContain('"FETCH_ERROR"');
  });

  it("keeps both mappers literal when a signature has two of them", () => {
    const t = displayedTypeOf("twoStringMappers");
    expect(t).toContain('"FORMAT_ERROR"');
    expect(t).toContain('"TRANSFORM_ERROR"');
  });

  it("keeps an error object's discriminant literal", () => {
    expect(displayedTypeOf("objectMapper")).toContain('type: "NOT_FOUND"');
  });
});

describe("step.withTimeout", () => {
  it("puts a declared custom timeout error into the result union", () => {
    expect(displayedTypeOf("timeoutResult")).toContain('"API_TIMEOUT"');
  });
});
