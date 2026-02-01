---
title: Streaming
description: Result-aware streaming for real-time data and AI token streaming
---

:::caution[Options go to createWorkflow]
The `streamStore` option must be passed to `createWorkflow(deps, { streamStore })`, not when calling the workflow.
:::

Stream data in real-time within workflows. Perfect for AI token streaming, live updates, and processing large datasets incrementally.

## Quick Start

```typescript
import { createWorkflow } from 'awaitly/workflow';
import { createMemoryStreamStore, toAsyncIterable } from 'awaitly/streaming';

// 1. Create a stream store
const streamStore = createMemoryStreamStore();

// 2. Pass it to createWorkflow
const workflow = createWorkflow(deps, { streamStore });

// 3. Write to streams
const result = await workflow(async (step) => {
  const writer = step.getWritable<string>({ namespace: 'tokens' });

  await writer.write('Hello');
  await writer.write(' World');
  await writer.close();
});
```

## Stream Stores

Choose a store based on your needs:

### Memory Store (Development/Testing)

```typescript
import { createMemoryStreamStore } from 'awaitly/streaming';

const streamStore = createMemoryStreamStore();
```

### File Store (Persistence)

```typescript
import { createFileStreamStore } from 'awaitly/streaming';
import * as fs from 'node:fs/promises';

const streamStore = createFileStreamStore({
  directory: './streams',
  fs,
});
```

## Writing to Streams

Use `step.getWritable<T>()` to create a writer:

```typescript
const result = await workflow(async (step) => {
  const writer = step.getWritable<string>({ namespace: 'ai-response' });

  // Write items
  const writeResult = await writer.write('token1');
  if (!writeResult.ok) {
    // Handle write error
    return err(writeResult.error);
  }

  await writer.write('token2');
  await writer.write('token3');

  // Always close when done
  await writer.close();
});
```

### AI Token Streaming Example

```typescript
const result = await workflow(async (step) => {
  const writer = step.getWritable<string>({ namespace: 'ai-tokens' });

  await step(() => generateAI({
    prompt: 'Explain TypeScript',
    onToken: async (token) => {
      await writer.write(token);
    }
  }), { key: 'generate' });

  await writer.close();
});
```

## Reading from Streams

Use `step.getReadable<T>()` to consume a stream:

```typescript
const result = await workflow(async (step) => {
  const reader = step.getReadable<string>({ namespace: 'tokens' });

  let item = await reader.read();
  while (item.ok) {
    console.log(item.value);
    item = await reader.read();
  }

  // item.error.type === 'STREAM_ENDED' when complete
  if (item.error.type === 'STREAM_ENDED') {
    console.log('Stream finished at position', item.error.finalPosition);
  }
});
```

### Resume from Position

Resume reading from where you left off:

```typescript
const reader = step.getReadable<string>({
  namespace: 'tokens',
  startIndex: lastPosition + 1, // Resume from last known position
});
```

## Using AsyncIterable

Convert readers to `for await...of` syntax:

```typescript
import { toAsyncIterable } from 'awaitly/streaming';

const result = await workflow(async (step) => {
  const reader = step.getReadable<string>({ namespace: 'tokens' });

  for await (const token of toAsyncIterable(reader)) {
    process.stdout.write(token);
  }
});
```

## Stream Transformers

Transform streams with functional operators:

### map / filter

```typescript
import { map, filter, toAsyncIterable } from 'awaitly/streaming';

const reader = step.getReadable<number>({ namespace: 'numbers' });

// Filter even numbers, then double them
const evens = filter(reader, n => n % 2 === 0);
const doubled = map(evens, n => n * 2);

for await (const value of doubled) {
  console.log(value); // 4, 8, 12, ...
}
```

### chunk (Batching)

```typescript
import { chunk } from 'awaitly/streaming';

const reader = step.getReadable<string>({ namespace: 'items' });
const batches = chunk(reader, 10); // Groups of 10

for await (const batch of batches) {
  await processBatch(batch); // batch is string[]
}
```

### take / skip

```typescript
import { take, skip, collect } from 'awaitly/streaming';

const reader = step.getReadable<number>({ namespace: 'numbers' });

// Skip first 5, take next 10
const skipped = skip(reader, 5);
const limited = take(skipped, 10);
const items = await collect(limited); // number[]
```

### reduce

```typescript
import { reduce } from 'awaitly/streaming';

const reader = step.getReadable<number>({ namespace: 'numbers' });
const sum = await reduce(reader, (acc, n) => acc + n, 0);
```

### pipe (Composition)

```typescript
import { pipe, filter, map, take, collect } from 'awaitly/streaming';

const reader = step.getReadable<number>({ namespace: 'numbers' });

const result = await collect(
  pipe(
    reader,
    s => filter(s, n => n % 2 === 0),
    s => map(s, n => n * 2),
    s => take(s, 10)
  )
);
```

## Batch Processing with streamForEach

Process stream items with concurrency and checkpointing:

```typescript
const result = await workflow(async (step) => {
  const reader = step.getReadable<Order>({ namespace: 'orders' });

  const processed = await step.streamForEach(
    reader,
    async (order) => {
      const result = await processOrder(order);
      return ok(result);
    },
    {
      name: 'process-orders',
      concurrency: 5,           // Process 5 in parallel
      checkpointInterval: 10,   // Checkpoint every 10 items
    }
  );

  if (processed.ok) {
    console.log(`Processed ${processed.value.processedCount} orders`);
    console.log(`Last position: ${processed.value.lastPosition}`);
  }
});
```

## External Stream Access

Consume streams outside workflows (e.g., HTTP handlers):

```typescript
import { getStreamReader, toAsyncIterable } from 'awaitly/streaming';

// Express/Fastify handler
app.get('/stream/:workflowId', async (req, res) => {
  const reader = getStreamReader<string>({
    store: streamStore,
    workflowId: req.params.workflowId,
    namespace: 'ai-response',
    startIndex: 0,           // Or resume from last position
    pollTimeout: 30000,      // Wait up to 30s for new items
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for await (const chunk of toAsyncIterable(reader)) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  res.end();
});
```

### Resume from Client Position

```typescript
app.get('/stream/:workflowId', async (req, res) => {
  const lastPosition = parseInt(req.query.lastPosition ?? '0', 10);

  const reader = getStreamReader<string>({
    store: streamStore,
    workflowId: req.params.workflowId,
    namespace: 'tokens',
    startIndex: lastPosition, // Resume from client's last position
  });

  // ...
});
```

## Backpressure

Control memory usage when consumers are slower than producers:

```typescript
const writer = step.getWritable<string>({
  namespace: 'tokens',
  highWaterMark: 16, // Pause after 16 buffered items
});

// Write operations respect backpressure automatically
for (const item of largeDataset) {
  const result = await writer.write(item);
  if (!result.ok) {
    // Handle error (closed, aborted, or store error)
    break;
  }
}
```

## Error Handling

All stream operations return Results:

```typescript
import { isStreamEnded, isStreamWriteError } from 'awaitly/streaming';

// Writing
const writeResult = await writer.write('data');
if (!writeResult.ok) {
  if (isStreamWriteError(writeResult.error)) {
    switch (writeResult.error.reason) {
      case 'closed':
        console.log('Stream already closed');
        break;
      case 'aborted':
        console.log('Stream was aborted');
        break;
      case 'store_error':
        console.log('Storage failed:', writeResult.error.cause);
        break;
    }
  }
}

// Reading
const readResult = await reader.read();
if (!readResult.ok) {
  if (isStreamEnded(readResult.error)) {
    console.log('Stream complete at position', readResult.error.finalPosition);
  }
}
```

### Aborting a Stream

```typescript
const writer = step.getWritable<string>({ namespace: 'response' });

try {
  await generateContent(writer);
} catch (error) {
  writer.abort(error); // Signal error to readers
}
```

## Multiple Namespaces

Use namespaces to have multiple streams per workflow:

```typescript
const result = await workflow(async (step) => {
  const tokenWriter = step.getWritable<string>({ namespace: 'tokens' });
  const progressWriter = step.getWritable<number>({ namespace: 'progress' });

  await tokenWriter.write('Starting...');
  await progressWriter.write(0);

  // ... do work ...

  await progressWriter.write(100);
  await tokenWriter.write('Done!');

  await tokenWriter.close();
  await progressWriter.close();
});
```

## Workflow Events

Stream operations emit events for observability:

```typescript
const workflow = createWorkflow(deps, {
  streamStore,
  onEvent: (event) => {
    switch (event.type) {
      case 'stream_created':
        console.log(`Stream ${event.namespace} created`);
        break;
      case 'stream_write':
        console.log(`Wrote to ${event.namespace} at position ${event.position}`);
        break;
      case 'stream_close':
        console.log(`Stream ${event.namespace} closed at position ${event.finalPosition}`);
        break;
      case 'stream_error':
        console.log(`Stream ${event.namespace} error:`, event.error);
        break;
    }
  },
});
```

## API Reference

### Imports

```typescript
// Workflow integration
import { createWorkflow } from 'awaitly/workflow';

// Stream stores and utilities
import {
  // Stores
  createMemoryStreamStore,
  createFileStreamStore,

  // External reader
  getStreamReader,

  // Transformers
  toAsyncIterable,
  map,
  mapAsync,
  filter,
  flatMap,
  flatMapAsync,
  chunk,
  take,
  skip,
  takeWhile,
  skipWhile,
  collect,
  reduce,
  pipe,

  // Type guards
  isStreamEnded,
  isStreamWriteError,
  isStreamReadError,
  isStreamStoreError,

  // Error constructors (for testing)
  streamWriteError,
  streamReadError,
  streamEnded,
} from 'awaitly/streaming';
```

### Step Methods

| Method | Description |
|--------|-------------|
| `step.getWritable<T>(options?)` | Create a stream writer |
| `step.getReadable<T>(options?)` | Create a stream reader |
| `step.streamForEach(source, fn, options?)` | Batch process with concurrency |

### StreamWriter

| Property/Method | Description |
|----------------|-------------|
| `write(value)` | Write item, returns `AsyncResult<void, StreamWriteError>` |
| `close()` | Close stream, returns `AsyncResult<void, StreamCloseError>` |
| `abort(reason)` | Abort with error |
| `writable` | Whether stream accepts writes |
| `position` | Number of items written |
| `namespace` | Stream namespace |

### StreamReader

| Property/Method | Description |
|----------------|-------------|
| `read()` | Read next item, returns `AsyncResult<T, StreamReadError \| StreamEndedMarker>` |
| `close()` | Stop reading |
| `readable` | Whether more data may be available |
| `position` | Current read position |
| `namespace` | Stream namespace |

## Next

- [Batch Processing →](/guides/batch-processing/) - Process items in bulk
- [Persistence →](/guides/persistence/) - Save workflow state for resume
