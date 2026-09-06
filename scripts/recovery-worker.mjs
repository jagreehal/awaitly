import { ok } from '../packages/awaitly/dist/index.js';
import { durable } from '../packages/awaitly/dist/durable.js';
import { createStore } from './recovery-store.mjs';

const store = createStore(JSON.parse(process.argv[2]));
let resume;
const send = (message) => process.send?.(message);

async function workflow(id, hold) {
  return durable.run({}, async ({ step }) => {
    await step('prepare', async () => {
      send({ type: 'effect', id, step: 'prepare' });
      return ok(id);
    });
    if (hold) {
      await new Promise((resolve) => {
        resume = resolve;
        send({ type: 'blocked', id });
      });
    }
    return step('commit', async () => {
      send({ type: 'effect', id, step: 'commit' });
      return ok(id);
    });
  }, {
    id, store, lockTtlMs: 1000, heartbeatIntervalMs: 200,
    onEvent: (event) => {
      if (event.type === 'persist_success' || event.type === 'persist_error') {
        send({ type: event.type, id, step: event.stepKey });
      }
    },
  });
}

process.on('message', async (message) => {
  if (message.type === 'resume') {
    resume?.();
    return;
  }
  try {
    if (message.type === 'run') {
      const result = await workflow(message.id, message.hold);
      send({ type: 'result', id: message.id, result });
    } else if (message.type === 'batch') {
      for (const id of message.ids) {
        const result = await workflow(id, false);
        send({ type: 'result', id, result });
      }
      send({ type: 'batch_done' });
    }
  } catch (error) {
    send({ type: 'error', message: error.stack ?? String(error) });
  }
});

await store.list({ limit: 1 });
send({ type: 'ready' });
