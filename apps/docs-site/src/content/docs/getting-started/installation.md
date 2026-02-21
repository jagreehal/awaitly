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

Import from the main entry point. For **minimal bundle** use `awaitly/result` (Result types only, named exports). For **best DX** (including the Awaitly namespace and functional utilities) use `awaitly`. You can use **named exports** (tree-shake friendly) or the **Awaitly** namespace:

```typescript
// Named exports (recommended for tree-shaking)
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';

// Awaitly namespace (Effect-style: one object with ok, err, pipe, map, etc.)
import { Awaitly } from 'awaitly';
Awaitly.ok(1);
Awaitly.err('E');
Awaitly.pipe(value, fn1, fn2);
```

Or use tree-shakable subpaths for smaller bundles:

```typescript
// Minimal: Result types only (smallest)
import { ok, err, map, andThen, type AsyncResult } from 'awaitly/result';

// Full package: named exports
import { ok, err, map, andThen } from 'awaitly';

// run() for workflow composition
import { run } from 'awaitly/run';

// Workflow orchestration
import { createWorkflow } from 'awaitly/workflow';

// Visualization (separate package)
// npm install awaitly-visualizer
import { createVisualizer } from 'awaitly-visualizer';

// Batch processing (~2KB gzipped)
import { processInBatches } from 'awaitly/batch';

// Resource management (~1KB gzipped)
import { withScope, createResource } from 'awaitly/resource';
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
