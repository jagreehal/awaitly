# Human-in-the-Loop (HITL)

Pause workflows for human approval, persist state, and resume when decisions are made. Perfect for order approvals, expense reviews, content moderation, and any workflow requiring human judgment.

## Table of Contents

- [The Problem](#the-problem)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [HITL Orchestrator](#hitl-orchestrator)
- [Approval Stores](#approval-stores)
- [Workflow State Stores](#workflow-state-stores)
- [Polling for Approvals](#polling-for-approvals)
- [Webhook Integration](#webhook-integration)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)

## The Problem

Some operations can't be fully automated:

```typescript
// Problem: Need manager approval for large orders
async function processOrder(order: Order) {
  if (order.total > 10000) {
    // How do we pause here and wait for approval?
    // How do we resume days later?
    // How do we handle server restarts?
  }
  await fulfillOrder(order);
}
```

Challenges:
- **Long waits**: Approvals may take hours or days
- **Server restarts**: Can't hold requests in memory
- **State persistence**: Need to save progress and resume later
- **Multiple approvals**: Some workflows need multiple sign-offs
- **Visibility**: Approvers need to see pending requests

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    HITL Orchestrator                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Execute │───▶│ Pause at     │───▶│ Save State    │  │
│  │ Workflow│    │ Approval Step│    │ to Store      │  │
│  └─────────┘    └──────────────┘    └───────────────┘  │
│                                             │           │
│                                             ▼           │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Resume  │◀───│ Approval     │◀───│ Wait for      │  │
│  │ Workflow│    │ Granted      │    │ Human Input   │  │
│  └─────────┘    └──────────────┘    └───────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

1. Workflow executes until it hits an approval step
2. State is saved to a persistent store
3. System waits for human approval (via webhook, polling, etc.)
4. When approved, workflow resumes from where it paused
5. Process continues until completion or next approval

## Quick Start

```typescript
import { createHITLOrchestrator, createMemoryApprovalStore, createMemoryWorkflowStateStore } from 'awaitly/hitl';
import { createWorkflow, createApprovalStep, ok, err } from 'awaitly';

// 1. Create stores (use database stores in production)
const approvalStore = createMemoryApprovalStore();
const workflowStateStore = createMemoryWorkflowStateStore();

// 2. Create the orchestrator
const orchestrator = createHITLOrchestrator({
  approvalStore,
  workflowStateStore,
});

// 3. Define your workflow with approval steps
const deps = {
  createOrder: async (items) => ok({ orderId: 'ord_123', total: 15000 }),
  requireManagerApproval: createApprovalStep<{ approvedBy: string }>({
    key: (orderId) => `approval:manager:${orderId}`,
    pendingReason: 'Waiting for manager approval',
  }),
  fulfillOrder: async (orderId) => ok({ shipped: true }),
};

// 4. Execute the workflow
const result = await orchestrator.execute(
  'order-approval',
  ({ resumeState, onEvent }) => createWorkflow(deps, { resumeState, onEvent }),
  async (step, deps, { items }) => {
    const order = await step(() => deps.createOrder(items));

    // This step will pause the workflow if not yet approved
    const approval = await step(
      () => deps.requireManagerApproval(order.orderId),
      { key: `approval:manager:${order.orderId}` }
    );

    await step(() => deps.fulfillOrder(order.orderId));
    return { orderId: order.orderId, approvedBy: approval.approvedBy };
  },
  { items: [{ sku: 'WIDGET', qty: 1000 }] }
);

if (result.status === 'paused') {
  console.log(`Workflow paused. Pending: ${result.pendingApprovals}`);
  // Later: orchestrator.grantApproval('approval:manager:ord_123', { approvedBy: 'jane@example.com' });
}
```

## HITL Orchestrator

The orchestrator manages the full lifecycle of approval workflows.

### Creating an Orchestrator

```typescript
import {
  createHITLOrchestrator,
  createMemoryApprovalStore,
  createMemoryWorkflowStateStore,
} from 'awaitly/hitl';

const orchestrator = createHITLOrchestrator({
  // Required: Where to store approval states
  approvalStore: createMemoryApprovalStore(),

  // Required: Where to store workflow state
  workflowStateStore: createMemoryWorkflowStateStore(),

  // Optional: Default expiration for approvals (default: 7 days)
  defaultExpirationMs: 7 * 24 * 60 * 60 * 1000,

  // Optional: Logger
  logger: (msg) => console.log(`[HITL] ${msg}`),
});
```

### Executing Workflows

```typescript
const result = await orchestrator.execute(
  'workflow-name',                              // Workflow identifier
  ({ resumeState, onEvent }) =>                 // Factory that creates workflow
    createWorkflow(deps, { resumeState, onEvent }),
  async (step, deps, input) => { /* ... */ },   // Workflow function
  { /* input data */ },                         // Input
  { runId: 'custom-id', metadata: { userId: '123' } }  // Optional
);

// Result can be:
// { status: 'completed', result: Result<T, E> }
// { status: 'paused', runId: string, pendingApprovals: string[], reason?: string }
// { status: 'resumed', runId: string, result: Result<T, E> }
```

### Granting Approvals

```typescript
// Grant an approval
const { grantedAt, resumedWorkflows } = await orchestrator.grantApproval(
  'approval:manager:ord_123',      // Approval key
  { approvedBy: 'jane@example.com' },  // Value to inject
  {
    approvedBy: 'jane@example.com',    // Who approved
    autoResume: true,                   // Auto-resume waiting workflows
  }
);

// Reject an approval
await orchestrator.rejectApproval(
  'approval:manager:ord_123',
  'Order value exceeds department budget',
  { rejectedBy: 'john@example.com' }
);
```

### Resuming Workflows

```typescript
// Manually resume a paused workflow
const result = await orchestrator.resume(
  'run_abc123',                                 // Run ID
  ({ resumeState, onEvent }) =>                 // Same factory
    createWorkflow(deps, { resumeState, onEvent }),
  async (step, deps, input) => { /* ... */ }    // Same workflow function
);
```

### Querying Status

```typescript
// Get status of a specific workflow
const status = await orchestrator.getWorkflowStatus('run_abc123');
if (status) {
  console.log(`Workflow: ${status.workflowName}`);
  console.log(`Pending: ${status.pendingApprovals}`);
  console.log(`Started: ${new Date(status.startedAt)}`);
}

// List all pending workflows
const pending = await orchestrator.listPendingWorkflows('order-approval');
console.log(`${pending.length} orders awaiting approval`);

// Clean up old completed workflows
const cleaned = await orchestrator.cleanup(30 * 24 * 60 * 60 * 1000); // 30 days
console.log(`Cleaned up ${cleaned} old workflows`);
```

## Approval Stores

Approval stores track the status of approval requests.

### Interface

```typescript
interface ApprovalStore {
  getApproval(key: string): Promise<ApprovalStatus>;
  createApproval(key: string, options?: { metadata?; expiresAt? }): Promise<void>;
  grantApproval<T>(key: string, value: T, options?: { approvedBy? }): Promise<void>;
  rejectApproval(key: string, reason: string, options?: { rejectedBy? }): Promise<void>;
  cancelApproval(key: string): Promise<void>;
  listPending(options?: { prefix? }): Promise<string[]>;
}
```

### In-Memory Store (Development)

```typescript
import { createMemoryApprovalStore } from 'awaitly/hitl';

const store = createMemoryApprovalStore();
```

### Database Store (Production)

Implement the interface with your database:

```typescript
// Example: PostgreSQL
const pgApprovalStore: ApprovalStore = {
  async getApproval(key) {
    const row = await db.query('SELECT * FROM approvals WHERE key = $1', [key]);
    if (!row) return { status: 'pending' };

    if (row.expires_at && Date.now() > row.expires_at) {
      return { status: 'expired', expiredAt: row.expires_at };
    }

    if (row.approved_at) {
      return {
        status: 'approved',
        value: row.value,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
      };
    }

    if (row.rejected_at) {
      return {
        status: 'rejected',
        reason: row.reason,
        rejectedBy: row.rejected_by,
        rejectedAt: row.rejected_at,
      };
    }

    return { status: 'pending' };
  },

  async createApproval(key, options) {
    await db.query(
      'INSERT INTO approvals (key, metadata, expires_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
      [key, options?.metadata, options?.expiresAt]
    );
  },

  async grantApproval(key, value, options) {
    await db.query(
      'UPDATE approvals SET value = $2, approved_by = $3, approved_at = $4 WHERE key = $1',
      [key, value, options?.approvedBy, Date.now()]
    );
  },

  async rejectApproval(key, reason, options) {
    await db.query(
      'UPDATE approvals SET reason = $2, rejected_by = $3, rejected_at = $4 WHERE key = $1',
      [key, reason, options?.rejectedBy, Date.now()]
    );
  },

  async cancelApproval(key) {
    await db.query('DELETE FROM approvals WHERE key = $1', [key]);
  },

  async listPending(options) {
    const rows = await db.query(
      'SELECT key FROM approvals WHERE approved_at IS NULL AND rejected_at IS NULL AND (key LIKE $1 OR $1 IS NULL)',
      [options?.prefix ? `${options.prefix}%` : null]
    );
    return rows.map(r => r.key);
  },
};
```

## Workflow State Stores

Workflow state stores persist workflow progress for resumption.

### Interface

```typescript
interface WorkflowStateStore {
  save(state: SavedWorkflowState): Promise<void>;
  load(runId: string): Promise<SavedWorkflowState | undefined>;
  delete(runId: string): Promise<void>;
  list(options?: { workflowName?; hasPendingApprovals? }): Promise<string[]>;
  findByPendingApproval(approvalKey: string): Promise<string[]>;
}
```

### In-Memory Store (Development)

```typescript
import { createMemoryWorkflowStateStore } from 'awaitly/hitl';

const store = createMemoryWorkflowStateStore();
```

## Polling for Approvals

Wait for an approval with polling:

```typescript
const status = await orchestrator.pollApproval<{ approvedBy: string }>(
  'approval:manager:ord_123',
  {
    intervalMs: 5000,      // Poll every 5 seconds
    maxPolls: 60,          // Max 60 attempts (5 minutes)
    timeoutMs: 300000,     // Or timeout after 5 minutes
    onPollStart: () => console.log('Checking...'),
    onPollComplete: (status) => console.log(`Status: ${status.status}`),
  }
);

if (status.status === 'approved') {
  console.log(`Approved by ${status.value.approvedBy}`);
} else if (status.status === 'rejected') {
  console.log(`Rejected: ${status.reason}`);
} else if (status.status === 'expired') {
  console.log('Approval request expired');
} else {
  console.log('Still pending after polling');
}
```

## Webhook Integration

### Webhook Handler

Create a webhook handler for approval actions:

```typescript
import { createApprovalWebhookHandler } from 'awaitly/hitl';

const handleApproval = createApprovalWebhookHandler(approvalStore);

// Express example
app.post('/api/approvals', async (req, res) => {
  const result = await handleApproval(req.body);
  res.json(result);
});

// Request body format:
// {
//   key: 'approval:manager:ord_123',
//   action: 'approve' | 'reject' | 'cancel',
//   value: { approvedBy: 'jane@example.com' },  // For approve
//   reason: 'Budget exceeded',                  // For reject
//   actorId: 'jane@example.com'
// }
```

### Approval Status Endpoint

```typescript
app.get('/api/approvals/:key', async (req, res) => {
  const status = await approvalStore.getApproval(req.params.key);
  res.json(status);
});

app.get('/api/approvals', async (req, res) => {
  const pending = await approvalStore.listPending({
    prefix: req.query.prefix as string,
  });
  res.json({ pending });
});
```

### Workflow Status Endpoint

```typescript
app.get('/api/workflows/:runId', async (req, res) => {
  const status = await orchestrator.getWorkflowStatus(req.params.runId);
  if (!status) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  res.json(status);
});

app.get('/api/workflows', async (req, res) => {
  const pending = await orchestrator.listPendingWorkflows(
    req.query.name as string
  );
  res.json({ pending });
});
```

## Best Practices

### 1. Use Meaningful Approval Keys

```typescript
// Good: Descriptive, unique, parseable
const key = `approval:expense:${expenseId}:manager`;
const key = `approval:order:${orderId}:finance`;

// Bad: Generic, not unique
const key = 'approval1';
const key = `order-${Math.random()}`;
```

### 2. Include Context in Metadata

```typescript
await approvalStore.createApproval(key, {
  metadata: {
    orderId,
    amount: order.total,
    requestedBy: currentUser.email,
    department: currentUser.department,
    reason: 'Large order requires manager approval',
  },
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
});
```

### 3. Set Appropriate Expiration

```typescript
// Urgent approvals: short expiration
const urgentExpiry = Date.now() + 4 * 60 * 60 * 1000; // 4 hours

// Standard approvals: medium expiration
const standardExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

// Low-priority: longer expiration
const lowPriorityExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
```

### 4. Notify Approvers

```typescript
const result = await orchestrator.execute(/* ... */);

if (result.status === 'paused') {
  // Send notification to approvers
  await sendSlackMessage({
    channel: '#approvals',
    text: `New approval needed: ${result.pendingApprovals[0]}`,
    actions: [
      { type: 'button', text: 'Approve', url: `/approve/${result.runId}` },
      { type: 'button', text: 'Reject', url: `/reject/${result.runId}` },
    ],
  });
}
```

### 5. Handle Expiration Gracefully

```typescript
// Check for expired approvals periodically
setInterval(async () => {
  const pending = await approvalStore.listPending();

  for (const key of pending) {
    const status = await approvalStore.getApproval(key);
    if (status.status === 'expired') {
      // Notify requestor
      await sendExpiredNotification(key);
      // Clean up
      await approvalStore.cancelApproval(key);
    }
  }
}, 60 * 60 * 1000); // Every hour
```

## API Reference

### Types

```typescript
type ApprovalStatus<T = unknown> =
  | { status: 'pending' }
  | { status: 'approved'; value: T; approvedBy?: string; approvedAt?: number }
  | { status: 'rejected'; reason: string; rejectedBy?: string; rejectedAt?: number }
  | { status: 'expired'; expiredAt: number };

type HITLExecutionResult<T, E> =
  | { status: 'completed'; result: Result<T, E> }
  | { status: 'paused'; runId: string; pendingApprovals: string[]; reason?: string }
  | { status: 'resumed'; runId: string; result: Result<T, E> };

interface SavedWorkflowState {
  runId: string;
  workflowName: string;
  resumeState: ResumeState;
  pendingApprovals: string[];
  input?: unknown;
  metadata?: Record<string, unknown>;
  startedAt: number;
  updatedAt: number;
}
```

### Functions

| Function | Description |
|----------|-------------|
| `createHITLOrchestrator(options)` | Create a HITL orchestrator |
| `createMemoryApprovalStore()` | In-memory approval store (dev) |
| `createMemoryWorkflowStateStore()` | In-memory workflow store (dev) |
| `createApprovalWebhookHandler(store)` | Webhook handler for approvals |
| `createApprovalChecker(store)` | Create approval checker function |

### HITLOrchestrator Methods

| Method | Description |
|--------|-------------|
| `execute(name, factory, fn, input, opts?)` | Execute workflow |
| `resume(runId, factory, fn)` | Resume paused workflow |
| `grantApproval(key, value, opts?)` | Grant an approval |
| `rejectApproval(key, reason, opts?)` | Reject an approval |
| `pollApproval(key, opts?)` | Poll for approval |
| `getWorkflowStatus(runId)` | Get workflow status |
| `listPendingWorkflows(name?)` | List pending workflows |
| `cleanup(maxAgeMs)` | Clean up old workflows |
