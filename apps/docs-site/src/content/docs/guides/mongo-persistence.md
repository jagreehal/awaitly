---
title: MongoDB Persistence
description: Use MongoDB as a persistence backend for awaitly workflows
---

The [`awaitly-mongo`](https://www.npmjs.com/package/awaitly-mongo) package provides a ready-to-use MongoDB persistence adapter for awaitly workflows. Provide your connection string and you're ready to go.

**Source code**: [GitHub](https://github.com/jagreehal/awaitly/tree/main/packages/awaitly-mongo)

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

If you already have a MongoDB client, you can reuse it:

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

You can also provide an existing database instance:

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

Customize MongoDB client settings:

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

- ✅ **Automatic collection creation** - No manual setup required
- ✅ **TTL support** - Automatic expiration via MongoDB TTL index
- ✅ **Connection reuse** - Share existing client/database instances
- ✅ **Pattern matching** - Query keys using glob patterns
- ✅ **Zero configuration** - Works out of the box

## Advanced Usage

### Direct KeyValueStore Access

If you need more control, you can use the `MongoKeyValueStore` class directly:

```typescript
import { MongoKeyValueStore } from 'awaitly-mongo';
import { createStatePersistence } from 'awaitly/persistence';

const store = new MongoKeyValueStore({
  connectionString: process.env.MONGODB_URI,
});

const persistence = createStatePersistence(store, 'custom:prefix:');
```

## Implementation Details

The [`awaitly-mongo`](https://www.npmjs.com/package/awaitly-mongo) package is a reference implementation of the `KeyValueStore` interface. Here's how it works:

### KeyValueStore Implementation

The `MongoKeyValueStore` class implements all five required methods:

- **`get(key)`**: Uses `findOne` with expiration filter
- **`set(key, value, {ttl})`**: Uses `updateOne` with `upsert: true`
- **`delete(key)`**: Standard `deleteOne` operation
- **`exists(key)`**: Uses `countDocuments` for efficient existence check
- **`keys(pattern)`**: Converts glob patterns (`*`) to MongoDB regex queries

### Automatic Collection and Index Creation

The adapter creates the collection and TTL index on first use:

```javascript
// Create TTL index for automatic expiration
await collection.createIndex(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0, // Delete immediately when expiresAt is reached
    name: 'expiresAt_ttl',
  }
);
```

### Pattern Matching

Glob patterns are converted to MongoDB regex:

```typescript
// User pattern: "workflow:state:*"
// MongoDB regex: /^workflow:state:.*$/
const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
```

### Connection Management

Supports three connection modes:

1. **New client**: Creates and manages its own `MongoClient`
2. **Existing client**: Reuses a provided `MongoClient`
3. **Existing database**: Uses a provided `Db` instance

This flexibility allows integration with existing MongoDB setups.

## Production Considerations

### Connection Pooling

MongoDB handles connection pooling automatically. Configure pool size via client options:

```typescript
const store = await createMongoPersistence({
  connectionString: process.env.MONGODB_URI,
  clientOptions: {
    maxPoolSize: 50,
    minPoolSize: 5,
    maxIdleTimeMS: 30000,
  },
});
```

### TTL Index

The TTL index automatically deletes expired documents. MongoDB runs a background task every 60 seconds to remove expired documents. This means:

- Documents may persist slightly longer than their expiration time
- The cleanup is eventually consistent
- No manual cleanup is required

### Monitoring

Monitor collection size and performance:

```javascript
// Check collection stats
const stats = await db.collection('workflow_state').stats();

// Check index usage
const indexes = await db.collection('workflow_state').indexes();
```

### Sharding

For large-scale deployments, consider sharding the collection:

```javascript
// Enable sharding on the database
sh.enableSharding('myapp');

// Shard the collection by _id
sh.shardCollection('myapp.workflow_state', { _id: 'hashed' });
```

## Requirements

- Node.js >= 22
- MongoDB >= 4.2 (for TTL index support)
- `mongodb` package

## Next

[Learn about PostgreSQL persistence →](./postgres-persistence/)
