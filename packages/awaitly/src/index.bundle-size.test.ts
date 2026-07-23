import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Bundle budgets for the public entries.
 *
 * Two size contracts, enforced against what a consumer's bundler keeps
 * (dist is shipped UNMINIFIED so consumer bundlers can tree-shake —
 * pre-minifying strips @__PURE__ annotations and rewrites patterns into
 * unshakeable forms; that single setting once cost every consumer ~27KB):
 *
 * 1. `awaitly/result` — the guarantee entry. The WHOLE entry minifies
 *    under ~10KB with zero bundler trust required. This is the
 *    serverless/size story (the neverthrow-class claim).
 * 2. `awaitly` — the front door. Carries the engine, but minimal imports
 *    must tree-shake to a few KB; the engine itself has a ceiling.
 */
describe("bundle budgets", () => {
  const distEntry = (name: string) => resolve(__dirname, `../dist/${name}.js`);
  const rootDist = distEntry("index");
  const resultDist = distEntry("result");
  const esbuildBin = resolve(__dirname, "../node_modules/.bin/esbuild");

  const built = () => existsSync(rootDist) && existsSync(resultDist) && existsSync(esbuildBin);

  const minifiedSize = (entrySource: string): number => {
    const dir = mkdtempSync(join(tmpdir(), "awaitly-bundle-"));
    try {
      const entry = join(dir, "entry.mjs");
      const out = join(dir, "out.mjs");
      writeFileSync(entry, entrySource);
      execFileSync(esbuildBin, [entry, "--bundle", "--minify", "--platform=node", "--format=esm", `--outfile=${out}`]);
      return statSync(out).size;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const importProbe = (dist: string, names: string[]) =>
    `import { ${names.join(", ")} } from ${JSON.stringify(dist)};\nconsole.log(${names.join(", ")});\n`;

  it("guarantees awaitly/result: the whole entry stays small (no tree-shaking required)", () => {
    if (!built()) return; // Hermetic: run after build to enforce.
    expect(minifiedSize(importProbe(resultDist, ["ok"]).replace(/import \{ ok \}.*\n/, `export * from ${JSON.stringify(resultDist)};\n`))).toBeLessThan(10_000);
  });

  it("guarantees awaitly/result: primitives import stays tiny", () => {
    if (!built()) return;
    expect(minifiedSize(importProbe(resultDist, ["ok", "err", "isOk", "isErr"]))).toBeLessThan(4_000);
  });

  it("keeps minimal Result imports from the root entry tree-shakeable", () => {
    if (!built()) return;
    // The front door must not tax primitive users with the engine.
    expect(minifiedSize(importProbe(rootDist, ["ok", "err", "isOk", "isErr"]))).toBeLessThan(6_000);
  });

  it("keeps run + policies within the engine ceiling", () => {
    if (!built()) return;
    expect(
      minifiedSize(importProbe(rootDist, ["ok", "err", "run", "retry", "timeout", "fallback"]))
    ).toBeLessThan(40_000);
  });

  it("keeps each task-shaped entry within its whole-entry budget", () => {
    if (!built()) return;

    const budgets = {
      run: 36_000,
      workflow: 70_000,
      reliability: 22_000,
      durable: 72_000,
      persistence: 10_000,
      saga: 58_000,
      hitl: 12_000,
      streaming: 13_000,
      webhook: 9_000,
      engine: 70_000,
      testing: 65_000,
    } as const;

    for (const [name, budget] of Object.entries(budgets)) {
      const entry = distEntry(name);
      expect(existsSync(entry), `missing dist/${name}.js`).toBe(true);
      expect(
        minifiedSize(`export * from ${JSON.stringify(entry)};\n`),
        `${name} exceeded its ${budget}-byte whole-entry budget`,
      ).toBeLessThan(budget);
    }
  });

  it("keeps the raw root entry below the absorbed-core ceiling", () => {
    if (!existsSync(rootDist)) return;
    // Unminified raw ceiling: catches accidental absorption of the
    // focused production capabilities belong to their own entry points.
    expect(statSync(rootDist).size).toBeLessThan(150_000);
  });
});
