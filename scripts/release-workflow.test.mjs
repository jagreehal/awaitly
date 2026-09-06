import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const read = (path) => parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const release = read('.github/workflows/release.yml');
const ci = read('.github/workflows/ci.yml');

test('publishing depends on same-commit validation and cannot run after failure', () => {
  assert.equal(release.jobs.validate.uses, './.github/workflows/ci.yml');
  assert.ok(Object.hasOwn(ci.on, 'workflow_call'));
  assert.equal(release.jobs.release.needs, 'validate');
  assert.ok(!release.jobs.validate.if, 'Validation must not be conditionally skipped');
  assert.doesNotMatch(release.jobs.release.if ?? '', /always\(|failure\(|cancelled\(/);
  for (const job of [release.jobs.release, ...Object.values(ci.jobs)]) {
    assert.ok(!job['continue-on-error']);
    for (const step of job.steps ?? []) {
      assert.ok(!step['continue-on-error']);
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.ok(!step.with?.ref || step.with.ref === '${{ github.sha }}', 'Do not checkout a moving branch after validation');
      }
    }
  }
});

test('validation requires live adapters, both consumer runtimes, recovery, and mutation checks', () => {
  const runs = (job) => job.steps.map((step) => step.run ?? '').join('\n');
  const build = ci.jobs['build-and-test'];
  assert.ok(build.services.postgres);
  assert.ok(build.services.mongodb);
  const tests = build.steps.find((step) => step.run === 'pnpm test --force');
  assert.ok(tests, 'Database checks must bypass previously cached test results');
  assert.ok(tests.env.TEST_POSTGRES_CONNECTION_STRING);
  assert.ok(tests.env.TEST_MONGODB_URI);
  assert.match(runs(build), /pnpm test:release/);
  assert.deepEqual(ci.jobs.consumer.strategy.matrix.node, [22, 24]);
  assert.match(runs(ci.jobs.consumer), /pnpm smoke/);
  assert.match(runs(ci.jobs.recovery), /pnpm test:recovery/);
  assert.match(runs(ci.jobs.mutation), /pnpm --filter awaitly mutation/);
  for (const name of ['build-and-test', 'consumer', 'recovery', 'mutation']) {
    assert.ok(!ci.jobs[name].if, `${name} must run for every release`);
  }
});

test('fault-test services are isolated from the developer MongoDB endpoint', () => {
  const compose = read('docker-compose.yml');
  assert.equal(compose.name, 'awaitly-validation');
  assert.deepEqual(compose.services.postgres.ports, ['127.0.0.1:55432:5432']);
  assert.deepEqual(compose.services['mongo-recovery'].ports, ['127.0.0.1:57017:27017']);
  for (const service of Object.values(compose.services)) {
    assert.ok(service.healthcheck);
    assert.ok(!service.external);
  }
});
