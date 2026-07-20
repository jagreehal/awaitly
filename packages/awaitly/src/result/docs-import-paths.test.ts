import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const docsRoot = fileURLToPath(
  new URL("../../../../apps/docs-site/src/content/docs/", import.meta.url)
);

const documentationFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return documentationFiles(path);
    return /\.(?:md|mdx)$/.test(entry.name) && statSync(path).isFile() ? [path] : [];
  });

describe("docs import paths for result extras", () => {
  it("uses only the four canonical awaitly entry points", () => {
    const removedSubpathImport =
      /from\s+["']awaitly\/(?!result["']|workflow["']|testing["'])[^"']+["']/;

    for (const path of documentationFiles(docsRoot)) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(removedSubpathImport);
    }
  });

  it("documents retry via the `retry` policy from the root entry", () => {
    const docs = readFileSync(
      new URL(
        "../../../../apps/docs-site/src/content/docs/foundations/result-types.mdx",
        import.meta.url
      ),
      "utf8"
    );

    // The `retry` policy ships from the root entry.
    expect(docs).toMatch(/import\s+\{[^}]*\bretry\b[^}]*\}\s+from\s+'awaitly'/);

    // The removed `awaitly/result/retry` subpath and its helpers must not resurface.
    expect(docs).not.toMatch(/awaitly\/result\/retry/);
    expect(docs).not.toMatch(/\btryAsyncRetry\b/);
  });
});
