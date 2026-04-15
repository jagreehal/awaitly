import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

const skillMarkdown = readFileSync(
  new URL("../../../../.claude/skills/awaitly-patterns/SKILL.md", import.meta.url),
  "utf8"
);

const typeScriptFence = /```typescript\n([\s\S]*?)```/g;

const extractTypeScriptBlocks = (markdown: string): string[] => {
  const blocks: string[] = [];
  let match = typeScriptFence.exec(markdown);

  while (match) {
    blocks.push(match[1].trim());
    match = typeScriptFence.exec(markdown);
  }

  return blocks;
};

describe("awaitly-patterns skill markdown examples", () => {
  it("contains TypeScript code examples", () => {
    const blocks = extractTypeScriptBlocks(skillMarkdown);
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("keeps every TypeScript code block syntactically valid", () => {
    const blocks = extractTypeScriptBlocks(skillMarkdown);

    const diagnostics = blocks.flatMap((block, index) => {
      const result = ts.transpileModule(block, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          strict: true,
        },
        reportDiagnostics: true,
      });

      const errors =
        result.diagnostics?.filter(
          (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
        ) ?? [];

      return errors.map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          "\n"
        );
        return `Block ${index + 1}: ${message}`;
      });
    });

    expect(diagnostics).toEqual([]);
  });
});
