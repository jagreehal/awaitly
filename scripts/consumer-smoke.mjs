#!/usr/bin/env node
// Each published package gets its own clean consumer. Workspace dependencies
// resolve to this checkout's tarballs, never an older package from the registry.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'awaitly-packages-'));
const packages = readdirSync(join(root, 'packages'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((directory) => {
  const cwd = join(root, 'packages', directory.name);
  return { cwd, manifest: JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) };
}).filter(({ manifest }) => !manifest.private);
const run = (command, args, cwd) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
});
const compiler = join(root, 'packages/awaitly/node_modules/typescript/bin/tsc');
const nodeTypes = JSON.parse(readFileSync(join(root, 'packages/awaitly/package.json'), 'utf8')).devDependencies['@types/node'];

try {
  const overrides = {};
  for (const { cwd, manifest } of packages) {
    const destination = join(work, manifest.name);
    mkdirSync(destination);
    console.log(`Packing ${manifest.name}…`);
    run('pnpm', ['pack', '--pack-destination', destination], cwd);
    const tarballs = readdirSync(destination).filter((file) => file.endsWith('.tgz'));
    assert.equal(tarballs.length, 1);
    overrides[manifest.name] = `file:${join(destination, tarballs[0])}`;
  }

  for (const { manifest } of packages) {
    console.log(`Checking ${manifest.name} on ${process.version}…`);
    const consumer = join(work, `consumer-${manifest.name}`);
    mkdirSync(consumer);
    // Overrides do not reach an auto-installed peer, so a workspace peer is
    // installed the way a real consumer installs it: as a direct dependency,
    // resolved to this checkout's tarball rather than the published version.
    const workspacePeers = Object.keys(manifest.peerDependencies ?? {}).filter((name) => overrides[name]);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({
      name: `smoke-${manifest.name}`, private: true, type: 'module',
      dependencies: Object.fromEntries([manifest.name, ...workspacePeers].map((name) => [name, overrides[name]])),
      // Node consumers normally install Node's ambient types. Do not install
      // workspace devDependencies: that would hide missing published typings.
      devDependencies: { '@types/node': nodeTypes },
    }));
    // pnpm reads overrides from the workspace file, so the consumer is its own
    // isolated workspace root. Without them a transitive workspace dependency
    // resolves from the registry.
    writeFileSync(join(consumer, 'pnpm-workspace.yaml'), stringify({ packages: [], overrides }));
    run('pnpm', ['install', '--config.strict-peer-dependencies=true'], consumer);
    // Every workspace package must resolve to this checkout's tarball. A registry
    // resolution anywhere in the tree would test an already published version.
    const lock = readFileSync(join(consumer, 'pnpm-lock.yaml'), 'utf8');
    const published = packages.map(({ manifest: packed }) => packed.name)
      .filter((name) => new RegExp(`^ {2}'?${name}@(?!file:)`, 'm').test(lock));
    assert.deepEqual(published, [], `Resolved from the registry instead of this checkout: ${published}`);
    const entries = Object.keys(manifest.exports).map((entry) =>
      entry === '.' ? manifest.name : `${manifest.name}${entry.slice(1)}`
    );
    writeFileSync(join(consumer, 'entries.mts'), entries.map((entry, index) =>
      `export * as entry${index} from ${JSON.stringify(entry)};`
    ).join('\n'));
    writeFileSync(join(consumer, 'entries.cts'), entries.map((entry, index) =>
      `import entry${index} = require(${JSON.stringify(entry)});\nexport { entry${index} };`
    ).join('\n'));
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
        strict: true, skipLibCheck: false, noEmit: true,
      }, include: ['*.mts', '*.cts'],
    }));
    run(process.execPath, [compiler, '-p', 'tsconfig.json'], consumer);
    const check = `if (Object.keys(entry).length === 0) throw new Error('Empty public entry: ' + name);`;
    writeFileSync(join(consumer, 'runtime.mjs'),
      `try { for (const name of ${JSON.stringify(entries)}) { const entry = await import(name); ${check} } } catch (error) { console.error(error.stack); process.exitCode = 1; }`);
    writeFileSync(join(consumer, 'runtime.cjs'),
      `for (const name of ${JSON.stringify(entries)}) { const entry = require(name); ${check} }`);
    run(process.execPath, ['runtime.mjs'], consumer);
    run(process.execPath, ['runtime.cjs'], consumer);
    for (const bin of Object.values(manifest.bin ?? {})) {
      const output = run(process.execPath, [join(consumer, 'node_modules', manifest.name, bin), '--help'], consumer);
      assert.match(output, /usage|options/i, 'Published CLI must start and provide help');
    }
    console.log(`${manifest.name}: ESM types, CommonJS types, runtime exports, and CLI passed`);
  }
  console.log(`All ${packages.length} published packages passed on ${process.version}`);
} catch (error) {
  console.error([error.stdout, error.stderr].filter(Boolean).join('\n') || error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
