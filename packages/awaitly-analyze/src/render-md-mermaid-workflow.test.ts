import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("render-md-mermaid workflow config", () => {
  it("uses recursive markdown glob so nested docs trigger rendering", () => {
    const workflowPath = join(__dirname, "../../../.github/workflows/render-md-mermaid.yml");
    const yaml = readFileSync(workflowPath, "utf-8");

    expect(yaml).toContain("**/*.md");
  });
});

