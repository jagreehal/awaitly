---
"awaitly": minor
"awaitly-postgres": minor
"awaitly-libsql": patch
"awaitly-mongo": patch
"awaitly-visualizer": patch
---

One shared conformance suite for every durable store, and the operational
options that come with it.

`awaitly/testing` exports `durableStoreContract`, framework-agnostic checks
covering snapshot round-trip, upsert, delete, prefix and limit listing, and the
full `WorkflowLock` lease cycle. All three shipped adapters run it, so they
agree on one definition of correct:

```typescript
import { durableStoreContract, supportsLock } from 'awaitly/testing';

for (const check of durableStoreContract) {
  it(check.name, async (context) => {
    if (check.requires === 'lock' && !supportsLock(store)) return context.skip();
    await check.run(store);
  });
}
```

`createMemorySnapshotStore` is exported from `awaitly/durable`. It is the store
`durable.run` already falls back to, and it now runs the same contract as the
database adapters:

```typescript
import { createMemorySnapshotStore } from 'awaitly/durable';

const store = createMemorySnapshotStore();
await durable.run(deps, fn, { id: 'batch-1', store });
```

**awaitly-postgres** reports background errors on idle connections through a new
`onPoolError` option, so workers stay available while connections recover.
Schema setup is serialized across concurrent workers with an advisory lock, and
the package ships its own PostgreSQL type declarations.

**awaitly-libsql** lets independent processes share one local file, waiting for
SQLite's writer lock before snapshot and lease operations. A lease that has
expired is reclaimed by the next worker.

**awaitly-mongo** confirms lease renewal by owner token, so a heartbeat holds
ownership through renewals that land on the same millisecond.

**awaitly-visualizer** keeps the optional Slack SDK external, so the published
Slack notifier loads in ESM.

`step.withResource`'s documentation now matches its behaviour: under
`createWorkflow` and `durable.run` the step is keyed by its id like any other,
a resumed run restores the value `use` returned, and `acquire` and `release`
run only on the attempt that does the work.
