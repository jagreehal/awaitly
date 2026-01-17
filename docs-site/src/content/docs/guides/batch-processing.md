---
title: Batch Processing
description: Process large datasets with bounded concurrency
---

Process items in batches with progress tracking and checkpoint hooks. Useful for embedding generation, bulk API calls, or database migrations.

## Basic usage

```typescript
import { processInBatches, ok, err, type AsyncResult } from 'awaitly/batch';

const embedText = async (text: string): AsyncResult<number[], 'EMBED_ERROR'> => {
  const response = await fetch('/api/embed', { method: 'POST', body: text });
  return response.ok ? ok(await response.json()) : err('EMBED_ERROR');
};

const result = await processInBatches(
  texts,                    // Array of items
  embedText,                // Process function
  { batchSize: 20, concurrency: 3 }
);

if (result.ok) {
  console.log(`Processed ${result.value.length} items`);
}
```

## Configuration

```typescript
{
  batchSize: 20,      // Items per batch
  concurrency: 3,     // Parallel operations within each batch
  batchDelayMs: 50,   // Delay between batches (backpressure)
}
```

## Progress tracking

```typescript
const result = await processInBatches(
  items,
  processItem,
  { batchSize: 20, concurrency: 3 },
  {
    onProgress: (progress) => {
      console.log(`${progress.percent}% complete`);
      console.log(`Batch ${progress.batch}/${progress.totalBatches}`);
      console.log(`${progress.processed}/${progress.total} items`);
    },
  }
);
```

## Checkpoint hooks

Run code between batches (e.g., flush database WAL):

```typescript
const result = await processInBatches(
  records,
  insertRecord,
  { batchSize: 100, concurrency: 5 },
  {
    afterBatch: async () => {
      await db.checkpoint();
      return ok(undefined);
    },
  }
);
```

If `afterBatch` returns an error, processing stops.

## Presets

Use presets for common scenarios:

```typescript
import { processInBatches, batchPresets } from 'awaitly/batch';

// Conservative: batchSize=20, concurrency=3, delay=50ms
// Good for memory-constrained environments
await processInBatches(items, process, batchPresets.conservative);

// Balanced: batchSize=50, concurrency=5, delay=10ms
// Good for typical workloads
await processInBatches(items, process, batchPresets.balanced);

// Aggressive: batchSize=100, concurrency=10, no delay
// Good when memory isn't a concern
await processInBatches(items, process, batchPresets.aggressive);
```

## Error handling

Processing stops on the first error:

```typescript
const result = await processInBatches(
  items,
  async (item, index) => {
    if (item.invalid) {
      return err('INVALID_ITEM');
    }
    return ok(await process(item));
  },
  { batchSize: 20, concurrency: 3 }
);

if (!result.ok) {
  if (isBatchProcessingError(result.error)) {
    console.log('Failed at item:', result.error.itemIndex);
    console.log('In batch:', result.error.batchNumber);
    console.log('Underlying error:', result.error.error);
  }
}
```

## Item index

The process function receives the global index:

```typescript
const result = await processInBatches(
  items,
  async (item, index) => {
    console.log(`Processing item ${index + 1} of ${items.length}`);
    return ok(await process(item));
  },
  { batchSize: 20, concurrency: 3 }
);
```

## Config validation

Invalid config returns an error immediately:

```typescript
const result = await processInBatches(
  items,
  process,
  { batchSize: 0, concurrency: 3 } // Invalid!
);

if (!result.ok && isInvalidBatchConfigError(result.error)) {
  console.log(result.error.reason); // "batchSize must be a positive integer"
  console.log(result.error.field);  // "batchSize"
  console.log(result.error.value);  // 0
}
```

`batchSize` and `concurrency` must be positive integers.

## Full example

```typescript
import {
  processInBatches,
  batchPresets,
  isBatchProcessingError,
  ok,
  err,
} from 'awaitly';

// Generate embeddings for documents
const generateEmbeddings = async (documents: Document[]) => {
  let processed = 0;

  const result = await processInBatches(
    documents,
    async (doc) => {
      const response = await fetch('/api/embed', {
        method: 'POST',
        body: JSON.stringify({ text: doc.content }),
      });

      if (!response.ok) {
        return err('EMBED_FAILED' as const);
      }

      return ok({
        docId: doc.id,
        embedding: await response.json(),
      });
    },
    batchPresets.conservative,
    {
      afterBatch: async () => {
        // Checkpoint after each batch
        await db.checkpoint();
        return ok(undefined);
      },
      onProgress: (p) => {
        console.log(`Embedding documents: ${p.percent}%`);
      },
    }
  );

  if (!result.ok) {
    if (isBatchProcessingError(result.error)) {
      console.error(`Failed at document ${result.error.itemIndex}`);
    }
    return result;
  }

  // Save all embeddings
  await db.embeddings.insertMany(result.value);
  return ok({ count: result.value.length });
};
```

## Next

[See Patterns: Checkout Flow →](/workflow/patterns/checkout-flow/)
