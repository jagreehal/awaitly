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
import { createApprovalWebhookHandler } from 'awaitly';

const handler = createApprovalWebhookHandler({
  approvalStore,
  workflowStateStore,
  resumeWorkflow: async (runId, state) => {
    const workflow = createWorkflow(deps, { resumeState: state });
    return workflow(executor);
  },
});

// Express
app.post('/webhooks/approve', async (req, res) => {
  const result = await handler({
    runId: req.body.runId,
    stepKey: req.body.stepKey,
    action: req.body.action, // 'approve' | 'reject'
    value: req.body.value,
    reason: req.body.reason,
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

## Next

[Learn about Visualization →](/workflow/guides/visualization/)
