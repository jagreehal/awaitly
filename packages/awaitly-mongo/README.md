# awaitly-mongo

MongoDB persistence adapter for [awaitly](https://github.com/jagreehal/awaitly) workflows.

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
import { createMongoPersistence } from 'awaitly-mongo';
import { durable } from 'awaitly/durable';

const store = await createMongoPersistence({
  connectionString: process.env.MONGODB_URI,
});

const result = await durable.run(
  { fetchUser, createOrder },
  async (step, { fetchUser, createOrder }) => {
    const user = await step(() => fetchUser('123'), { key: 'fetch-user' });
    const order = await step(() => createOrder(user), { key: 'create-order' });
    return order;
  },
  {
    id: 'checkout-123',
    store,
  }
);
```

## Configuration

### Connection String

```typescript
const store = await createMongoPersistence({
  connectionString: 'mongodb://localhost:27017',
});
```

### With Database and Collection Names

```typescript
const store = await createMongoPersistence({
  connectionString: process.env.MONGODB_URI,
  database: 'myapp',
  collection: 'custom_workflow_state', // optional, default: 'workflow_state'
  prefix: 'myapp:workflow:', // optional, default: 'workflow:state:'
});
```

### Using Existing Client

```typescript
import { MongoClient } from 'mongodb';
import { createMongoPersistence } from 'awaitly-mongo';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();

const store = await createMongoPersistence({
  existingClient: client,
  database: 'myapp',
});
```

### Using Existing Database

```typescript
import { MongoClient } from 'mongodb';
import { createMongoPersistence } from 'awaitly-mongo';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('myapp');

const store = await createMongoPersistence({
  existingDb: db,
  collection: 'workflow_state',
});
```

### Client Options

```typescript
const store = await createMongoPersistence({
  connectionString: process.env.MONGODB_URI,
  clientOptions: {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  },
});
```

## Collection Schema

The adapter automatically creates a collection with the following document structure:

```typescript
{
  _id: string,        // The key
  value: string,       // The serialized state value
  expiresAt?: Date     // Optional expiration date (for TTL)
}
```

A TTL index is automatically created on the `expiresAt` field, which MongoDB uses to automatically delete expired documents.

The collection is created automatically on first use. You can customize the collection name via the `collection` option.

## Features

- ✅ Automatic collection creation
- ✅ TTL support (automatic expiration via MongoDB TTL index)
- ✅ Connection reuse (can share existing client/database)
- ✅ Pattern matching for key queries
- ✅ Zero configuration required

## Requirements

- Node.js >= 22
- MongoDB >= 4.2 (for TTL index support)
- `mongodb` package (peer dependency)

## License

MIT
