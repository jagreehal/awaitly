#!/usr/bin/env node
/**
 * Generates a single consolidated rule index at
 *   apps/docs-site/src/content/docs/rules/index.mdx
 *
 * One H2-anchored section per canonical slug. `slugDocsUrl(slug)` returns
 * `https://jagreehal.github.io/awaitly/rules/#<slug>` so every error's
 * `docsUrl` deep-links to the right section of this page.
 *
 * Sources of truth (all auto-discovered, no hand-maintained list):
 *   1. awaitly slug runtime (packages/awaitly/src/slugs.ts) — the canonical slug namespace
 *   2. awaitly errors roster (packages/awaitly/src/errors.ts) — runtime-* slugs and their hints
 *   3. eslint-plugin-awaitly    — lint-backed slugs (rule names = slugs)
 *   4. awaitly-analyze          — STRICT_RULE_TO_SLUG (which strict-rules emit which slug)
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_SLUGS,
  slugCategory,
} from "awaitly";
import { AWAITLY_SYSTEM_ERROR_CLASSES } from "awaitly";
import eslintPlugin from "eslint-plugin-awaitly";
import { STRICT_RULE_TO_SLUG } from "awaitly-analyze";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, "..", "src", "content", "docs", "rules");
const OUT_FILE = join(RULES_DIR, "index.mdx");

// =============================================================================
// Build slug → metadata maps
// =============================================================================

function buildRuntimeErrorMap() {
  const sampleProps = {
    TimeoutError: { operation: "sample", ms: 1 },
    RetryExhaustedError: { operation: "sample", attempts: 1 },
    RateLimitError: { retryAfterMs: 1 },
    CircuitBreakerOpenError: { circuitName: "sample" },
    CompensationError: { step: "sample" },
    UnexpectedError: { cause: "sample" },
  };

  const map = {};
  for (const Cls of AWAITLY_SYSTEM_ERROR_CLASSES) {
    const props = sampleProps[Cls.name] ?? {};
    const instance = new Cls(props);
    // The instance's `name` field carries the original (non-minified) tag.
    map[instance.code] = { className: instance.name, hint: instance.hint };
  }
  return map;
}

function buildLintRuleMap() {
  const map = {};
  for (const [name, mod] of Object.entries(eslintPlugin.rules ?? {})) {
    const meta = mod?.meta ?? {};
    map[name] = {
      ruleName: `awaitly/${name}`,
      description: meta.docs?.description ?? "",
      messages: Object.values(meta.messages ?? {}),
    };
  }
  return map;
}

function buildAnalyzerMap() {
  const map = {};
  for (const [strictRule, slug] of Object.entries(STRICT_RULE_TO_SLUG)) {
    if (!map[slug]) map[slug] = [];
    map[slug].push(strictRule);
  }
  return map;
}

const runtimeMap = buildRuntimeErrorMap();
const lintMap = buildLintRuleMap();
const analyzerMap = buildAnalyzerMap();

// =============================================================================
// Render
// =============================================================================

const CATEGORY_ORDER = [
  "step",
  "workflow",
  "result",
  "error",
  "concurrency",
  "runtime",
];

const CATEGORY_BLURB = {
  step: "step() discipline: id, thunk, nesting, options.",
  workflow: "createWorkflow / run / runWithState shape.",
  result: "Result usage: ok/err, propagation, double-wrap.",
  error: "Boundary handling: isUnexpectedError, .cause, normalization.",
  concurrency: "step.all / step.map / step.race vs Promise.*.",
  runtime: "Failures only observable at runtime.",
};

/**
 * Escapes braces in plain MDX prose so `({ step })` etc. doesn't get parsed
 * as a JSX expression.
 */
function escapeMdxProse(text) {
  return text.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

function renderSlugSection(slug) {
  const lint = lintMap[slug];
  const runtime = runtimeMap[slug];
  const analyzerStrictRules = analyzerMap[slug] ?? [];

  const surfaces = [];
  if (lint) surfaces.push(`**ESLint rule:** \`${lint.ruleName}\``);
  if (runtime)
    surfaces.push(
      `**Runtime error:** \`${runtime.className}\` (\`error.code === '${slug}'\`)`
    );
  if (analyzerStrictRules.length)
    surfaces.push(
      `**Analyzer:** \`awaitly-analyze --doctor\` strict rules ${analyzerStrictRules
        .map((r) => `\`${r}\``)
        .join(", ")}`
    );

  const description =
    lint?.description || runtime?.hint || `Canonical awaitly slug: ${slug}`;
  const hint = runtime?.hint || lint?.description || "";

  const lines = [];
  // Starlight supports custom slugs on headings via `{#id}`. The id is the slug.
  lines.push(`### \`${slug}\` \\{#${slug}\\}`);
  lines.push("");
  lines.push(escapeMdxProse(description));
  lines.push("");

  if (surfaces.length) {
    for (const s of surfaces) lines.push(`- ${escapeMdxProse(s)}`);
    lines.push("");
  }

  if (hint && hint !== description) {
    lines.push("**Hint:** " + escapeMdxProse(hint));
    lines.push("");
  }

  if (lint?.messages?.length) {
    lines.push("```text");
    for (const m of lint.messages) lines.push(m);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function renderPage() {
  const lines = [];
  lines.push("---");
  lines.push("title: Rule Index");
  lines.push(
    'description: "Every canonical awaitly slug, grouped by category. One destination for runtime errors, lint diagnostics, and analyzer doctor output."'
  );
  lines.push("sidebar:");
  lines.push("  order: 0");
  lines.push("---");
  lines.push("");
  lines.push("import { Card, CardGrid } from \"@astrojs/starlight/components\";");
  lines.push("");
  lines.push(
    "Every canonical awaitly slug lives on this page. The same slug appears on runtime errors (`error.code`), ESLint rule names (`awaitly/<slug>`), and `awaitly-analyze --doctor` diagnostics. `error.docsUrl` deep-links to the matching section."
  );
  lines.push("");
  lines.push(
    "See the [Slug Spine reference](/awaitly/reference/spine/) for the design rationale and the [ESLint plugin guide](/awaitly/guides/eslint-plugin/) for hand-authored examples of every lint rule."
  );
  lines.push("");

  for (const cat of CATEGORY_ORDER) {
    const slugsInCat = ALL_SLUGS.filter((s) => slugCategory(s) === cat);
    if (!slugsInCat.length) continue;

    lines.push(`## \`${cat}-*\``);
    lines.push("");
    lines.push(CATEGORY_BLURB[cat] ?? "");
    lines.push("");

    for (const slug of slugsInCat) {
      lines.push(renderSlugSection(slug));
    }
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "_This page is generated by `apps/docs-site/scripts/generate-rule-pages.mjs` from the awaitly slug runtime (`packages/awaitly/src/slugs.ts`), the errors roster, `eslint-plugin-awaitly`, and `awaitly-analyze`. Adding a slug to `packages/awaitly/src/slugs.ts` and re-running the generator regenerates this page; the cross-surface parity test fails until each surface (lint rule, runtime error, or analyzer mapping) is wired up._"
  );
  lines.push("");
  return lines.join("\n");
}

// =============================================================================
// Write
// =============================================================================

mkdirSync(RULES_DIR, { recursive: true });

// Clean any per-slug MDX files left over from the previous design.
const existing = existsSync(RULES_DIR)
  ? readdirSync(RULES_DIR).filter(
      (f) => f.endsWith(".mdx") && f !== "index.mdx"
    )
  : [];
for (const file of existing) {
  unlinkSync(join(RULES_DIR, file));
  process.stdout.write(`removed legacy per-slug page ${file}\n`);
}

writeFileSync(OUT_FILE, renderPage(), "utf8");
process.stdout.write(
  `wrote consolidated rule index (${ALL_SLUGS.length} slugs) to ${OUT_FILE}\n`
);
