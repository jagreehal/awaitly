# Rule Pages Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one MDX rule page per canonical slug at `/rules/<slug>` so `error.docsUrl`, lint diagnostic links, and analyzer `--doctor` output URLs all resolve to a real page. Content is auto-derived from `awaitly/slugs`, the ESLint plugin's rule registry, the awaitly-system error classes, and the analyzer's `STRICT_RULE_TO_SLUG` map — keeping the page set in lockstep with the code.

**Architecture:** A Node script (`apps/docs-site/scripts/generate-rule-pages.mjs`) reads four code sources at build time and writes one MDX file per slug to `apps/docs-site/src/content/docs/rules/<slug>.mdx`. Starlight auto-discovers the directory and renders pages plus a sidebar group. A vitest parity test asserts every slug in `awaitly/slugs` has a matching MDX file.

**Tech Stack:** Node 20+ (ESM), Astro Starlight, Vitest, awaitly source-of-truth modules.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/awaitly/src/errors.ts` | **Modify** | Export `AWAITLY_SYSTEM_ERROR_CLASSES` so the generator can iterate runtime error classes without hardcoding. |
| `packages/awaitly/src/errors-entry.ts` | **Modify** | Re-export `AWAITLY_SYSTEM_ERROR_CLASSES` from `awaitly/errors`. |
| `apps/docs-site/scripts/generate-rule-pages.mjs` | **Create** | The generator script. Reads slug spine, lint plugin rules, analyzer mapping, and runtime error classes; writes 31 MDX files. |
| `apps/docs-site/src/content/docs/rules/<slug>.mdx` | **Create (×31)** | One generated page per slug. Always overwritten by the generator. |
| `apps/docs-site/src/content/docs/rules/index.mdx` | **Create** | Hand-authored landing page for `/rules/`. Lists categories. |
| `apps/docs-site/astro.config.mjs` | **Modify** | Add a `Rules` sidebar section using `autogenerate: { directory: 'rules' }`. |
| `apps/docs-site/package.json` | **Modify** | Add `generate-rules` script and call it from `prebuild`. |
| `apps/docs-site/scripts/__tests__/rule-pages-parity.test.ts` | **Create** | Vitest test asserting every slug has a rule page. |
| `apps/docs-site/vitest.config.ts` | **Create or modify** | Wire the parity test into a vitest run. |

Out of scope:
- Hand-authored "wrong example / right example" prose for each slug — the generator emits a "Diagnostic" / "Hint" / "Surfaces" body that is already useful. Authored examples can be layered in via a follow-on plan.
- Custom-domain DNS for `awaitly.dev` — see Task 7 for the URL reconciliation decision.

---

## Task 1: Expose `AWAITLY_SYSTEM_ERROR_CLASSES` from `awaitly/errors`

**Files:**
- Modify: `packages/awaitly/src/errors.ts` (after the `AwaitlySystemError` union type)
- Modify: `packages/awaitly/src/errors-entry.ts` (add to the export block)
- Create: `packages/awaitly/src/errors-spine-roster.test.ts`

The generator needs to iterate the spine-bearing classes to read each one's `code` and `hint`. Adding a public roster constant lets the generator stay in sync as the union grows, without hardcoding.

- [ ] **Step 1: Write the failing test**

Create `/Users/jreehal/dev/js/awaitly/packages/awaitly/src/errors-spine-roster.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AWAITLY_SYSTEM_ERROR_CLASSES,
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  CompensationError,
  UnexpectedError,
} from "./errors";
import { isAwaitlySlug } from "./slugs";

describe("AWAITLY_SYSTEM_ERROR_CLASSES roster", () => {
  it("contains exactly the six awaitly-system error classes", () => {
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toHaveLength(6);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(TimeoutError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(RetryExhaustedError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(RateLimitError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(CircuitBreakerOpenError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(CompensationError);
    expect(AWAITLY_SYSTEM_ERROR_CLASSES).toContain(UnexpectedError);
  });

  it("each class produces an instance with a registered slug", () => {
    const samples: Array<[Function, Record<string, unknown>]> = [
      [TimeoutError, { operation: "x", ms: 1 }],
      [RetryExhaustedError, { operation: "x", attempts: 1 }],
      [RateLimitError, { retryAfterMs: 1 }],
      [CircuitBreakerOpenError, { circuitName: "x" }],
      [CompensationError, { step: "x" }],
      [UnexpectedError, { cause: "x" }],
    ];
    for (const [Cls, props] of samples) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const instance = new (Cls as any)(props) as {
        code?: string;
        hint?: string;
        docsUrl?: string;
      };
      expect(typeof instance.code).toBe("string");
      expect(isAwaitlySlug(instance.code!)).toBe(true);
      expect(typeof instance.hint).toBe("string");
      expect(instance.hint!.length).toBeGreaterThan(0);
      expect(typeof instance.docsUrl).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter awaitly test src/errors-spine-roster.test.ts`

Expected: FAIL with `AWAITLY_SYSTEM_ERROR_CLASSES is not exported from "./errors"`.

- [ ] **Step 3: Add the roster constant to `errors.ts`**

In `/Users/jreehal/dev/js/awaitly/packages/awaitly/src/errors.ts`, find the existing `AwaitlySystemError` union type (after the `AwaitlyError` union, near the end of the pre-built classes section). Immediately after the `AwaitlySystemError` type definition, insert:

```ts
/**
 * Roster of awaitly-system error classes that participate in the slug spine.
 * Adding a new system error means adding it to `AwaitlySystemError`, this
 * roster, and `slugs.ts`. The cross-surface parity test enforces all three.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AWAITLY_SYSTEM_ERROR_CLASSES: ReadonlyArray<new (...args: any[]) => AwaitlySystemError> = [
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  CompensationError,
  UnexpectedError,
] as const;
```

- [ ] **Step 4: Re-export from `errors-entry.ts`**

In `/Users/jreehal/dev/js/awaitly/packages/awaitly/src/errors-entry.ts`, find the existing `export { ... } from "./errors";` block. Add `AWAITLY_SYSTEM_ERROR_CLASSES` to the named exports:

```ts
export {
  // Factory
  makeError,
  // Pre-built errors
  TimeoutError,
  RetryExhaustedError,
  RateLimitError,
  CircuitBreakerOpenError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  NetworkError,
  CompensationError,
  UnexpectedError,
  // Union types
  type AwaitlyError,
  type AwaitlySystemError,
  // Roster
  AWAITLY_SYSTEM_ERROR_CLASSES,
  // Type guards
  isTimeoutError,
  isRetryExhaustedError,
  isRateLimitError,
  isCircuitBreakerOpenError,
  isValidationError,
  isNotFoundError,
  isUnauthorizedError,
  isNetworkError,
  isCompensationError,
  isAwaitlyError,
} from "./errors";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter awaitly test src/errors-spine-roster.test.ts`

Expected: 2 tests pass.

- [ ] **Step 6: Run the broader awaitly suite to confirm no regression**

Run: `pnpm --filter awaitly test`

Expected: all tests pass; the bundle-size test stays under the 16KB threshold (the addition is a single 6-element array).

- [ ] **Step 7: Build awaitly so the dist is fresh for downstream consumers**

Run: `pnpm --filter awaitly build`

Expected: build completes; `packages/awaitly/dist/errors.js` and `packages/awaitly/dist/errors.d.ts` reflect the new export.

- [ ] **Step 8: Commit**

```bash
cd /Users/jreehal/dev/js/awaitly
git add packages/awaitly/src/errors.ts packages/awaitly/src/errors-entry.ts packages/awaitly/src/errors-spine-roster.test.ts
git commit -m "feat(awaitly): export AWAITLY_SYSTEM_ERROR_CLASSES roster for tooling"
```

---

## Task 2: Create the rule-page generator script

**Files:**
- Create: `apps/docs-site/scripts/generate-rule-pages.mjs`

The generator reads four code sources and writes one MDX per slug. It runs from the docs-site after `awaitly` and `eslint-plugin-awaitly` have been built, since it imports their compiled JS.

- [ ] **Step 1: Create the generator file**

Create `/Users/jreehal/dev/js/awaitly/apps/docs-site/scripts/generate-rule-pages.mjs`:

```js
#!/usr/bin/env node
/**
 * Generates one MDX page per canonical awaitly slug at
 *   apps/docs-site/src/content/docs/rules/<slug>.mdx
 *
 * Sources of truth (all auto-discovered, no hand-maintained list):
 *   1. awaitly/slugs            — the canonical slug namespace
 *   2. awaitly/errors           — runtime-* slugs and their hints (via roster)
 *   3. eslint-plugin-awaitly    — lint-backed slugs (rule names = slugs)
 *   4. awaitly-analyze          — STRICT_RULE_TO_SLUG (which strict-rules emit which slug)
 *
 * Run from the repo root or from `apps/docs-site` — paths are absolute.
 */

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_SLUGS,
  slugCategory,
  slugDocsUrl,
} from "awaitly/slugs";
import { AWAITLY_SYSTEM_ERROR_CLASSES } from "awaitly/errors";
import eslintPlugin from "eslint-plugin-awaitly";
import { STRICT_RULE_TO_SLUG } from "awaitly-analyze";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, "..", "src", "content", "docs", "rules");

// =============================================================================
// Build slug → metadata map from the four sources
// =============================================================================

/**
 * Constructs each system-error class with a benign sample of props so we can
 * read its `code` and `hint`. Each class has different required props; we
 * fall back to an empty object cast to any if instantiation throws.
 */
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
    const name = Cls.name;
    const props = sampleProps[name] ?? {};
    const instance = new Cls(props);
    map[instance.code] = { className: name, hint: instance.hint };
  }
  return map;
}

/**
 * Reads the lint plugin's rule registry. Each entry's key is the slug; its
 * value carries `meta.docs.description` and `meta.messages`.
 */
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

/**
 * Inverts STRICT_RULE_TO_SLUG so we can look up which strict-rules emit a
 * given slug.
 */
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
// Render one MDX page per slug
// =============================================================================

function render(slug) {
  const category = slugCategory(slug);
  const lint = lintMap[slug];
  const runtime = runtimeMap[slug];
  const analyzerStrictRules = analyzerMap[slug] ?? [];

  // One-line description: lint rule's docs.description, runtime hint, or fallback.
  const description =
    lint?.description ||
    runtime?.hint ||
    `Canonical awaitly slug: ${slug}`;

  // Surfaces table rows.
  const surfaces = [];
  if (lint) surfaces.push(["ESLint rule", `\`${lint.ruleName}\``]);
  if (runtime)
    surfaces.push([
      "Runtime error",
      `\`${runtime.className}\` from \`awaitly/errors\` (\`error.code === '${slug}'\`)`,
    ]);
  if (analyzerStrictRules.length)
    surfaces.push([
      "Analyzer",
      `\`awaitly-analyze --doctor\` strict rules: ${analyzerStrictRules
        .map((r) => `\`${r}\``)
        .join(", ")}`,
    ]);
  surfaces.push(["Docs URL", slugDocsUrl(slug)]);

  // Diagnostic messages from the lint rule (already hand-authored).
  const diagnosticBlock = lint?.messages?.length
    ? lint.messages.map((m) => `> ${m.replace(/\n/g, "\n> ")}`).join("\n>\n")
    : "";

  // Hint: prefer runtime hint, fall back to lint description.
  const hint = runtime?.hint || lint?.description || "";

  // Related: other slugs in the same category.
  const related = ALL_SLUGS.filter(
    (s) => s !== slug && slugCategory(s) === category
  );

  // Frontmatter description must avoid quotes/colons that break YAML;
  // strip newlines and trim.
  const frontmatterDescription = description
    .replace(/[\n\r]/g, " ")
    .replace(/"/g, "'")
    .trim();

  const lines = [];
  lines.push("---");
  lines.push(`title: ${slug}`);
  lines.push(`description: "${frontmatterDescription}"`);
  lines.push("---");
  lines.push("");
  lines.push(
    'import { Aside, Badge } from "@astrojs/starlight/components";'
  );
  lines.push("");
  lines.push(`<Badge text="${category}" variant="tip" />`);
  if (lint) lines.push('<Badge text="lint" variant="note" />');
  if (runtime) lines.push('<Badge text="runtime" variant="caution" />');
  if (analyzerStrictRules.length)
    lines.push('<Badge text="analyzer" variant="success" />');
  lines.push("");
  lines.push(description);
  lines.push("");

  lines.push("## Surfaces");
  lines.push("");
  lines.push("| Surface | Where this slug appears |");
  lines.push("|---|---|");
  for (const [k, v] of surfaces) lines.push(`| ${k} | ${v} |`);
  lines.push("");

  if (hint) {
    lines.push("## Hint");
    lines.push("");
    lines.push(hint);
    lines.push("");
  }

  if (diagnosticBlock) {
    lines.push("## Diagnostic message");
    lines.push("");
    lines.push(diagnosticBlock);
    lines.push("");
  }

  if (related.length) {
    lines.push("## Related rules");
    lines.push("");
    for (const r of related) {
      lines.push(`- [\`${r}\`](/awaitly/rules/${r}/)`);
    }
    lines.push("");
  }

  lines.push("## See also");
  lines.push("");
  lines.push("- [Slug Spine reference](/awaitly/reference/spine/)");
  if (lint) lines.push("- [ESLint plugin guide](/awaitly/guides/eslint-plugin/)");
  if (analyzerStrictRules.length)
    lines.push(
      "- [Static analysis with --doctor](/awaitly/guides/static-analysis/#-doctor--strict-diagnostics-with-slug-codes)"
    );
  if (runtime) lines.push("- [Tagged Errors](/awaitly/foundations/tagged-errors/)");
  lines.push("");

  return lines.join("\n");
}

// =============================================================================
// Write files
// =============================================================================

mkdirSync(RULES_DIR, { recursive: true });

// Clean stale rule pages (slugs that no longer exist).
const existing = existsSync(RULES_DIR)
  ? readdirSync(RULES_DIR).filter(
      (f) => f.endsWith(".mdx") && f !== "index.mdx"
    )
  : [];
const expected = new Set(ALL_SLUGS.map((s) => `${s}.mdx`));
for (const file of existing) {
  if (!expected.has(file)) {
    unlinkSync(join(RULES_DIR, file));
    process.stdout.write(`removed stale ${file}\n`);
  }
}

// Generate each page.
let written = 0;
for (const slug of ALL_SLUGS) {
  const out = join(RULES_DIR, `${slug}.mdx`);
  writeFileSync(out, render(slug), "utf8");
  written++;
}

process.stdout.write(
  `generated ${written} rule page(s) at ${RULES_DIR}\n`
);
```

- [ ] **Step 2: Make the script executable and verify it parses**

```bash
cd /Users/jreehal/dev/js/awaitly
chmod +x apps/docs-site/scripts/generate-rule-pages.mjs
node --check apps/docs-site/scripts/generate-rule-pages.mjs
```

Expected: no output (parse OK).

- [ ] **Step 3: Commit (script only — no MDX yet)**

```bash
git add apps/docs-site/scripts/generate-rule-pages.mjs
git commit -m "feat(docs): rule-page generator script"
```

---

## Task 3: Run the generator, verify output, write the rules landing page

**Files:**
- Create: `apps/docs-site/src/content/docs/rules/index.mdx`
- Generated (×31): `apps/docs-site/src/content/docs/rules/<slug>.mdx`

- [ ] **Step 1: Build awaitly and the lint plugin so the generator's imports resolve**

```bash
cd /Users/jreehal/dev/js/awaitly
pnpm --filter awaitly --filter eslint-plugin-awaitly --filter awaitly-analyze build 2>&1 | tail -8
```

Expected: builds complete with no errors.

- [ ] **Step 2: Run the generator from the docs-site directory**

```bash
cd /Users/jreehal/dev/js/awaitly/apps/docs-site
node scripts/generate-rule-pages.mjs
```

Expected output ends with: `generated 31 rule page(s) at /Users/jreehal/dev/js/awaitly/apps/docs-site/src/content/docs/rules`.

- [ ] **Step 3: Confirm 31 MDX files appeared**

```bash
ls /Users/jreehal/dev/js/awaitly/apps/docs-site/src/content/docs/rules/*.mdx | wc -l
```

Expected output: `31` (or `32` once the index.mdx in Step 4 is created).

- [ ] **Step 4: Write the rules landing page**

Create `/Users/jreehal/dev/js/awaitly/apps/docs-site/src/content/docs/rules/index.mdx`:

```mdx
---
title: Rule Index
description: Every canonical awaitly slug, grouped by category. Each rule page is the single destination for runtime errors, lint diagnostics, and analyzer doctor output.
sidebar:
  order: 0
---

import { Card, CardGrid } from "@astrojs/starlight/components";

Every canonical awaitly slug has a page here. The same slug appears on runtime errors (`error.code`), ESLint rule names (`awaitly/<slug>`), and `awaitly-analyze --doctor` diagnostics. One identifier, one destination.

See the [Slug Spine reference](/awaitly/reference/spine/) for the design.

<CardGrid>
  <Card title="step-*" icon="seti:typescript">
    step() discipline: id, thunk, nesting, options
  </Card>
  <Card title="workflow-*" icon="seti:typescript">
    createWorkflow / run / runWithState shape
  </Card>
  <Card title="result-*" icon="seti:typescript">
    Result usage
  </Card>
  <Card title="error-*" icon="warning">
    Boundary handling
  </Card>
  <Card title="concurrency-*" icon="seti:typescript">
    step.all / step.map / step.race vs Promise.*
  </Card>
  <Card title="runtime-*" icon="warning">
    Runtime-only failures: timeout, retry-exhausted, rate-limit, ...
  </Card>
</CardGrid>

Every rule page is generated by `apps/docs-site/scripts/generate-rule-pages.mjs` from the canonical sources of truth (`awaitly/slugs`, `awaitly/errors`, `eslint-plugin-awaitly`, `awaitly-analyze`). To add a new rule, add the slug to `packages/awaitly/src/slugs.ts` and re-run the generator — the page is regenerated, sidebar entry appears automatically, and the cross-surface parity test fails until the surface assertions match.
```

- [ ] **Step 5: Spot-check a generated page**

Run: `cat /Users/jreehal/dev/js/awaitly/apps/docs-site/src/content/docs/rules/runtime-step-timeout.mdx`

Expected: a frontmatter block, badges for `runtime` and `runtime` variant, surfaces table mentioning `TimeoutError`, the hint string, and Related-rules and See-also sections.

- [ ] **Step 6: Commit the generated pages plus the landing page**

```bash
cd /Users/jreehal/dev/js/awaitly
git add apps/docs-site/src/content/docs/rules
git commit -m "feat(docs): generate 31 rule pages from canonical slug spine"
```

---

## Task 4: Wire `Rules` into the starlight sidebar

**Files:**
- Modify: `apps/docs-site/astro.config.mjs:175-181` (the existing `Reference` sidebar block)

- [ ] **Step 1: Add the `Rules` sidebar group**

In `/Users/jreehal/dev/js/awaitly/apps/docs-site/astro.config.mjs`, find the existing block:

```js
        {
          label: 'Reference',
          items: [
            { label: 'Quick Reference', slug: 'reference/quick-reference' },
            { label: 'API', slug: 'reference/api' },
            { label: 'Slug Spine', slug: 'reference/spine' },
          ],
        },
```

Replace with:

```js
        {
          label: 'Reference',
          items: [
            { label: 'Quick Reference', slug: 'reference/quick-reference' },
            { label: 'API', slug: 'reference/api' },
            { label: 'Slug Spine', slug: 'reference/spine' },
          ],
        },
        {
          label: 'Rules',
          collapsed: true,
          autogenerate: { directory: 'rules' },
        },
```

- [ ] **Step 2: Build the docs site to verify the sidebar renders**

```bash
cd /Users/jreehal/dev/js/awaitly
pnpm --filter awaitly-docs build 2>&1 | tail -10
```

Expected: build completes; the line `Found 75 HTML files` increases by ~32 (31 rule pages + 1 index).

- [ ] **Step 3: Confirm rule pages render**

```bash
ls /Users/jreehal/dev/js/awaitly/apps/docs-site/dist/rules | head -5
ls /Users/jreehal/dev/js/awaitly/apps/docs-site/dist/rules | wc -l
```

Expected: 32 directories (31 slugs + index), each containing an `index.html`.

- [ ] **Step 4: Commit**

```bash
git add apps/docs-site/astro.config.mjs
git commit -m "feat(docs): add Rules sidebar group with autogenerated entries"
```

---

## Task 5: Wire the generator into the docs build pipeline

**Files:**
- Modify: `apps/docs-site/package.json` (scripts block)

The generator must run before `astro build` so fresh rule pages exist for the build, and must run before any local `pnpm dev` so authors see the latest content.

- [ ] **Step 1: Read the current scripts block**

Run: `cat /Users/jreehal/dev/js/awaitly/apps/docs-site/package.json | python3 -c "import sys, json; print(json.dumps(json.load(sys.stdin)['scripts'], indent=2))"`

Note the existing entries (`dev`, `start`, `dev:root`, `build`, `generate-api`, `preview`, `astro`).

- [ ] **Step 2: Modify the scripts to include rule generation**

Edit `/Users/jreehal/dev/js/awaitly/apps/docs-site/package.json`. Find the `"scripts"` block and:

1. Add a new `"generate-rules"` script: `"node scripts/generate-rule-pages.mjs"`.
2. Update `"build"` to call it after `generate-api` and before `astro build`. The current build is `"pnpm run generate-api && astro build"`; replace with `"pnpm run generate-api && pnpm run generate-rules && astro build"`.
3. Add `"predev"`: `"pnpm run generate-rules"` so local dev picks up the latest rule pages.

The relevant subset of the resulting `"scripts"` block:

```json
{
  "scripts": {
    "predev": "pnpm run generate-rules",
    "dev": "...existing...",
    "generate-api": "...existing...",
    "generate-rules": "node scripts/generate-rule-pages.mjs",
    "build": "pnpm run generate-api && pnpm run generate-rules && astro build",
    "preview": "...existing..."
  }
}
```

(Preserve every other existing script verbatim. Only the three above change.)

- [ ] **Step 3: Verify the wired build still passes**

```bash
cd /Users/jreehal/dev/js/awaitly
pnpm --filter awaitly-docs build 2>&1 | tail -10
```

Expected: build passes; `generated 31 rule page(s)` appears in the output before `astro build`.

- [ ] **Step 4: Commit**

```bash
git add apps/docs-site/package.json
git commit -m "build(docs): run generate-rules before astro build and dev"
```

---

## Task 6: Cross-surface parity test for rule pages

**Files:**
- Create: `apps/docs-site/scripts/__tests__/rule-pages-parity.test.ts`
- Create or modify: `apps/docs-site/vitest.config.ts`
- Modify: `apps/docs-site/package.json` (add `test` script)

This is the gate: every slug in `awaitly/slugs` must have a generated rule page. Adding a slug without regenerating breaks CI.

- [ ] **Step 1: Check whether docs-site already has a vitest config**

Run: `ls /Users/jreehal/dev/js/awaitly/apps/docs-site/vitest.config.ts 2>/dev/null && echo exists || echo missing`

If missing, create it (Step 2). If it exists, skip Step 2.

- [ ] **Step 2 (only if missing): Create a minimal vitest config**

Create `/Users/jreehal/dev/js/awaitly/apps/docs-site/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Add the parity test**

Create `/Users/jreehal/dev/js/awaitly/apps/docs-site/scripts/__tests__/rule-pages-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_SLUGS } from "awaitly/slugs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, "..", "..", "src", "content", "docs", "rules");

describe("rule pages parity with slugs.ts", () => {
  it("every slug has a generated rule page MDX", () => {
    const missing: string[] = [];
    for (const slug of ALL_SLUGS) {
      const file = join(RULES_DIR, `${slug}.mdx`);
      if (!existsSync(file)) missing.push(slug);
    }
    expect(missing, `Missing rule pages: ${missing.join(", ")}`).toEqual([]);
  });

  it("the rules directory has a hand-authored index.mdx", () => {
    expect(existsSync(join(RULES_DIR, "index.mdx"))).toBe(true);
  });
});
```

- [ ] **Step 4: Add a `test` script to docs-site**

Edit `/Users/jreehal/dev/js/awaitly/apps/docs-site/package.json`. Add to the `"scripts"` block:

```json
"test": "vitest run"
```

- [ ] **Step 5: Run the parity test**

```bash
cd /Users/jreehal/dev/js/awaitly/apps/docs-site
pnpm test 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 6: Confirm vitest is available as a dependency**

Run: `grep -E '"vitest"' /Users/jreehal/dev/js/awaitly/apps/docs-site/package.json`

If no match, add vitest as a dev dep:

```bash
cd /Users/jreehal/dev/js/awaitly/apps/docs-site
pnpm add -D vitest
```

Then re-run Step 5 to confirm.

- [ ] **Step 7: Commit**

```bash
cd /Users/jreehal/dev/js/awaitly
git add apps/docs-site/scripts/__tests__/rule-pages-parity.test.ts apps/docs-site/vitest.config.ts apps/docs-site/package.json
git commit -m "test(docs): parity test asserting every slug has a rule page"
```

---

## Task 7: Reconcile `slugDocsUrl` with the actual deployed URL

**Files:**
- Modify (Option A): nothing — set up `awaitly.dev` as a custom domain on GitHub Pages.
- Modify (Option B): `packages/awaitly/src/slugs.ts` — change `slugDocsUrl` to return the GitHub Pages URL.

Today, `slugDocsUrl('runtime-step-timeout')` returns `https://awaitly.dev/rules/runtime-step-timeout`. The docs site is deployed at `https://jagreehal.github.io/awaitly/`. Until those match, every `error.docsUrl` is a 404.

This is a **maintainer decision**, not an automatable one. The plan presents both options; pick one.

### Option A: keep `awaitly.dev` and configure the custom domain

1. Confirm you own the `awaitly.dev` domain.
2. In the GitHub repo, go to Settings → Pages → set custom domain to `awaitly.dev`. GitHub creates a `CNAME` file in the published branch.
3. At your DNS provider, add `CNAME awaitly.dev → jagreehal.github.io`.
4. Wait for DNS propagation; GitHub will issue a TLS cert.
5. Verify: `curl -I https://awaitly.dev/rules/runtime-step-timeout` returns `HTTP/2 200`.

No code change required. Slug URLs continue to use `awaitly.dev`.

### Option B: change `slugDocsUrl` to point at GitHub Pages

This is a **breaking change** to `slugDocsUrl`. Use only if you're not going to set up `awaitly.dev`.

- [ ] **Step 1 (Option B only): Update `slugDocsUrl`**

In `/Users/jreehal/dev/js/awaitly/packages/awaitly/src/slugs.ts`:

```ts
/** Returns the canonical docs URL for a slug. */
export function slugDocsUrl(slug: AwaitlySlug): string {
  return `https://jagreehal.github.io/awaitly/rules/${slug}/`;
}
```

- [ ] **Step 2 (Option B only): Update tests asserting the URL shape**

In `packages/awaitly/src/slugs.test.ts`, find the `slugDocsUrl renders the canonical URL` test and update the expected value to `https://jagreehal.github.io/awaitly/rules/runtime-step-timeout/`.

In `packages/awaitly/src/errors-spine.test.ts`, the `TimeoutError` test asserts `e.docsUrl === 'https://awaitly.dev/rules/runtime-step-timeout'`. Update similarly.

In `packages/awaitly/src/spine-integrity.test.ts`, the `every awaitly-system error's docsUrl is canonical` test compares against the URL formula — that one is auto-derived and will keep passing.

In `packages/awaitly/src/errors-spine.test.ts`, the `spine fields appear in JSON.stringify output` test asserts the URL — update.

In `packages/awaitly-visualizer/src/error-code-parity.test.ts` and other parity tests — search for `awaitly.dev` and update.

Run: `grep -rn 'awaitly\.dev' /Users/jreehal/dev/js/awaitly/packages --include='*.ts' | grep -v node_modules`

Update every match.

- [ ] **Step 3 (Option B only): Rebuild awaitly and re-run all tests**

```bash
cd /Users/jreehal/dev/js/awaitly
pnpm --filter awaitly build
pnpm -r test 2>&1 | tail -10
```

Expected: every test passes.

- [ ] **Step 4 (Option B only): Commit**

```bash
git add packages/awaitly/src/slugs.ts packages/awaitly/src/slugs.test.ts packages/awaitly/src/errors-spine.test.ts packages/awaitly-visualizer/src/error-code-parity.test.ts
git commit -m "fix(awaitly): point slugDocsUrl at the deployed GitHub Pages site"
```

### Verification (either option)

After deployment, this should resolve:

```bash
curl -sI https://awaitly.dev/rules/runtime-step-timeout/ | head -1
# OR
curl -sI https://jagreehal.github.io/awaitly/rules/runtime-step-timeout/ | head -1
```

Expected: `HTTP/2 200`.

---

## Self-Review Notes

Spec coverage check:
- ✅ Generator script (Task 2) reads four canonical sources and writes one MDX per slug.
- ✅ Sidebar wiring (Task 4) — autogenerated from the directory.
- ✅ Build pipeline integration (Task 5).
- ✅ Parity test (Task 6) — every slug has a page.
- ✅ URL reconciliation (Task 7) — explicit decision required from the maintainer.
- ✅ Roster export (Task 1) so the generator stays in sync as classes are added.
- ❌ Hand-authored wrong/right examples per slug — explicitly deferred. The auto-derived diagnostic message + hint + surfaces table is enough to make `error.docsUrl` resolve to a useful page.

Type consistency check:
- `AWAITLY_SYSTEM_ERROR_CLASSES` exported from `errors.ts`, re-exported from `errors-entry.ts`, consumed by `generate-rule-pages.mjs` via `awaitly/errors`. Single name, three reference points.
- `STRICT_RULE_TO_SLUG` consumed via `awaitly-analyze` (already exported from its index in earlier work).
- The generator imports `eslint-plugin-awaitly` as a default export (matches the package's `export default plugin`).

Placeholder scan: no TBD, TODO, or "fill in details". Each generator step has full code; each verification step has the exact command and expected output.

---

## Follow-on plans (not in this plan)

1. **Hand-authored examples per slug.** Add a `apps/docs-site/src/data/rule-examples.ts` keyed by slug containing wrong/right code snippets and a "why-it-matters" paragraph. Generator merges them into the page when present.
2. **Per-rule autofix metadata.** Lint rules that ship autofixes should surface that on the page. Pull from `meta.fixable`.
3. **Skill catalogue split.** `.claude/skills/awaitly-patterns/SKILL.md` is still the 1256-line monolith; splitting into `rules/<slug>.md` lets the generator pull skill content for each page (Plan from the AI-friendly redesign spec, deferred from the foundation plan).
