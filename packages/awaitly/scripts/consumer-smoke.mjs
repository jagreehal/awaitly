#!/usr/bin/env node
/**
 * Consumer smoke test: pack the tarball, install it into an empty project, and
 * typecheck with `skipLibCheck: false`.
 *
 * This exists because awaitly 4.2.0 shipped public `.d.ts` files that imported
 * `@standard-schema/spec` while declaring it an OPTIONAL peer dependency. Every
 * consumer who ran `pnpm add awaitly` without `skipLibCheck` got
 * `Cannot find module '@standard-schema/spec'`. Nothing in the repo caught it,
 * because inside the workspace the package is always installed.
 *
 * The rule this enforces: what the tarball declares must be enough to compile
 * against it. Run with `pnpm smoke`.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const entryPoints = Object.keys(manifest.exports).map((entry) =>
  entry === "." ? manifest.name : `${manifest.name}${entry.slice(1)}`
);
const work = mkdtempSync(join(tmpdir(), "awaitly-smoke-"));
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  console.log("packing…");
  run("pnpm", ["pack", "--pack-destination", work], pkgDir);
  const tarball = readdirSync(work).find((f) => f.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack produced no tarball");

  const consumer = join(work, "consumer");
  mkdirSync(join(consumer, "src"), { recursive: true });
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({ name: "consumer-smoke", version: "1.0.0", private: true, type: "module" })
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        // The whole point: a consumer must not need this to compile.
        skipLibCheck: false,
        noEmit: true,
      },
      include: ["src"],
    })
  );
  // Touch every public entry point, so a missing type anywhere surfaces here.
  writeFileSync(
    join(consumer, "src/index.ts"),
    `import { run, ok, err, match, retry, createWorkflow, type AsyncResult } from 'awaitly';
import { createSagaWorkflow } from 'awaitly/durable';
import { ok as okResult } from 'awaitly/result';
import { createWorkflowHarness } from 'awaitly/testing';

const getUser = async (id: string): AsyncResult<{ id: string }, 'NOT_FOUND'> =>
  id ? ok({ id }) : err('NOT_FOUND');

const result = await run({ getUser: retry(getUser, { attempts: 2 }) }, async (s) => s.getUser('1'));

export const out = match(result, {
  ok: (v): string => v.id,
  NOT_FOUND: () => 'missing',
  UnexpectedError: () => 'boom',
});
export { createWorkflow, createSagaWorkflow, okResult, createWorkflowHarness };
`
  );
  // Derive coverage from the manifest so new public entries cannot be missed.
  writeFileSync(
    join(consumer, "src/entries.mts"),
    entryPoints.map((entry, index) => `export * as entry${index} from ${JSON.stringify(entry)};`).join("\n")
  );
  writeFileSync(
    join(consumer, "src/entries.cts"),
    entryPoints.map((entry, index) =>
      `import entry${index} = require(${JSON.stringify(entry)});\nexport { entry${index} };`
    ).join("\n")
  );

  const assertions = `
const { ok, run } = entries[0];
const result = await run({ getValue: async () => ok(42) }, async (steps) => steps.getValue());
if (!result.ok || result.value !== 42) throw new Error('Packaged workflow failed');
`;
  writeFileSync(
    join(consumer, "smoke.mjs"),
    `const entries = await Promise.all(${JSON.stringify(entryPoints)}.map((entry) => import(entry)));\n${assertions}`
  );
  writeFileSync(
    join(consumer, "smoke.cjs"),
    `const entries = ${JSON.stringify(entryPoints)}.map((entry) => require(entry));\n(async () => {${assertions}})().catch((error) => { console.error(error); process.exitCode = 1; });`
  );

  console.log("installing tarball into a clean project…");
  run("pnpm", ["install", "--ignore-workspace", join(work, tarball)], consumer);

  console.log("typechecking with skipLibCheck: false…");
  run(join(pkgDir, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], consumer);

  console.log("loading all public entries and running a workflow in ESM and CommonJS…");
  run(process.execPath, ["smoke.mjs"], consumer);
  run(process.execPath, ["smoke.cjs"], consumer);

  console.log("consumer smoke test passed");
} catch (error) {
  const detail = [error.stdout, error.stderr].filter(Boolean).join("\n") || error.message;
  console.error("consumer smoke test FAILED\n");
  console.error(detail);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
