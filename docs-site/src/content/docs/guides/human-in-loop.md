---
title: Human-in-the-Loop
description: Pause workflows for manual approval
---

Pause workflows for human approval (large transfers, deployments, refunds) and resume when approved.

## Create an approval step

```typescript
import { createApprovalStep, isPendingApproval } from 'awaitly';

const requireApproval = createApprovalStep({
  key: 'approve:refund',
  checkApproval: async () => {
    const status = await db.getApprovalStatus('refund-123');
    if (!status) return { status: 'pending' };
    if (status.approved) return { status: 'approved', value: status };
    return { status: 'rejected', reason: status.reason };
  },
});
```

## Use in workflow

```typescript
const refundWorkflow = createWorkflow({ calculateRefund, processRefund, requireApproval });

const result = await refundWorkflow(async (step) => {
  const refund = await step(calculateRefund(orderId));

  // Workflow pauses here until approved
  const approval = await step(requireApproval, { key: 'approve:refund' });

  return await step(processRefund(refund, approval));
});
```

## Check for pending approval

```typescript
if (!result.ok && isPendingApproval(result.error)) {
  // Save state, notify team
  await notifySlack(`Refund ${orderId} needs approval`);
  await db.workflowStates.create({
    id: orderId,
    state: stringifyState(collector.getState()),
  });
}
```

## Inject approval and resume

When approval is granted:

```typescript
import { injectApproval, parseState } from 'awaitly';

// Load saved state
const saved = await db.workflowStates.findUnique({ where: { id: orderId } });
const state = parseState(saved.state);

// Inject the approval
const updatedState = injectApproval(state, {
  stepKey: 'approve:refund',
  value: { approvedBy: 'alice@company.com', timestamp: Date.now() },
});

// Resume workflow
const workflow = createWorkflow(
  { calculateRefund, processRefund, requireApproval },
  { resumeState: updatedState }
);

const result = await workflow(async (step) => {
  const refund = await step(calculateRefund(orderId));
  const approval = await step(requireApproval, { key: 'approve:refund' });
  return await step(processRefund(refund, approval));
});
// Now completes successfully
```

## Handle rejection

```typescript
import { isApprovalRejected } from 'awaitly';

if (!result.ok && isApprovalRejected(result.error)) {
  console.log('Rejected:', result.error.reason);
  await db.refunds.updateStatus(orderId, 'rejected');
}
```

## List pending approvals

```typescript
import { getPendingApprovals } from 'awaitly';

const state = collector.getState();
const pending = getPendingApprovals(state);
// [{ stepKey: 'approve:refund', ... }]
```

## HITL orchestrator

For complex approval flows, use the orchestrator:

```typescript
import {
  createHITLOrchestrator,
  createMemoryApprovalStore,
  createMemoryWorkflowStateStore,
} from 'awaitly';

const orchestrator = createHITLOrchestrator({
  approvalStore: createMemoryApprovalStore(),
  workflowStateStore: createMemoryWorkflowStateStore(),
  createWorkflow: (resumeState) =>
    createWorkflow(deps, { resumeState }),
});

// Start workflow
const { runId, result } = await orchestrator.start(
  async (step) => {
    const data = await step(fetchData());
    await step(requireApproval, { key: 'approve:data' });
    return data;
  },
  { workflowId: 'wf-1' }
);

// Approve
await orchestrator.approve(runId, 'approve:data', { approvedBy: 'alice' });

// Resume
const finalResult = await orchestrator.resume(runId);
```

## Approval webhook handler

Expose an HTTP endpoint for approvals:

```typescript
import { createApprovalWebhookHandler, createMemoryApprovalStore } from 'awaitly/hitl';

const approvalStore = createMemoryApprovalStore();
const handler = createApprovalWebhookHandler(approvalStore);

// Express
app.post('/webhooks/approve', async (req, res) => {
  const result = await handler({
    key: req.body.key,
    action: req.body.action, // 'approve' | 'reject' | 'edit' | 'cancel'
    value: req.body.value,
    reason: req.body.reason,
    actorId: req.body.actorId,
    // For 'edit' action:
    originalValue: req.body.originalValue,
    editedValue: req.body.editedValue,
  });

  res.json(result);
});
```

## Full example

```typescript
import {
  createWorkflow,
  createApprovalStep,
  createStepCollector,
  isPendingApproval,
  injectApproval,
  stringifyState,
  parseState,
} from 'awaitly';

// Define approval step
const requireManagerApproval = createApprovalStep({
  key: 'manager-approval',
  checkApproval: async () => {
    const record = await db.approvals.find('expense-123');
    if (!record) return { status: 'pending' };
    return record.approved
      ? { status: 'approved', value: record }
      : { status: 'rejected', reason: record.reason };
  },
});

// Workflow
const expenseWorkflow = createWorkflow({
  validateExpense,
  processPayment,
  requireManagerApproval,
});

const collector = createStepCollector();
const workflow = createWorkflow(deps, { onEvent: collector.handleEvent });

const result = await workflow(async (step) => {
  const expense = await step(validateExpense(data));
  const approval = await step(requireManagerApproval, { key: 'manager-approval' });
  return await step(processPayment(expense, approval));
});

if (!result.ok && isPendingApproval(result.error)) {
  // Save for later
  await db.pendingWorkflows.create({
    id: 'expense-123',
    state: stringifyState(collector.getState()),
  });
  await sendSlackMessage('Expense needs approval: expense-123');
}
```

## Notification channel (Slack, email, etc.)

Push notifications when approvals are needed:

```typescript
import { createHITLOrchestrator, NotificationChannel } from 'awaitly/hitl';

const slackChannel: NotificationChannel = {
  async onApprovalNeeded(ctx) {
    await slack.chat.postMessage({
      channel: '#approvals',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${ctx.summary}*` } },
        { type: 'context', text: { type: 'mrkdwn', text: `Workflow: ${ctx.workflowName} | Key: ${ctx.approvalKey}` } },
        { type: 'actions', elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Approve' }, action_id: `approve:${ctx.approvalKey}` },
          { type: 'button', text: { type: 'plain_text', text: 'Reject' }, action_id: `reject:${ctx.approvalKey}` }
        ]}
      ]
    });
  },
  async onApprovalResolved(ctx) {
    // Update the Slack message when approved/rejected
    await slack.chat.update({ ... });
  }
};

const orchestrator = createHITLOrchestrator({
  approvalStore: createMemoryApprovalStore(),
  workflowStateStore: createMemoryWorkflowStateStore(),
  notificationChannel: slackChannel, // Push notifications
});
```

## Edit approval (modify before approving)

Allow humans to approve with modifications:

```typescript
// Instead of simple approve:
await orchestrator.grantApproval('budget', { amount: 5000 });

// Edit the value:
await orchestrator.editApproval(
  'budget',
  { amount: 5000 },      // Original proposed value
  { amount: 4500 },      // Edited value (human reduced it)
  { editedBy: 'manager@co.com' }
);

// The workflow continues with the edited value
```

Check for edited approvals:

```typescript
const status = await approvalStore.getApproval('budget');
if (status.status === 'edited') {
  console.log('Original:', status.originalValue);
  console.log('Edited to:', status.editedValue);
  console.log('By:', status.editedBy);
}
```

## Pre-execution gating (AI SDK pattern)

Gate operations *before* they execute, showing args for approval:

```typescript
import { gatedStep, isPendingApproval } from 'awaitly';

// Gate external email sends
const gatedSendEmail = gatedStep(
  (args: { to: string; subject: string; body: string }) => sendEmail(args),
  {
    key: 'email-approval',
    requiresApproval: (args) => !args.to.endsWith('@mycompany.com'),
    description: (args) => `Send email to ${args.to}: "${args.subject}"`,
  }
);

// In workflow:
const result = await workflow(async (step) => {
  // This shows the email args before sending
  await step(
    () => gatedSendEmail({ to: 'external@other.com', subject: 'Hello', body: '...' }),
    { key: 'send-email' }
  );
});

if (!result.ok && isPendingApproval(result.error)) {
  // Human sees: "Send email to external@other.com: "Hello""
  // Plus the full args in metadata.pendingArgs
  console.log(result.error.metadata?.pendingArgs);
  // { to: 'external@other.com', subject: 'Hello', body: '...' }
}
```

### Conditional gating

Only gate certain operations:

```typescript
const gatedDelete = gatedStep(
  (args: { path: string }) => deleteFile(args.path),
  {
    key: 'delete-file',
    requiresApproval: (args) => args.path.startsWith('/important/'),
    description: (args) => `Delete file: ${args.path}`,
  }
);

// Deleting /tmp/foo.txt: No approval needed, executes immediately
// Deleting /important/data.json: Pauses for approval
```

## React integration

```typescript
function useApprovalStatus(approvalKey: string) {
  const [status, setStatus] = useState<ApprovalStatus>({ status: 'pending' });

  useEffect(() => {
    const ws = new WebSocket(`/api/approvals/${approvalKey}/stream`);
    ws.onmessage = (e) => setStatus(JSON.parse(e.data));
    return () => ws.close();
  }, [approvalKey]);

  return status;
}

function ApprovalCard({ approvalKey, pendingArgs }) {
  const status = useApprovalStatus(approvalKey);

  if (status.status === 'pending') {
    return (
      <div>
        <h3>Approval Needed</h3>
        <pre>{JSON.stringify(pendingArgs, null, 2)}</pre>
        <button onClick={() => approve(approvalKey, pendingArgs)}>Approve</button>
        <button onClick={() => reject(approvalKey, 'User rejected')}>Reject</button>
      </div>
    );
  }

  return <div>Status: {status.status}</div>;
}
```

## Next

[Learn about Visualization →](/workflow/guides/visualization/)
