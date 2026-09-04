import { createWorkflow, err, ok, type AsyncResult } from 'awaitly';

export type BatchNotFound = { type: 'BATCH_NOT_FOUND'; batchId: string };
export type SubmitRejected = { type: 'SUBMIT_REJECTED'; batchId: string };

const loadBatch = async (
  batchId: string,
): AsyncResult<{ id: string }, BatchNotFound> =>
  batchId === 'b-1'
    ? ok({ id: batchId })
    : err({ type: 'BATCH_NOT_FOUND', batchId });

const submitBatch = async (batch: {
  id: string;
}): AsyncResult<string, SubmitRejected> => ok(batch.id);

const auditBatch = async (batch: {
  id: string;
}): AsyncResult<string, 'LiteralFailure'> => ok(batch.id);

const workflow = createWorkflow('errorUnionPipeline', {
  loadBatch,
  submitBatch,
  auditBatch,
});

export const result = workflow.run(async ({ step, deps }) => {
  const batch = await step('loadBatch', () => deps.loadBatch('b-1'));
  await step('submitBatch', () => deps.submitBatch(batch));
  return await step('auditBatch', () => deps.auditBatch(batch));
});
