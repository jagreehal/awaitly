import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "..", "..", "src", "content", "docs");

function docFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return docFiles(full);
    return /\.mdx?$/.test(e.name) ? [full] : [];
  });
}

const files = docFiles(DOCS_DIR);

/**
 * Strip fenced code blocks so example URLs inside snippets aren't linted.
 */
const withoutCode = (src: string) => src.replace(/```[\s\S]*?```/g, "");

/** Markdown links, minus external/anchor/mailto targets. */
function internalLinks(src: string): string[] {
  return [...withoutCode(src).matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1]!)
    .filter((href) => !/^(https?:|mailto:|#)/.test(href));
}

describe("internal doc links", () => {
  // The site is served under a base path (/awaitly). A `<base href>` tag in
  // astro.config.mjs makes base-relative links resolve correctly in both
  // `BASE=/` dev and production — root-absolute links bypass it and 404.
  it("are base-relative, never root-absolute", () => {
    const offenders = files.flatMap((f) =>
      internalLinks(readFileSync(f, "utf8"))
        .filter((href) => href.startsWith("/"))
        .map((href) => `${relative(DOCS_DIR, f)}: ${href}`)
    );
    expect(offenders, `Root-absolute links:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("point at pages that exist", () => {
    const broken = files.flatMap((f) =>
      internalLinks(readFileSync(f, "utf8"))
        .map((href) => href.split("#")[0]!.replace(/\/$/, ""))
        .filter((slug) => slug.length > 0)
        .filter(
          (slug) =>
            !existsSync(join(DOCS_DIR, `${slug}.md`)) &&
            !existsSync(join(DOCS_DIR, `${slug}.mdx`)) &&
            !existsSync(join(DOCS_DIR, slug, "index.mdx")) &&
            !existsSync(join(DOCS_DIR, slug, "index.md"))
        )
        .map((slug) => `${relative(DOCS_DIR, f)} -> ${slug}`)
    );
    expect(broken, `Links to missing pages:\n${broken.join("\n")}`).toEqual([]);
  });
});
