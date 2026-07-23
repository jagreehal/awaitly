# awaitly-mongo

MongoDB persistence adapter for [awaitly](https://github.com/jagreehal/awaitly) workflows.

Provides a ready-to-use snapshot store backed by MongoDB. The store accepts both workflow snapshots and resume state, so it plugs straight into `durable.run` and `createWorkflow`.

## Installation

```bash
npm install awaitly-mongo mongodb
# or
pnpm add awaitly-mongo mongodb
# or
yarn add awaitly-mongo mongodb
```

## Quick Start

```typescript
import { mongo } from 'awaitly-mongo';
import { durable } from 'awaitly/durable';

const store = mongo(process.env.MONGODB_URI!);

const result = await durable.run(
  { fetchUser, createOrder },
  async ({ step, deps: { fetchUser, createOrder } }) => {
    const user = await step('fetch-user', () => fetchUser('123'));
    const order = await step('create-order', () => createOrder(user));
    return order;
  },
  {
    id: 'checkout-123',
    store,
  }
);
```

## Configuration

### Connection URL

```typescript
const store = mongo('mongodb://localhost:27017');
```

### Options

```typescript
const store = mongo({
  url: process.env.MONGODB_URI!,
  database: 'myapp', // optional, default: 'awaitly'
  collection: 'my_workflow_snapshots', // optional, default: 'awaitly_snapshots'
  prefix: 'orders:', // optional ID prefix, default: ''
});
```

### Using an Existing Client

```typescript
import { MongoClient } from 'mongodb';
import { mongo } from 'awaitly-mongo';

const client = new MongoClient(process.env.MONGODB_URI!);

const store = mongo({
  url: process.env.MONGODB_URI!,
  client,
  database: 'myapp',
});
```

### Client Options

```typescript
const store = mongo({
  url: process.env.MONGODB_URI!,
  clientOptions: {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  },
});
```

### Cross-Process Locking

To ensure only one process runs a given workflow ID at a time, pass the `lock` option. The store then implements `WorkflowLock`, and `durable.run` acquires the lock before running (unless `allowConcurrent: true`) and releases it when done:

```typescript
const store = mongo({
  url: process.env.MONGODB_URI!,
  lock: { lockCollectionName: 'workflow_lock' }, // optional; default collection name
});
```

## Using with createWorkflow

The store also works directly with workflow resume state:

```typescript
import { mongo } from 'awaitly-mongo';
import { createWorkflow } from 'awaitly/workflow';

const store = mongo('mongodb://localhost:27017/mydb');
const workflow = createWorkflow(deps);

// Run and persist resume state
const { result, resumeState } = await workflow.runWithState(fn);
await store.save('wf-123', resumeState);

// Restore later
const saved = await store.loadResumeState('wf-123');
if (saved) await workflow.run(fn, { resumeState: saved });
```

## Store API

```typescript
store.save(id, state); // WorkflowSnapshot or ResumeState
store.load(id); // returns whichever was stored
store.loadResumeState(id); // ResumeState | null
store.delete(id);
store.list({ prefix, limit }); // [{ id, updatedAt }]
store.close();
```

## Document Shape

Snapshots are stored as documents in the configured collection:

```typescript
{
  _id: string,       // the (prefixed) workflow ID
  snapshot: object,  // the workflow snapshot or serialized resume state
  updatedAt: Date
}
```

The collection is created automatically on first use. You can customize the collection name via the `collection` option.

## Features

- ✅ Automatic collection creation
- ✅ Stores workflow snapshots and resume state
- ✅ Optional cross-process locking (`WorkflowLock`)
- ✅ Connection reuse (bring your own `MongoClient`)
- ✅ Zero configuration required

## Requirements

- Node.js >= 22
- MongoDB >= 4.2
- `mongodb` package (peer dependency)

## License

MIT
