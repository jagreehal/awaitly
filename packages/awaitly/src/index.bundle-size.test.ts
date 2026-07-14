import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

describe("root entry bundle budget", () => {
  it("keeps awaitly root entry lightweight", () => {
    const rootDist = resolve(__dirname, "../dist/index.js");
    if (!existsSync(rootDist)) {
      // Hermetic: skip when dist not built (e.g. clean checkout). Run after build to enforce.
      return;
    }
    const { size } = statSync(rootDist);
    // Guardrail: root entry should stay close to a minimal Result-focused bundle.
    // Budget breakdown (approximate, minified):
    //   ~12KB — Result core, TaggedError factory, Awaitly namespace
    //   ~3KB  — AI-DX slug spine: runtime-* hint strings, code/hint/docsUrl
    //           property descriptors, slugDocsUrl helper. Every awaitly-system
    //           error carries this — see docs/superpowers/specs/2026-05-09-ai-friendly-redesign-design.md
    //   ~2KB  — per-dep policies (retry/timeout/fallback) + TimeoutError.
    //           Deliberately in the root: policies are canonical deps-first
    //           API and replace the retry/circuit-breaker/reliability
    //           sub-path entries in the canonical-core release.
    //
    // If you grow the root bundle beyond ~19KB, reconsider: can the addition
    // live behind a sub-path entry (awaitly/slugs, awaitly/errors) instead?
    expect(size).toBeLessThan(19_000);
  });
});
