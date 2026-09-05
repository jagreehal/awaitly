---
title: Entity Status and Workflow State
description: Keep lifecycle rules in your domain and let the workflow drive them
---

Your database row has a `status` column. Your workflow has a snapshot. Both track
progress, and they answer different questions. Confusing them produces two
recognisable bugs.

## The two questions

A transition map answers: from this status, what may happen next?

```typescript
const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['VALIDATING'],
  VALIDATING: ['VALIDATED', 'FAILED_VALIDATION'],
  FAILED_VALIDATION: ['VALIDATING'], // retryable
  VALIDATED: ['SUBMITTING'],
  SUBMITTING: ['SUBMITTED', 'SUBMISSION_ERROR', 'SUBMISSION_FAILED'],
  SUBMISSION_ERROR: ['SUBMITTING'], // retryable
  SUBMISSION_FAILED: [],
  SUBMITTED: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};
```

A workflow answers a different question: who does the work, in what order, with
which waits and retries.

```typescript
await durable.run(deps, async ({ step, deps: d }) => {
  const batch = await step('loadBatch', () => d.loadBatch(batchId));
  const payments = await step('splitBatch', () => d.splitBatch(batch));
  const valid = await step('validate', () => d.validate(payments));

  // maxIterations stops the loop when it is reached, so an unchecked batch
  // larger than the bound would report success having skipped the rest.
  // Reject the oversized batch instead.
  await step('checkBatchSize', () => d.assertWithinLimit(valid, MAX_PAYMENTS));

  await step.forEach('submitAll', valid, {
    stepIdPattern: 'submit-{i}',
    maxIterations: MAX_PAYMENTS,
    run: async (payment) => step.retry('submit', () => d.submit(payment), {
      attempts: 3,
      backoff: 'exponential',
    }),
  });

  return step('complete', () => d.markComplete(batch.id), { errors: [] });
}, { id: `batch-${batchId}`, store });
```

Keep both. The workflow causes transitions. The map decides whether each one is
allowed.

## Bug one: statuses as checkpoints

Teams add `SPLITTING`, `VALIDATING`, `PROCESSING` so a crashed worker can find
where it stopped. Those statuses exist to serve resume, not to describe the
entity. You can spot them by their pairing: every `*-ING` sits next to an
`*-ED`.

Durable execution removes the need. The snapshot records which steps finished,
so a restarted worker resumes at the payment it died on rather than replaying
the batch. Persist the statuses other systems query, and leave transient
progress on the execution:

```
PENDING → SCHEDULED → PROCESSING → SUBMITTED → COMPLETED | CANCELLED
```

Your entity column shrinks. Your workflow keeps the detail.

## Bug two: guarding inside the workflow

This looks careful and protects almost nothing:

```typescript
// inside a workflow step
if (payment.status !== 'SUBMITTED') throw new Error('bad state');
await prisma.payment.update({ where: { id }, data: { status: 'COMPLETED' } });
```

It holds only when the workflow is the sole writer. Count the writers in a
payments system: the processor, the cancel path, provider webhooks, and whoever
repairs a stuck row at 3am. A webhook calling `prisma.payment.update`
walks straight past a guard that lives in Temporal or awaitly.

Put the rule in the domain and make it perform the write:

```typescript
export async function transitionPayment(args: {
  prisma: PrismaClient;
  paymentId: string;
  to: PaymentStatus;
  data?: Record<string, unknown>;
}): Promise<PaymentStatus> {
  const { prisma, paymentId, to, data } = args;

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { status: true },
  });
  if (!payment) throw new PaymentsError({ code: 'PAYMENTS_NOT_FOUND' });

  const from = payment.status as PaymentStatus;
  if (from === to) return to; // webhooks arrive at least once
  if (!PAYMENT_TRANSITIONS[from].includes(to)) {
    throw new PaymentsError({
      code: 'PAYMENT_INVALID_STATE',
      message: `Cannot move ${paymentId} from ${from} to ${to}`,
    });
  }

  // Compare-and-set on the status we validated against.
  const { count } = await prisma.payment.updateMany({
    where: { id: paymentId, status: from },
    data: { ...data, status: to },
  });
  if (count === 0) {
    throw new PaymentsError({
      code: 'PAYMENT_INVALID_STATE',
      message: `${paymentId} moved while transitioning from ${from}`,
    });
  }

  return to;
}
```

Three properties earn their place here.

The function writes. A helper that returns `true` or `false` and leaves the
update to the caller gets skipped, and you will not notice until production. One
codebase we measured had four guarded transitions against thirty-six status
writes.

The update matches on the status it validated. Read, check, then update leaves
the race open: a webhook and the processor both read `SUBMITTED`, both decide
they may write, and the second overwrites the first. Matching on `status: from`
means one of them updates zero rows and finds out.

Redelivery is a no-op. Providers send the same webhook twice, and the second
delivery should not raise an alarm.

Your workflow step then calls the same function every other writer calls:

```typescript
await step('complete', () =>
  transitionPayment({ prisma, paymentId, to: 'COMPLETED' })
);
```

## Where a state machine library fits

Reach for XState when the graph gets hard: nested states, parallel regions, many
events, a diagram worth reading. A linear pipeline with fail and cancel forks
does not need one. A typed `Record<Status, Status[]>` covers it, and the
compiler enforces coverage: add a status without deciding where it leads and the
build fails. Leave the key off and TypeScript stays quiet while that status
becomes terminal without anyone choosing it.

## Checklist

- Type the map as `Record<Status, Status[]>` so new statuses cannot drift
- Make the transition function perform the write
- Match on the previous status so concurrent writers cannot both win
- Treat a repeat of the current status as success
- Keep `*-ING` statuses only when another system queries them
