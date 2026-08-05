import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const docsRoot = fileURLToPath(
  new URL("../../../../apps/docs-site/src/content/docs/", import.meta.url)
);
const skillsRoot = fileURLToPath(
  new URL("../../../../.claude/skills/", import.meta.url)
);

const documentationFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return documentationFiles(path);
    return /\.(?:md|mdx)$/.test(entry.name) && statSync(path).isFile() ? [path] : [];
  });

describe("docs import paths for result extras", () => {
  it("uses only public task-shaped awaitly entry points", () => {
    // Four public entries. Docs and skills must not teach an import path that
    // no longer resolves.
    const publicEntries = new Set(["result", "durable", "testing"]);
    const subpathImport = /from\s+["']awaitly\/([^"']+)["']/g;

    for (const path of [
      ...documentationFiles(docsRoot),
      ...documentationFiles(skillsRoot),
    ]) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(subpathImport)) {
        expect(publicEntries.has(match[1]), `${path}: awaitly/${match[1]}`).toBe(true);
      }
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

  it("keeps the bundled coding skill on the four public entry points", () => {
    const skill = readFileSync(
      new URL("../../../../.claude/skills/awaitly-patterns/SKILL.md", import.meta.url),
      "utf8",
    );

    // The 95% case comes from the root; only heavy production machinery is
    // taught from ./durable.
    for (const symbol of ["run", "createWorkflow"]) {
      expect(skill, `${symbol} should be taught from the root entry`).toMatch(
        new RegExp(`import\\s+\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s+from\\s+['"]awaitly['"]`, "s"),
      );
    }

    // Absorbed subpaths must not resurface in the skill.
    for (const gone of ["run", "workflow", "reliability", "persistence", "saga", "hitl", "streaming", "webhook", "engine"]) {
      expect(skill, `awaitly/${gone} no longer exists`).not.toMatch(
        new RegExp(`['"]awaitly/${gone}['"]`),
      );
    }
  });
});
