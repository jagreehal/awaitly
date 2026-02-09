---
title: Callback Hooks
description: Suspend workflows until an HTTP callback, then resume with injectHook
---

Suspend a workflow at a step until your app receives an HTTP callback (e.g. payment webhook, OAuth redirect). When the request arrives, call `injectHook(state, { hookId, value })` and re-run the workflow with the updated resume state to continue with the callback payload. Server-agnostic: you own the URL and the handler.

## When to use hooks

- **Payment provider webhooks** – Start checkout, suspend until the provider calls your `POST /webhooks/payment/:hookId`, then resume with the payment result.
- **OAuth or external redirects** – Send the user to an external site, suspend until they hit your callback URL with the token/code, then resume.
- **Async approvals from external systems** – Wait for a webhook from a third party instead of polling.

Unlike [Human-in-the-Loop](/guides/human-in-loop/), hooks are driven by an **incoming HTTP callback** (or any event you map to `injectHook`), not by a human approval flow.

## Create a hook and suspend the workflow

Generate a unique `hookId` and use it in both the workflow step and your callback URL:

```typescript
import { createWorkflow, createResumeStateCollector } from 'awaitly/workflow';
import { createHook, pendingHook } from 'awaitly/workflow';

// One hook per “wait for callback” point; create once or per run
const { hookId, stepKey } = createHook();

const workflow = createWorkflow(
  'payment-flow',
  {
    waitForPayment: async () => pendingHook(hookId),
  }
);

const result = await workflow(async (step, { waitForPayment }) => {
  const order = await step('createOrder', () => createOrder(data), { key: 'create-order' });
  // Workflow suspends here until you call injectHook with this hookId
  const payment = await step('wait', () => waitForPayment(), { key: stepKey });
  return await step('fulfill', () => fulfillOrder(order, payment), { key: 'fulfill' });
});
```

Use `stepKey` (which equals `"hook:" + hookId`) as the step `key` so resume state matches. Expose a route that includes `hookId`, e.g. `POST /hook/:hookId` or `POST /webhooks/payment/:hookId`.

## Check for pending hook

When the workflow returns, check if it stopped because it’s waiting for a callback:

```typescript
import { isPendingHook } from 'awaitly/workflow';

if (!result.ok && isPendingHook(result.error)) {
  // result.error.hookId is the hook to resolve
  console.log('Waiting for callback:', result.error.hookId);
  // Persist resume state and associate it with hookId so the callback handler can load it
  const state = collector.getResumeState();
  await store.saveResumeState(result.error.hookId, state);
}
```

## Expose the callback URL and resume

When the HTTP callback hits your server, load the resume state, call `injectHook`, then run the workflow again with the updated state:

```typescript
import { createWorkflow, injectHook } from 'awaitly/workflow';
import { pendingHook } from 'awaitly/workflow';

// In your HTTP handler (e.g. POST /hook/:hookId or POST /webhooks/payment/:hookId)
app.post('/hook/:hookId', async (req, res) => {
  const { hookId } = req.params;
  const state = await store.loadResumeState(hookId);
  if (!state) {
    return res.status(404).json({ error: 'Unknown or expired hook' });
  }

  const stateWithPayload = injectHook(state, { hookId, value: req.body });

  const workflow = createWorkflow(
    'payment-flow',
    { waitForPayment: async () => pendingHook(hookId) },
    { resumeState: stateWithPayload }
  );

  const result = await workflow(async (step, { waitForPayment }) => {
    const order = await step('createOrder', () => createOrder(data), { key: 'create-order' });
    const payment = await step('wait', () => waitForPayment(), { key: 'hook:' + hookId });
    return await step('fulfill', () => fulfillOrder(order, payment), { key: 'fulfill' });
  });

  if (result.ok) {
    await store.deleteResumeState(hookId);
    res.json(result.value);
  } else {
    res.status(500).json({ error: result.error });
  }
});
```

`injectHook(state, { hookId, value })` returns a **new** resume state with the step `"hook:" + hookId` set to `ok(value)`. Re-run the same workflow with `resumeState: stateWithPayload` so that step is skipped and the workflow continues with the injected value.

## List pending hooks

To see which hooks in a resume state are still waiting:

```typescript
import { getPendingHooks, hasPendingHook } from 'awaitly/workflow';

const state = collector.getResumeState();
const pendingIds = getPendingHooks(state);
// ['hook-id-1', 'hook-id-2']

if (hasPendingHook(state, 'hook-id-1')) {
  // This hook is still pending in this state
}
```

## Optional metadata

You can attach metadata when creating the pending hook (e.g. for logging or debugging):

```typescript
pendingHook(hookId, { metadata: { orderId: 'ord_123', source: 'checkout' } });
```

## API summary

| Export | Purpose |
|--------|--------|
| `createHook()` | Returns `{ hookId, stepKey }`; use `stepKey` as the step `key`. |
| `pendingHook(hookId, options?)` | Returns `Err<PendingHook>` to suspend the workflow until `injectHook` is called. |
| `injectHook(state, { hookId, value })` | Returns new resume state with that hook step set to `ok(value)`. |
| `isPendingHook(error)` | Type guard: is this error a `PendingHook`? |
| `hasPendingHook(state, hookId)` | Does this state have a pending hook for `hookId`? |
| `getPendingHooks(state)` | Array of `hookId`s that are pending in this state. |

Step keys for hooks use the prefix `"hook:"`; the full key is `"hook:" + hookId` (available as `stepKey` from `createHook()`).

## Next

[Human-in-the-Loop](/guides/human-in-loop/) – Pause for human approval and resume when approved.  
[Durable Execution](/guides/durable-execution/) – Checkpoint and resume across restarts.
