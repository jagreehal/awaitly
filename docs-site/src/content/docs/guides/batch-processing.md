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
import { ok, err } from 'awaitly';
import {
  processInBatches,
  batchPresets,
  isBatchProcessingError,
} from 'awaitly/batch';

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

## Memory considerations

Large datasets can exhaust memory. Here's how to handle them:

### Before vs after: Without batching

```typescript
// ❌ Without batching - loads everything into memory
const embeddings = await Promise.all(
  documents.map(doc => embedText(doc.content))
);
// Risk: 10,000 documents × 4KB each = 40MB in memory at once
```

```typescript
// ✅ With batching - bounded memory usage
const result = await processInBatches(
  documents,
  async (doc) => ok(await embedText(doc.content)),
  { batchSize: 50, concurrency: 5 }
);
// Only 50 × 5 = 250 concurrent operations max
```

### Monitor memory usage

```typescript
const result = await processInBatches(
  documents,
  async (doc) => ok(await processDocument(doc)),
  { batchSize: 50, concurrency: 5 },
  {
    afterBatch: async () => {
      // Check memory between batches
      const usage = process.memoryUsage();
      console.log(`Heap used: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`);

      // If memory is too high, force garbage collection (if available)
      if (usage.heapUsed > 500 * 1024 * 1024) {
        global.gc?.();
      }

      return ok(undefined);
    },
  }
);
```

### Choosing batch size

| Data size per item | Suggested batch size | Why |
|-------------------|---------------------|-----|
| < 1KB | 100+ | Low memory impact |
| 1-10KB | 50 | Moderate impact |
| 10-100KB | 20 | Higher impact |
| > 100KB | 5-10 | Process slowly to avoid OOM |

## Streaming large datasets

For very large datasets, stream items instead of loading all at once:

```typescript
import { Readable } from 'stream';

// Stream items from database
async function* streamDocuments(): AsyncGenerator<Document> {
  let cursor: string | null = null;

  while (true) {
    const batch = await db.documents.findMany({
      take: 100,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { id: 'asc' },
    });

    if (batch.length === 0) break;

    for (const doc of batch) {
      yield doc;
    }

    cursor = batch[batch.length - 1].id;
  }
}

// Process in chunks
async function processLargeDataset() {
  const generator = streamDocuments();
  let chunk: Document[] = [];
  let processed = 0;

  for await (const doc of generator) {
    chunk.push(doc);

    // Process when chunk is full
    if (chunk.length >= 1000) {
      const result = await processInBatches(
        chunk,
        async (d) => ok(await processDocument(d)),
        batchPresets.conservative
      );

      if (!result.ok) {
        console.error(`Failed at offset ${processed}`);
        return result;
      }

      processed += chunk.length;
      chunk = [];
      console.log(`Processed ${processed} documents`);
    }
  }

  // Process remaining
  if (chunk.length > 0) {
    await processInBatches(chunk, async (d) => ok(await processDocument(d)), batchPresets.conservative);
  }

  return ok({ total: processed });
}
```

## Partial failure recovery

Resume from where processing failed:

### Save progress

```typescript
interface BatchProgress {
  lastCompletedIndex: number;
  successfulIds: string[];
  failedIds: string[];
}

async function processWithRecovery(items: Item[]): Promise<Result<void, unknown>> {
  // Load previous progress
  const progress = await loadProgress() ?? {
    lastCompletedIndex: -1,
    successfulIds: [],
    failedIds: [],
  };

  // Skip already processed items
  const remaining = items.slice(progress.lastCompletedIndex + 1);
  console.log(`Resuming from index ${progress.lastCompletedIndex + 1}, ${remaining.length} items left`);

  const result = await processInBatches(
    remaining,
    async (item, index) => {
      const globalIndex = progress.lastCompletedIndex + 1 + index;
      try {
        await processItem(item);
        progress.successfulIds.push(item.id);
        progress.lastCompletedIndex = globalIndex;
        return ok(item.id);
      } catch (error) {
        progress.failedIds.push(item.id);
        return err('ITEM_FAILED' as const);
      }
    },
    batchPresets.conservative,
    {
      afterBatch: async () => {
        // Save progress after each batch
        await saveProgress(progress);
        return ok(undefined);
      },
    }
  );

  // Save final progress
  await saveProgress(progress);
  return result;
}
```

### Retry failed items

```typescript
async function retryFailedItems() {
  const progress = await loadProgress();
  if (!progress || progress.failedIds.length === 0) {
    console.log('No failed items to retry');
    return;
  }

  const failedItems = await db.items.findMany({
    where: { id: { in: progress.failedIds } },
  });

  console.log(`Retrying ${failedItems.length} failed items`);

  const result = await processInBatches(
    failedItems,
    async (item) => {
      await processItem(item);
      // Remove from failed list on success
      progress.failedIds = progress.failedIds.filter(id => id !== item.id);
      progress.successfulIds.push(item.id);
      return ok(item.id);
    },
    { ...batchPresets.conservative, batchDelayMs: 1000 } // Slower retry
  );

  await saveProgress(progress);
  return result;
}
```

## Next

[See Patterns: Checkout Flow →](../../patterns/checkout-flow/)
