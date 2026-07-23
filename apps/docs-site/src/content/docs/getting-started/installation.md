---
title: Installation
description: Install awaitly and set up your project
---

## Install the package

```bash
npm install awaitly
```

Or with your preferred package manager:

```bash
pnpm add awaitly
yarn add awaitly
```

## TypeScript configuration

The library requires TypeScript 4.7 or later. Enable strict mode for best results:

```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

## Import paths

awaitly uses task-shaped entry points, all with named exports:

```typescript
// The front door: Result primitives, run(), policies, errors, matching
import { ok, err, run, type AsyncResult } from 'awaitly';

// Minimal: Result types only (smallest bundle)
import { ok, err, map, andThen, type AsyncResult } from 'awaitly/result';

// Focused composition and reliability entries
import { run } from 'awaitly/run';
import { retry, createCircuitBreaker } from 'awaitly/reliability';

// Workflow composition, batching, and resources
import { createWorkflow, processInBatches, withScope, createResource } from 'awaitly/workflow';

// Load production capabilities independently
import { durable } from 'awaitly/durable';
import { type SnapshotStore } from 'awaitly/persistence';
import { createSagaWorkflow } from 'awaitly/saga';
import { createApprovalStep } from 'awaitly/hitl';
import { createMemoryStreamStore } from 'awaitly/streaming';
import { createWebhookHandler } from 'awaitly/webhook';
import { createEngine } from 'awaitly/engine';

// Test utilities
import { createWorkflowHarness } from 'awaitly/testing';
```

Related packages install separately:

```typescript
// Visualization (separate package)
// npm install awaitly-visualizer
import { createVisualizer } from 'awaitly-visualizer';
```

## Browser support

awaitly is fully platform-agnostic and works identically in Node.js and browser environments. No special configuration is needed - the same code runs everywhere.

```typescript
// Works in both Node.js and browser
import { ok, err } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';
```

For visualization in browsers, use the **`awaitly-visualizer`** package; it has browser-specific exports that exclude Node-only features like live terminal output:

```typescript
// awaitly-visualizer has browser-specific exports for createVisualizer, etc.
import { createVisualizer } from 'awaitly-visualizer';

const viz = createVisualizer({ workflowName: 'checkout' });
```

## Verify installation

Create a file and run it to verify everything works:

```typescript
// test.ts
import { ok, err, type AsyncResult } from 'awaitly';

const divide = (a: number, b: number): AsyncResult<number, 'DIVIDE_BY_ZERO'> =>
  b === 0 ? err('DIVIDE_BY_ZERO') : ok(a / b);

const result = await divide(10, 2);

if (result.ok) {
  console.log('Result:', result.value); // Result: 5
} else {
  console.log('Error:', result.error);
}
```

```bash
npx tsx test.ts
```

## Next

[Learn the basics →](/getting-started/basics/)
