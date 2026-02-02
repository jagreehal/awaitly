/**
 * Test fixture: step.forEach() with all options
 *
 * Tests both forms:
 * 1. Simple run form: step.forEach('id', items, { run: (item) => ... })
 * 2. Complex item form: step.forEach('id', items, { item: step.item(...) })
 *
 * With all options:
 * - maxIterations, stepIdPattern, errors, out, collect
 */
import { createWorkflow, ok, type AsyncResult } from "awaitly";

const processItem = async (
  itemId: string
): AsyncResult<{ itemId: string; processed: true }, "PROCESS_ERROR"> => {
  return ok({ itemId, processed: true });
};

const validateItem = async (
  itemId: string
): AsyncResult<{ itemId: string; valid: true }, "VALIDATION_ERROR"> => {
  return ok({ itemId, valid: true });
};

export const batchWorkflow = createWorkflow({
  id: 'batch-processing',
  deps: { processItem, validateItem },
});

// Simple run form
export async function processItemsSimple(items: string[]) {
  return await batchWorkflow(async (step, ctx) => {
    await step.forEach('process-items', items, {
      maxIterations: 100,
      stepIdPattern: 'process-{i}',
      errors: ['PROCESS_ERROR'],
      out: 'results',
      collect: 'array',
      run: (item) => ctx.deps.processItem(item),
    });
  });
}

// Complex item form with multiple steps in body
export async function processItemsComplex(items: string[]) {
  return await batchWorkflow(async (step, ctx) => {
    await step.forEach('process-items', items, {
      maxIterations: 50,
      stepIdPattern: 'item-{i}',
      out: 'lastResult',
      collect: 'last',
      item: step.item((item, i, s) => {
        s('validate', () => ctx.deps.validateItem(item), {
          errors: ['VALIDATION_ERROR'],
        });
        s('process', () => ctx.deps.processItem(item), {
          errors: ['PROCESS_ERROR'],
        });
      }),
    });
  });
}
