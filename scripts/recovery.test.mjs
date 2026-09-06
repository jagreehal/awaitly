import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { createStore } from './recovery-store.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'awaitly-recovery-'));
const profile = { workers: 4, workflows: 100, minimumWorkflowsPerSecond: 5, recoveryDeadlineMs: 15_000, leaseTtlMs: 1000 };
const measurements = [];
const adapters = [
  { adapter: 'postgres', url: 'postgresql://postgres:postgres@127.0.0.1:55432/test_awaitly?connect_timeout=1', service: 'postgres' },
  { adapter: 'mongo', url: 'mongodb://127.0.0.1:57017/test_awaitly', service: 'mongo-recovery' },
  { adapter: 'libsql', url: `file:${join(work, 'recovery.db')}` },
];
const compose = (...args) => execFileSync('docker', ['compose', ...args], { cwd: root, stdio: 'pipe', timeout: 60_000 });

after(() => {
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports/recovery.json'), JSON.stringify({
    date: new Date().toISOString(), node: process.version, profile, measurements,
  }, null, 2));
  rmSync(work, { recursive: true, force: true });
});

async function worker(t, config) {
  const child = fork(join(root, 'scripts/recovery-worker.mjs'), [JSON.stringify(config)], { silent: true });
  const messages = [];
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data; });
  child.on('message', (message) => messages.push(message));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });
  const wait = async (predicate, deadline = profile.recoveryDeadlineMs) => {
    const started = performance.now();
    while (performance.now() - started < deadline) {
      const error = messages.find((message) => message.type === 'error');
      assert.ok(!error, error?.message);
      const found = messages.find(predicate);
      if (found) return found;
      assert.equal(child.exitCode, null, stderr);
      assert.equal(child.signalCode, null, stderr);
      await delay(10);
    }
    assert.fail(`Worker deadline exceeded: ${JSON.stringify(messages)}\n${stderr}`);
  };
  await wait((message) => message.type === 'ready');
  return { child, messages, wait, send: (message) => child.send(message) };
}

async function setup(t, adapter, warm = true) {
  const config = { ...adapter, namespace: `recovery_${randomUUID().replaceAll('-', '')}` };
  const store = createStore(config);
  if (warm) await store.list({ limit: 1 });
  t.after(() => store.close());
  return { config, store };
}

for (const adapter of adapters) {
  test(`${adapter.adapter}: process death, lease expiry, and checkpoint recovery`, { timeout: 30_000 }, async (t) => {
    const { config, store } = await setup(t, adapter);
    const first = await worker(t, config);
    const second = await worker(t, config);
    const id = 'crash-recovery';
    first.send({ type: 'run', id, hold: true });
    await first.wait((message) => message.type === 'blocked');
    await first.wait((message) => message.type === 'persist_success');
    assert.ok(await store.load(id), 'Checkpoint must be stored before killing the worker');

    // Heartbeats must keep ownership beyond the original lease deadline.
    await delay(profile.leaseTtlMs + 200);

    // A different OS process must be refused while the first owns the lease.
    second.send({ type: 'run', id });
    const refused = await second.wait((message) => message.type === 'result');
    assert.equal(refused.result.ok, false);
    assert.equal(refused.result.error.type, 'CONCURRENT_EXECUTION');
    assert.equal(second.messages.filter((message) => message.type === 'effect').length, 0);

    const exited = once(first.child, 'exit');
    const started = performance.now();
    first.child.kill('SIGKILL');
    await exited;
    let recovered;
    do {
      assert.ok(performance.now() - started < profile.recoveryDeadlineMs, 'A dead worker must not retain its lease indefinitely');
      second.messages.length = 0;
      second.send({ type: 'run', id });
      recovered = await second.wait((message) => message.type === 'result');
      if (recovered.result.error?.type === 'CONCURRENT_EXECUTION') await delay(50);
    } while (recovered.result.error?.type === 'CONCURRENT_EXECUTION');
    assert.deepEqual(recovered.result, { ok: true, value: id });
    assert.deepEqual(second.messages.filter((message) => message.type === 'effect').map((message) => message.step), ['commit'],
      'The checkpointed prepare effect must not replay');
    assert.equal(await store.load(id), null, 'Successful recovery clears the checkpoint');
    const recoveryMs = performance.now() - started;
    assert.ok(recoveryMs < profile.recoveryDeadlineMs);
    measurements.push({ adapter: adapter.adapter, scenario: 'process-death', recoveryMs });
  });

  test(`${adapter.adapter}: four processes complete the baseline workload without duplicate effects`, { timeout: 45_000 }, async (t) => {
    const { config, store } = await setup(t, adapter, false);
    const workers = await Promise.all(Array.from({ length: profile.workers }, () => worker(t, config)));
    const started = performance.now();
    for (const [index, current] of workers.entries()) {
      current.send({ type: 'batch', ids: Array.from({ length: profile.workflows / profile.workers }, (_, i) => `load-${index}-${i}`) });
    }
    await Promise.all(workers.map((current) => current.wait((message) => message.type === 'batch_done', 30_000)));
    const durationMs = performance.now() - started;
    const messages = workers.flatMap((current) => current.messages);
    const results = messages.filter((message) => message.type === 'result');
    assert.equal(results.length, profile.workflows);
    for (const { id, result } of results) assert.deepEqual(result, { ok: true, value: id });
    const effects = messages.filter((message) => message.type === 'effect');
    assert.equal(effects.length, profile.workflows * 2);
    assert.equal(new Set(effects.map(({ id, step }) => `${id}:${step}`)).size, effects.length);
    assert.equal(messages.filter((message) => message.type === 'persist_error').length, 0);
    assert.deepEqual(await store.list(), []);
    const workflowsPerSecond = profile.workflows / (durationMs / 1000);
    assert.ok(workflowsPerSecond >= profile.minimumWorkflowsPerSecond, `Only ${workflowsPerSecond} workflows/sec`);
    measurements.push({ adapter: adapter.adapter, scenario: 'load', durationMs, workflowsPerSecond });
  });

  if (adapter.service) {
    test(`${adapter.adapter}: database outage loses the lease and recovery resumes the checkpoint`, { timeout: 60_000 }, async (t) => {
      const config = { ...adapter, namespace: `outage_${randomUUID().replaceAll('-', '')}` };
      const current = await worker(t, config);
      const id = 'database-outage';
      current.send({ type: 'run', id, hold: true });
      await current.wait((message) => message.type === 'blocked');
      await current.wait((message) => message.type === 'persist_success');
      const outageStarted = performance.now();
      try {
        compose('stop', '-t', '1', adapter.service);
        // Longer than both the heartbeat and the configured connection timeout.
        await delay(1500);
        current.send({ type: 'resume' });
        const failed = await current.wait((message) => message.type === 'result');
        assert.equal(failed.result.ok, false);
        assert.equal(failed.result.error.type, 'LEASE_EXPIRED');
        assert.deepEqual(current.messages.filter((message) => message.type === 'effect').map((message) => message.step), ['prepare']);
      } finally {
        compose('up', '-d', '--wait', adapter.service);
      }
      const started = performance.now();
      current.messages.length = 0;
      current.send({ type: 'run', id });
      const recovered = await current.wait((message) => message.type === 'result');
      assert.deepEqual(recovered.result, { ok: true, value: id });
      assert.deepEqual(current.messages.filter((message) => message.type === 'effect').map((message) => message.step), ['commit']);
      const recoveryAfterDatabaseReadyMs = performance.now() - started;
      const recoveryMs = performance.now() - outageStarted;
      assert.ok(recoveryMs < profile.recoveryDeadlineMs, `Outage recovery took ${recoveryMs}ms`);
      measurements.push({ adapter: adapter.adapter, scenario: 'database-outage', recoveryMs, recoveryAfterDatabaseReadyMs });
    });
  }
}
