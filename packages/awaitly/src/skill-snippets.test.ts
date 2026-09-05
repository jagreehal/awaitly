/**
 * Typecheck the code samples in .claude/skills/awaitly-patterns/SKILL.md
 * against the built type declarations.
 *
 * The skill is what an agent reads before writing awaitly code, so a sample
 * with a stale signature teaches the wrong API. A `mongo(url, { lock: {} })`
 * sample survived review in this file's own history; `mongo` takes one
 * argument.
 *
 * Samples are illustrative, so they reference variables they never declare
 * (`deps`, `result`, `id`). Those produce "cannot find name", which says
 * nothing about the API and is ignored. The codes kept below are the ones that
 * mean a sample and the package disagree.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(__dirname, "../../..");
const SKILL = join(REPO, ".claude/skills/awaitly-patterns/SKILL.md");

/** Subpath specifier to the declaration file a consumer resolves it to. */
const MODULE_MAP: Record<string, string> = {
  awaitly: "packages/awaitly/dist/index.d.ts",
  "awaitly/result": "packages/awaitly/dist/result.d.ts",
  "awaitly/durable": "packages/awaitly/dist/durable.d.ts",
  "awaitly/testing": "packages/awaitly/dist/testing.d.ts",
  "awaitly-mongo": "packages/awaitly-mongo/dist/index.d.ts",
};

/** Errors that mean the sample and the package disagree about the API. */
const API_DRIFT_CODES = new Set([
  2305, // module has no exported member
  2322, // type not assignable (e.g. an option given the wrong type)
  2307, // cannot find module
  2339, // property does not exist on type
  2345, // argument type not assignable
  2353, // object literal may only specify known properties
  2554, // expected N arguments, got M
  2555, // expected at least N arguments
  2724, // has no exported member named X, did you mean Y
  2769, // no overload matches this call
]);

function extractSnippets(markdown: string): string[] {
  const blocks = markdown.match(/```typescript\n[\S\s]*?```/g) ?? [];
  return blocks
    .map((block) => block.replace(/^```typescript\n/, "").replace(/```$/, ""))
    .filter((code) => /from ["']awaitly[^"']*["']/.test(code));
}

/**
 * Imports must stay at the top level, and the rest is wrapped so a sample can
 * use `await` and `return` the way the surrounding prose shows it.
 */
function toCheckableSource(code: string): string {
  const lines = code.split("\n");
  const imports: string[] = [];
  const body: string[] = [];

  let inImport = false;
  for (const line of lines) {
    if (/^\s*import\b/.test(line)) inImport = true;
    if (inImport) {
      imports.push(line);
      if (line.includes(";") || /["']\s*$/.test(line)) inImport = false;
      continue;
    }
    body.push(line);
  }

  const rewritten = imports.map((line) =>
    line.replace(/(["'])(awaitly[^"']*)\1/g, (match, quote, specifier) => {
      const target = MODULE_MAP[specifier];
      return target
        ? `${quote}${join(REPO, target).replace(/\.d\.ts$/, "")}${quote}`
        : match;
    })
  );

  return `${rewritten.join("\n")}\nexport async function __snippet() {\n${body.join("\n")}\n}\n`;
}

/** Typecheck the given samples and return the drift lines, one per problem. */
function driftIn(snippets: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "awaitly-skill-"));
  try {
    snippets.forEach((code, index) => {
      writeFileSync(join(dir, `snippet-${index}.ts`), toCheckableSource(code));
    });

    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "es2022",
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        include: ["*.ts"],
      })
    );

    let output = "";
    try {
      execFileSync(
        resolve(__dirname, "../node_modules/.bin/tsc"),
        ["-p", join(dir, "tsconfig.json")],
        { encoding: "utf8" }
      );
    } catch (error) {
      output = String((error as { stdout?: string }).stdout ?? "");
    }

    return output.split("\n").filter((line) => {
      const match = /error TS(\d+):/.exec(line);
      if (!match || !API_DRIFT_CODES.has(Number(match[1]))) return false;
      // A sample may import a third-party package to make its point. Only
      // awaitly specifiers are resolvable here, and only they can drift.
      if (
        match[1] === "2307" &&
        !/Cannot find module '(awaitly|.*\/awaitly)/.test(line)
      ) {
        return false;
      }
      // Undeclared example variables are ignored (TS2304), so property access
      // on the resulting `unknown` says nothing about the API.
      return !line.includes("does not exist on type 'unknown'");
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TSC_TIMEOUT_MS = 120_000;

const built = () =>
  Object.values(MODULE_MAP).every((p) => existsSync(join(REPO, p)));

describe("SKILL.md samples match the built API", () => {
  it("has samples to check", () => {
    expect(existsSync(SKILL)).toBe(true);
    expect(extractSnippets(readFileSync(SKILL, "utf8")).length).toBeGreaterThan(
      10
    );
  });

  it(
    "uses no signature the package does not have, and reports ones that do",
    () => {
      if (!built()) return; // Hermetic: enforced after build, like the bundle budgets.

      // Deliberately broken samples ride along in the same compile. Each was
      // discarded by an earlier version of the allowlist, and spawning tsc per
      // case pushed the suite past its timeouts.
      const regressions = [
        {
          label: "unknown option key",
          code: `import { mongo } from 'awaitly-mongo';\nconst s = mongo({ uri: 'x' });`,
          drifts: true,
        },
        {
          label: "unknown export",
          code: `import { notARealExport } from 'awaitly';\nconsole.log(notARealExport);`,
          drifts: true,
        },
        {
          label: "wrong argument count",
          code: `import { mongo } from 'awaitly-mongo';\nconst s = mongo('a', 'b');`,
          drifts: true,
        },
        {
          label: "wrong option type",
          code: `import { durable } from 'awaitly/durable';\nconst r = durable.run({}, async () => 1, { id: 42 });`,
          drifts: true,
        },
        {
          label: "matches the API",
          code: `import { mongo } from 'awaitly-mongo';\nconst store = mongo({ url: 'mongodb://localhost:27017' });`,
          drifts: false,
        },
      ];

      const samples = extractSnippets(readFileSync(SKILL, "utf8"));
      const all = [...samples, ...regressions.map((r) => r.code)];
      const lines = driftIn(all);

      const reportedIn = (index: number) =>
        lines.some((line) => line.includes(`snippet-${index}.ts`));

      regressions.forEach((regression, offset) => {
        expect(
          reportedIn(samples.length + offset),
          `${regression.label}: ${lines.join(" | ")}`
        ).toBe(regression.drifts);
      });

      const drift = lines
        .filter((line) => {
          const which = /snippet-(\d+)\.ts/.exec(line)?.[1];
          return which !== undefined && Number(which) < samples.length;
        })
        .map((line) => {
          const which = Number(/snippet-(\d+)\.ts/.exec(line)![1]);
          return `${line}\n    sample #${which}:\n${samples[which]
            ?.split("\n")
            .slice(0, 6)
            .map((l) => `      ${l}`)
            .join("\n")}`;
        });

      expect(drift.join("\n\n")).toBe("");
    },
    TSC_TIMEOUT_MS
  );
});
