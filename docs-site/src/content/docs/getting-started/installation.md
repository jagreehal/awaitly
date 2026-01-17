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

Import from the main entry point:

```typescript
import { createWorkflow, ok, err, type AsyncResult } from 'awaitly';
```

Or use tree-shakable imports for smaller bundles:

```typescript
// Core Result types only (~3KB)
import { ok, err, map, andThen } from 'awaitly/core';

// Workflow features (~8KB)
import { createWorkflow, run } from 'awaitly/workflow';

// Visualization (~5KB)
import { createVisualizer } from 'awaitly/visualize';

// Batch processing (~2KB)
import { processInBatches } from 'awaitly/batch';

// Resource management (~1KB)
import { withScope, createResource } from 'awaitly/resource';
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

[Build your first workflow →](/workflow/getting-started/first-workflow/)
