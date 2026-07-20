import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_SLUGS } from "awaitly";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, "..", "..", "src", "content", "docs", "rules");
const INDEX_FILE = join(RULES_DIR, "index.mdx");

describe("consolidated rule index parity with slugs.ts", () => {
  it("the rules index page exists", () => {
    expect(existsSync(INDEX_FILE)).toBe(true);
  });

  it("every slug has an anchored section in the index", () => {
    const content = readFileSync(INDEX_FILE, "utf8");
    const missing: string[] = [];
    for (const slug of ALL_SLUGS) {
      // The generator emits `### \`<slug>\` \{#<slug>\}` per slug. Match by
      // the escaped anchor token, which is unique to that section.
      if (!content.includes(`\\{#${slug}\\}`)) missing.push(slug);
    }
    expect(missing, `Missing anchored sections: ${missing.join(", ")}`).toEqual([]);
  });

  it("no stray per-slug MDX files remain (legacy cleanup)", () => {
    const stale = readdirSync(RULES_DIR).filter(
      (f) => f.endsWith(".mdx") && f !== "index.mdx"
    );
    expect(stale, `Stale per-slug pages: ${stale.join(", ")}`).toEqual([]);
  });
});
