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

There are four, and most code only ever needs the first:

| Import | What's in it |
|---|---|
| `awaitly` | Results, `run`, `createWorkflow`, policies, control flow, errors, matching |
| `awaitly/result` | Result primitives only — a guaranteed sub-10KB entry, no tree-shaking required |
| `awaitly/durable` | Production machinery: durable execution, persistence, saga, approvals, streaming, webhooks, engine |
| `awaitly/testing` | Test harness, kept out of production bundles |

```typescript
// The front door — this is what you want almost always
import {
  ok, err, run, createWorkflow,
  retry, timeout, fallback,
  type AsyncResult,
} from 'awaitly';

// Serverless / size-critical: Result types with a hard size guarantee
import { ok, err, map, andThen, type AsyncResult } from 'awaitly/result';

// Work that outlives a single process
import { durable, createSagaWorkflow, createApprovalStep } from 'awaitly/durable';

// Tests
import { createWorkflowHarness } from 'awaitly/testing';
```

Importing `createWorkflow` from the root does **not** tax consumers who only use Result
primitives — a build that imports just `ok`/`err` from `awaitly` still ships under 5KB.
Reach for `awaitly/result` when you want that size without relying on your bundler's
tree-shaking at all.

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
import { ok, err, createWorkflow } from 'awaitly';
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

const divide = async (a: number, b: number): AsyncResult<number, 'DIVIDE_BY_ZERO'> =>
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

[Learn the basics →](getting-started/basics/)
