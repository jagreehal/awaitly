---
title: Human-in-the-Loop
description: Pause workflows for manual approval
---

Pause workflows for human approval (large transfers, deployments, refunds) and resume when approved.

## Create an approval step

import { AnimatedWorkflowDiagram } from '~/components';

<AnimatedWorkflowDiagram
  steps={[
    {
      id: 'calculate',
      label: 'calculate refund',
      description: 'Compute the value, return err(...) on failure.',
      duration: '2s',
    },
    {
      id: 'approve',
      label: 'await approval',
      description: 'Pause until an approver resolves the request.',
      duration: '3s',
    },
    {
      id: 'process',
      label: 'process refund',
      description: 'Resume with the approved value and continue.',
      duration: '2s',
    },
  ]}
  autoPlay={true}
  loop={true}
/>

```typescript
import { createApprovalStep, isPendingApproval } from 'awaitly/hitl';

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
const refundWorkflow = createWorkflow('workflow', { calculateRefund, processRefund, requireApproval });

const result = await refundWorkflow(async (step) => {
  const refund = await step('calculateRefund', () => calculateRefund(orderId));

  // Workflow pauses here until approved
  const approval = await step('requireApproval', requireApproval, { key: 'approve:refund' });

  return await step('processRefund', () => processRefund(refund, approval));
});
```

## Check for pending approval

```typescript
if (!result.ok && isPendingApproval(result.error)) {
  // Save snapshot, notify team
  await notifySlack(`Refund ${orderId} needs approval`);
  await store.save(orderId, workflow.getSnapshot());
}
```

## Resume after approval

When approval is granted, record it in your approval store (e.g. database). Then load the snapshot and run the workflow again; the approval step's `checkApproval` will return the approved value:

```typescript
// Record approval (e.g. in your DB)
await db.approvals.upsert({
  where: { id: orderId },
  data: { approved: true, approvedBy: 'alice@company.com', timestamp: new Date() },
});

// Load snapshot and resume
const snapshot = await store.load(orderId);
const workflow = createWorkflow('workflow', { calculateRefund, processRefund, requireApproval },
  { snapshot }
);

const result = await workflow(async (step) => {
  const refund = await step('calculateRefund', () => calculateRefund(orderId));
  const approval = await step('requireApproval', requireApproval, { key: 'approve:refund' });
  return await step('processRefund', () => processRefund(refund, approval));
});
// checkApproval reads from DB and returns { status: 'approved', value }
```

## Handle rejection

```typescript
import { isApprovalRejected } from 'awaitly/hitl';

if (!result.ok && isApprovalRejected(result.error)) {
  console.log('Rejected:', result.error.reason);
  await db.refunds.updateStatus(orderId, 'rejected');
}
```

## List pending approvals

```typescript
import { getPendingApprovals } from 'awaitly/hitl';

// From in-memory collector (during same run)
const state = collector.getResumeState();
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
} from 'awaitly/hitl';

const orchestrator = createHITLOrchestrator({
  approvalStore: createMemoryApprovalStore(),
  workflowStateStore: createMemoryWorkflowStateStore(),
  createWorkflow: (resumeState) =>
    createWorkflow('workflow', deps, { resumeState }),
});

// Start workflow
const { runId, result } = await orchestrator.start(
  async (step) => {
    const data = await step('fetchData', () => fetchData());
    await step('requireApproval', requireApproval, { key: 'approve:data' });
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
import { createWorkflow } from 'awaitly/workflow';
import {
  createApprovalStep,
  isPendingApproval,
} from 'awaitly/hitl';

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
const expenseWorkflow = createWorkflow('workflow', { validateExpense,
  processPayment,
  requireManagerApproval,
});

const workflow = createWorkflow('workflow', deps);

const result = await workflow(async (step) => {
  const expense = await step('validateExpense', () => validateExpense(data));
  const approval = await step('requireManagerApproval', requireManagerApproval, { key: 'manager-approval' });
  return await step('processPayment', () => processPayment(expense, approval));
});

if (!result.ok && isPendingApproval(result.error)) {
  // Save snapshot for later
  await store.save('expense-123', workflow.getSnapshot());
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
import { gatedStep, isPendingApproval } from 'awaitly/hitl';

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
    'gatedSendEmail',
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

## Multi-stage approvals

For workflows requiring multiple approvers (e.g., manager → finance → CEO):

```typescript
import { createApprovalStep, isPendingApproval } from 'awaitly/hitl';

// Define approval stages
const managerApproval = createApprovalStep({
  key: 'approval:manager',
  checkApproval: async () => {
    const status = await db.getApprovalStatus('expense-123', 'manager');
    if (!status) return { status: 'pending' };
    return status.approved
      ? { status: 'approved', value: status }
      : { status: 'rejected', reason: status.reason };
  },
});

const financeApproval = createApprovalStep({
  key: 'approval:finance',
  checkApproval: async () => {
    const status = await db.getApprovalStatus('expense-123', 'finance');
    if (!status) return { status: 'pending' };
    return status.approved
      ? { status: 'approved', value: status }
      : { status: 'rejected', reason: status.reason };
  },
});

const ceoApproval = createApprovalStep({
  key: 'approval:ceo',
  checkApproval: async () => {
    const status = await db.getApprovalStatus('expense-123', 'ceo');
    if (!status) return { status: 'pending' };
    return status.approved
      ? { status: 'approved', value: status }
      : { status: 'rejected', reason: status.reason };
  },
});

// Workflow with conditional approval chain
const expenseWorkflow = createWorkflow('workflow', { validateExpense,
  processExpense,
  managerApproval,
  financeApproval,
  ceoApproval,
});

const result = await expenseWorkflow(async (step) => {
  const expense = await step('validateExpense', () => validateExpense(data));

  // Always needs manager approval
  await step('approval:manager', managerApproval, { key: 'approval:manager' });

  // Finance approval for amounts over $1000
  if (expense.amount > 1000) {
    await step('approval:finance', financeApproval, { key: 'approval:finance' });
  }

  // CEO approval for amounts over $10000
  if (expense.amount > 10000) {
    await step('approval:ceo', ceoApproval, { key: 'approval:ceo' });
  }

  return await step('processExpense', () => processExpense(expense));
});
```

### Track approval progress

```typescript
import { getPendingApprovals } from 'awaitly/hitl';

const state = collector.getResumeState();
const pending = getPendingApprovals(state);

// Show approval chain status
const stages = ['manager', 'finance', 'ceo'];
const completed = stages.filter(s => !pending.some(p => p.stepKey.includes(s)));
const current = pending[0]?.stepKey;

console.log(`Completed: ${completed.join(' → ')}`);
console.log(`Waiting for: ${current}`);
// "Completed: manager"
// "Waiting for: approval:finance"
```

## Approval timeouts

Handle approvals that take too long:

```typescript
import { createApprovalStep, isPendingApproval } from 'awaitly/hitl';

// Approval with built-in timeout check
const timedApproval = createApprovalStep({
  key: 'approval:urgent',
  checkApproval: async () => {
    const request = await db.getApprovalRequest('request-123');

    // Check if approval has timed out
    const timeoutMs = 24 * 60 * 60 * 1000; // 24 hours
    if (Date.now() - request.createdAt > timeoutMs) {
      return {
        status: 'rejected',
        reason: 'Approval timed out after 24 hours',
      };
    }

    if (!request.status) return { status: 'pending' };
    return request.approved
      ? { status: 'approved', value: request }
      : { status: 'rejected', reason: request.reason };
  },
});

// Or use a scheduled job to auto-reject timed out approvals
async function checkApprovalTimeouts() {
  const expired = await db.approvalRequests.findMany({
    where: {
      status: 'pending',
      createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });

  for (const request of expired) {
    await db.approvalRequests.update({
      where: { id: request.id },
      data: { status: 'rejected', reason: 'Auto-rejected: timeout exceeded' },
    });

    // Notify workflow to retry
    await resumeWorkflow(request.workflowId);
  }
}
```

### Escalation on timeout

```typescript
const approvalWithEscalation = createApprovalStep({
  key: 'approval:manager',
  checkApproval: async () => {
    const request = await db.getApprovalRequest('request-123');

    // After 4 hours, escalate to senior manager
    const escalationThreshold = 4 * 60 * 60 * 1000;
    if (!request.status && Date.now() - request.createdAt > escalationThreshold) {
      // Escalate (update assignment)
      if (!request.escalated) {
        await db.approvalRequests.update({
          where: { id: request.id },
          data: {
            assignedTo: 'senior-manager@company.com',
            escalated: true,
          },
        });
        await sendSlack('Approval escalated to senior manager');
      }
    }

    if (!request.status) return { status: 'pending' };
    return request.approved
      ? { status: 'approved', value: request }
      : { status: 'rejected', reason: request.reason };
  },
});
```

## Recovery patterns

### Handle orchestrator failures

When the orchestrator process crashes:

```typescript
import {
  createHITLOrchestrator,
  createMemoryApprovalStore,
  createMemoryWorkflowStateStore,
} from 'awaitly/hitl';

// Use persistent stores instead of memory
const approvalStore = createRedisApprovalStore(redis);
const workflowStateStore = createPostgresWorkflowStateStore(db);

const orchestrator = createHITLOrchestrator({
  approvalStore,
  workflowStateStore,
  createWorkflow: (resumeState) => createWorkflow('workflow', deps, { resumeState }),
});

// On startup, recover incomplete workflows
async function recoverWorkflows() {
  // Find workflows that were interrupted
  const incomplete = await workflowStateStore.findIncomplete();

  for (const workflow of incomplete) {
    console.log(`Recovering workflow: ${workflow.id}`);

    try {
      // Check if any pending approvals have been resolved
      const pendingApprovals = await approvalStore.getPending(workflow.id);
      const anyResolved = pendingApprovals.some(a => a.status !== 'pending');

      if (anyResolved) {
        // Resume the workflow
        const result = await orchestrator.resume(workflow.id);
        console.log(`Workflow ${workflow.id} resumed:`, result.ok ? 'success' : 'failed');
      }
    } catch (error) {
      console.error(`Failed to recover ${workflow.id}:`, error);
      // Mark for manual intervention
      await workflowStateStore.markForReview(workflow.id, error);
    }
  }
}

// Run on startup
await recoverWorkflows();
```

### Idempotent approval handling

Ensure approvals can be safely retried:

```typescript
const idempotentApprovalStore = {
  async grantApproval(key: string, value: unknown) {
    // Use upsert to handle duplicate approval attempts
    await db.approvals.upsert({
      where: { key },
      create: {
        key,
        status: 'approved',
        value: JSON.stringify(value),
        approvedAt: new Date(),
      },
      update: {
        // Don't overwrite if already approved
        // This makes the operation idempotent
      },
    });
  },

  async getApproval(key: string) {
    const record = await db.approvals.findUnique({ where: { key } });
    if (!record) return { status: 'pending' };
    return {
      status: record.status,
      value: JSON.parse(record.value),
    };
  },
};
```

### Handle partial failures

When a workflow fails after some approvals:

```typescript
const result = await expenseWorkflow(async (step) => {
  const expense = await step('validateExpense', () => validateExpense(data), { key: 'validate' });

  // First approval passed
  await step('approval:manager', managerApproval, { key: 'approval:manager' });

  // Second approval passed
  await step('approval:finance', financeApproval, { key: 'approval:finance' });

  // This step fails after approvals
  return await step('processExpense', () => processExpense(expense), { key: 'process' });
});

if (!result.ok && !isPendingApproval(result.error)) {
  // Processing failed but approvals are saved
  // On retry, approvals will be skipped (cached)
  const savedState = collector.getResumeState();

  // Option 1: Auto-retry with backoff
  await retryWithBackoff(() => resumeWorkflow(savedState));

  // Option 2: Alert for manual intervention
  await alertOps({
    message: 'Expense workflow failed after approval',
    error: result.error,
    workflowId: expense.id,
    resumeState: savedState,
  });
}
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

[Learn about Visualization →](/guides/visualization/)
