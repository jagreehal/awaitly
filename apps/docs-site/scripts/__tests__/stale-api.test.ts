/**
 * Guards the docs against documenting APIs that no longer exist.
 *
 * Nothing compiles the code in `.md`, `.mdx`, or `.astro`, so removed APIs
 * survive here long after they are gone from the library — the landing page
 * imported `createWorkflow` from `awaitly/workflow` for two majors after that
 * entry point was deleted, on the most-read page of the site.
 *
 * These are mechanical checks over the prose sources, not a type-checker.
 * They catch the shapes that have actually rotted.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, "..", "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(mdx?|astro)$/.test(e.name) ? [full] : [];
  });
}

const files = sourceFiles(SRC);

/** Landing components mark up code with spans; strip them to get the code back. */
const asCode = (src: string) =>
  src
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const label = (f: string) => relative(SRC, f);

describe("docs do not reference removed APIs", () => {
  // Folded into `awaitly` or `awaitly/durable` in v4. The surviving entry
  // points are `awaitly`, `awaitly/result`, `awaitly/durable`, `awaitly/testing`.
  const REMOVED_ENTRY_POINTS = new Set([
    "run",
    "workflow",
    "reliability",
    "persistence",
    "saga",
    "hitl",
    "streaming",
    "webhook",
    "engine",
  ]);

  it("imports only from the four entry points", () => {
    // Matches the whole quoted specifier, so ESLint rule names such as
    // 'awaitly/workflow-no-floating' are not mistaken for entry points.
    const offenders = files.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/['"]awaitly\/([a-z-]+)['"]/g)]
        .filter((m) => REMOVED_ENTRY_POINTS.has(m[1]!))
        .map((m) => `${label(f)}: 'awaitly/${m[1]}'`)
    );
    expect(offenders, `Removed entry points:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("never calls a workflow directly — createWorkflow returns an object", () => {
    // Precise rather than heuristic: only flag a name the same file binds to
    // createWorkflow. Callback-taking helpers (run, runSaga, withScope, and
    // anything a page defines itself) are therefore never false positives.
    const offenders = files.flatMap((f) => {
      const code = asCode(readFileSync(f, "utf8"));
      const workflows = new Set(
        [...code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createWorkflow\s*\(/g)]
          .map((m) => m[1]!)
      );
      if (workflows.size === 0) return [];
      return [...code.matchAll(/await\s+([A-Za-z_$][\w$]*)\(\s*(?:async\s*)?\(/g)]
        .filter((m) => workflows.has(m[1]!))
        .map((m) => `${label(f)}: await ${m[1]}(...) — use ${m[1]}.run(...)`);
    });
    expect(offenders, `Callable workflow form:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("has no `as const` on error declarations", () => {
    // `errors`, `step.try`'s `error`, and `catchUnexpected` are const type
    // parameters since 4.1, so the literal survives without help.
    const offenders = files.flatMap((f) =>
      [...asCode(readFileSync(f, "utf8"))
        .matchAll(/(?:errors?|catchUnexpected)\s*:[^\n]*?'[A-Z_]+'\s+as const/g)]
        .map((m) => `${label(f)}: ${m[0].trim()}`)
    );
    expect(offenders, `Unnecessary \`as const\`:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("uses the current step and option names", () => {
    const RENAMED: Array<[RegExp, string]> = [
      [/\bstep\.parallel\s*\(/g, "step.parallel() is now step.all()"],
      [/\bAwaitly\.[A-Z_]/g, "the Awaitly namespace object was removed"],
      [/\bretryOn\s*:/g, "retryOn is now shouldRetry"],
    ];
    const offenders = files.flatMap((f) => {
      const code = asCode(readFileSync(f, "utf8"));
      return RENAMED.flatMap(([rx, why]) =>
        [...code.matchAll(rx)].map((m) => `${label(f)}: ${m[0].trim()} — ${why}`)
      );
    });
    expect(offenders, `Renamed APIs:\n${offenders.join("\n")}`).toEqual([]);
  });
});
