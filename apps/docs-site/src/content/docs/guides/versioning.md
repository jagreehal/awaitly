---
title: Workflow Versioning
description: Migrate persisted workflow state across versions
---

Handle schema changes when resuming workflows that were persisted with older step shapes.

## The problem

When you persist workflow state (for resume/replay), changing your workflow code can break compatibility with saved state:

```typescript
// Version 1: Step key was 'user:fetch'
const workflowV1 = createWorkflow('workflow', { fetchUser }, {
  resumeState: savedState // Contains 'user:fetch'
});

// Version 2: You renamed the step key to 'user:load'
const workflowV2 = createWorkflow('workflow', { fetchUser }, {
  resumeState: savedState // ❌ Key mismatch!
});
```

## Solution: Versioned workflows

Use versioning to migrate old state to new formats:

```typescript
import {
  createVersionedStateLoader,
  createVersionedState,
  createKeyRenameMigration,
  type VersionedState
} from 'awaitly/persistence';

// Define migrations
const migrations = {
  1: createKeyRenameMigration({
    'user:fetch': 'user:load',
    'order:create': 'order:submit',
  }),
  2: createKeyRemoveMigration(['deprecated:step']),
};

// Create versioned loader
const loadVersionedState = createVersionedStateLoader({
  version: 2, // Current version
  migrations,
});

// Load and migrate state
const savedState = await db.loadWorkflowState(workflowId);
const versionedState = parseVersionedState(savedState);
const migratedState = await loadVersionedState(versionedState);

if (migratedState.ok) {
  const workflow = createWorkflow('workflow', deps, {
    resumeState: migratedState.value,
  });
  // ...
}
```

## Saving versioned state

Always save state with version information:

```typescript
import { createResumeStateCollector } from 'awaitly/workflow';
import { createVersionedState, stringifyVersionedState } from 'awaitly/persistence';

const collector = createResumeStateCollector();
const workflow = createWorkflow('workflow', deps, {
  onEvent: collector.handleEvent,
});

await workflow.run(async ({ step, deps }) => {
  // ...
});

// Save with version
const state = collector.getResumeState();
const versionedState = createVersionedState(state, 2); // Current version
const json = stringifyVersionedState(versionedState);
await db.saveWorkflowState(workflowId, json);
```

## Migration helpers

### Rename step keys

```typescript
import { createKeyRenameMigration } from 'awaitly/persistence';

const migrations = {
  1: createKeyRenameMigration({
    'old:key': 'new:key',
    'user:fetch': 'user:load',
  }),
};
```

### Remove step keys

```typescript
import { createKeyRemoveMigration } from 'awaitly/persistence';

const migrations = {
  1: createKeyRemoveMigration([
    'deprecated:step',
    'old:cache',
  ]),
};
```

### Transform step values

```typescript
import { createValueTransformMigration } from 'awaitly/persistence';
import { ok } from 'awaitly';

const migrations = {
  1: createValueTransformMigration({
    'user:fetch': (entry) => ({
      ...entry,
      result: entry.result.ok
        ? ok({
            ...entry.result.value,
            newField: 'default', // Add new required field
          })
        : entry.result,
    }),
  }),
};
```

### Compose multiple migrations

```typescript
import { composeMigrations } from 'awaitly/persistence';

const migrations = {
  1: composeMigrations([
    createKeyRenameMigration({ 'old': 'new' }),
    createKeyRemoveMigration(['deprecated']),
    createValueTransformMigration({
      'user:fetch': (entry) => ({ ...entry, /* transform */ }),
    }),
  ]),
};
```

## Complete example

```typescript
import { ok } from 'awaitly';
import { createWorkflow, createResumeStateCollector } from 'awaitly/workflow';
import {
  createVersionedStateLoader,
  createVersionedState,
  parseVersionedState,
  stringifyVersionedState,
  createKeyRenameMigration,
  createValueTransformMigration,
} from 'awaitly/persistence';

// Current workflow version
const CURRENT_VERSION = 2;

// Define migrations
const migrations = {
  // Migration from v1 to v2
  1: createKeyRenameMigration({
    'user:fetch': 'user:load',
    'order:create': 'order:submit',
  }),
  // Migration from v2 to v3 (future)
  2: createValueTransformMigration({
    'user:load': (entry) => ({
      ...entry,
      result: entry.result.ok
        ? ok({
            ...entry.result.value,
            emailVerified: false, // New required field
          })
        : entry.result,
    }),
  }),
};

// Create versioned loader
const loadVersionedState = createVersionedStateLoader({
  version: CURRENT_VERSION,
  migrations,
  strictVersioning: true, // Fail if state is from future version
});

// Load workflow state
async function loadWorkflowState(workflowId: string) {
  const saved = await db.loadWorkflowState(workflowId);
  if (!saved) return undefined;

  const versionedState = parseVersionedState(saved);
  if (!versionedState) {
    throw new Error('Invalid state format');
  }

  const migrated = await loadVersionedState(versionedState);
  if (!migrated.ok) {
    throw new Error(`Migration failed: ${migrated.error.type}`);
  }

  return migrated.value;
}

// Save workflow state
async function saveWorkflowState(workflowId: string, state: ResumeState) {
  const versionedState = createVersionedState(state, CURRENT_VERSION);
  const json = stringifyVersionedState(versionedState);
  await db.saveWorkflowState(workflowId, json);
}

// Use in workflow
const workflow = createWorkflow('workflow', deps, {
  resumeState: await loadWorkflowState(workflowId),
  onEvent: (event) => {
    // Collect state for saving
    collector.handleEvent(event);
  },
});

const collector = createResumeStateCollector();
const result = await workflow.run(async ({ step, deps }) => {
  // ...
});

// Save state after execution
await saveWorkflowState(workflowId, collector.getResumeState());
```

## Error handling

### Migration errors

```typescript
import { isMigrationError } from 'awaitly/persistence';

const migrated = await loadVersionedState(versionedState);

if (!migrated.ok) {
  if (isMigrationError(migrated.error)) {
    console.error(`Migration from ${migrated.error.fromVersion} to ${migrated.error.toVersion} failed:`, migrated.error.cause);
  }
}
```

### Version incompatibility

```typescript
import { isVersionIncompatibleError } from 'awaitly/persistence';

if (!migrated.ok && isVersionIncompatibleError(migrated.error)) {
  console.error(
    `State version ${migrated.error.stateVersion} is incompatible with current version ${migrated.error.currentVersion}: ${migrated.error.reason}`
  );
}
```

## Strict versioning

By default, versioning is strict - it fails if state is from a future version:

```typescript
const loader = createVersionedStateLoader({
  version: 2,
  migrations: { 1: migrateV1ToV2 },
  strictVersioning: true, // Default: true
});

// If state is version 3 and current is 2, this fails
const migrated = await loader({ version: 3, state: ... });
// Error: "State version is higher than current workflow version"
```

Set `strictVersioning: false` to allow future versions (not recommended):

```typescript
const loader = createVersionedStateLoader({
  version: 2,
  migrations: { 1: migrateV1ToV2 },
  strictVersioning: false, // Allow future versions
});
```

## Best practices

1. **Always version your state**: Save state with version information
2. **Test migrations**: Write tests for each migration path
3. **Incremental migrations**: Migrate one version at a time
4. **Backward compatibility**: Keep old step keys in migrations for a few versions
5. **Document changes**: Keep a changelog of state schema changes

## Next

[Learn about Persistence →](/guides/persistence/)
