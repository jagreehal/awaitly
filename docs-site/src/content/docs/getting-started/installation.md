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
import { ok, err, type AsyncResult } from 'awaitly';
import { createWorkflow } from 'awaitly/workflow';
```

Or use tree-shakable imports for smaller bundles:

```typescript
// Result types + run (~5KB)
import { ok, err, run, map, andThen } from 'awaitly';

// Workflow orchestration
import { createWorkflow } from 'awaitly/workflow';

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
