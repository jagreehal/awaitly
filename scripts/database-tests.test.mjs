import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = [
  {
    name: 'awaitly-postgres',
    variable: 'TEST_POSTGRES_CONNECTION_STRING',
    url: 'postgresql://postgres:postgres@127.0.0.1:1/test_awaitly?connect_timeout=1',
    files: ['src/store-contract.test.ts', 'src/integration.test.ts'],
  },
  {
    name: 'awaitly-mongo',
    variable: 'TEST_MONGODB_URI',
    url: 'mongodb://127.0.0.1:1/test_awaitly?serverSelectionTimeoutMS=200&connectTimeoutMS=200',
    files: ['src/store-contract.test.ts', 'src/integration.test.ts', 'src/mongo-lock.test.ts'],
  },
];

function runSuites(suite, env) {
  const work = mkdtempSync(join(tmpdir(), 'awaitly-db-tests-'));
  try {
    const report = join(work, 'results.json');
    const result = spawnSync(process.execPath, [
      'node_modules/vitest/vitest.mjs', 'run', ...suite.files,
      '--reporter=default', '--reporter=json', `--outputFile=${report}`,
      '--testTimeout=3000', '--hookTimeout=3000',
    ], {
      cwd: join(root, 'packages', suite.name),
      env: { ...process.env, CI: '', TEST_POSTGRES_CONNECTION_STRING: '', TEST_MONGODB_URI: '', ...env },
      encoding: 'utf8', timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    return { status: result.status, report: JSON.parse(readFileSync(report, 'utf8')), output: result.stdout + result.stderr };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

for (const suite of suites) {
  for (const ci of ['', 'true']) {
    test(`${suite.name}: unavailable explicitly configured database fails every suite (CI=${Boolean(ci)})`, () => {
      const { status, report, output } = runSuites(suite, { CI: ci, [suite.variable]: suite.url });
      assert.notEqual(status, 0, 'An unreachable required database must fail the test command');
      assert.match(output, /ECONNREFUSED/, 'Must fail on the connection');
      assert.doesNotMatch(output, /timed out|Transform failed|SyntaxError/, 'Must not fail on syntax or a test timeout');
      for (const file of suite.files) {
        const results = report.testResults.filter((result) => result.name.endsWith(file));
        assert.equal(results.length, 1, `Missing suite: ${file}`);
        assert.equal(results[0].status, 'failed', `${file} silently skipped or passed`);
      }
    });
  }
  test(`${suite.name}: unconfigured local database is explicitly skipped`, () => {
    const { status, report } = runSuites(suite, {});
    assert.equal(status, 0);
    assert.equal(report.numPassedTests, 0);
    assert.ok(report.numPendingTests > 0);
    assert.equal(report.numPendingTests, report.numTotalTests);
  });
}
