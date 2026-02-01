---
title: Documenting Workflows
description: Use description and markdown options for static analysis and doc generation
---

Workflow-level and step-level `description` and `markdown` are the **supported way** to document workflows for:

- **Static analysis** — [awaitly-analyze](/docs/guides/static-analysis/) reads these fields when analyzing workflow source.
- **Generated diagrams and docs** — Mermaid diagrams and doc generators can use them for labels and content.
- **Future tooling** — IDE tooltips or other tooling may surface them.

JSDoc comments above workflow or step declarations are **also** extracted by the analyzer and exposed as `jsdocDescription` on the root and step nodes. Option-based `description` and `markdown` remain the canonical fields for display; use them for curated docs and `jsdocDescription` as a fallback (e.g. `description ?? jsdocDescription`). Only the main description (text before the first `@tag`) is extracted; `@param` / `@returns` are not parsed into separate fields.

## Workflow-level documentation

Set `description` and `markdown` when creating the workflow (in the options object or on the deps object). They apply to `createWorkflow` and `createSagaWorkflow` only; `run()` and `runSaga()` have no options object, so they do not support workflow-level docs.

```typescript
import { createWorkflow } from 'awaitly/workflow';

const checkoutWorkflow = createWorkflow(deps, {
  description: 'Checkout workflow - handles orders and payments',
  markdown: '## Checkout\n\n1. Validate cart\n2. Process payment\n3. Send confirmation',
});

// Or on the deps object when it's the only config
const simpleWorkflow = createWorkflow({
  ...deps,
  description: 'Simple order flow',
  markdown: '# Order Flow',
});
```

## Step-level documentation

Set `description` and `markdown` in the step options object for regular steps, `step.sleep`, and saga steps:

```typescript
// Regular step
await step(() => deps.fetchUser(id), {
  key: 'user',
  description: 'Load user by ID',
  markdown: 'Calls `deps.fetchUser` with the given id.',
});

// step.sleep
await step.sleep('5s', {
  description: 'Wait for processing',
  markdown: 'Pauses execution before the next step.',
});

// Saga step
await saga.step(() => deps.createOrder(args), {
  name: 'Create Order',
  description: 'Creates the order record',
  markdown: 'Persists order to the database.',
  compensate: () => deps.cancelOrder(),
});
```

## Options reference

For a full list of workflow, step, and saga step options (including `description` and `markdown`), see the [Options reference](/docs/reference/api/#options-reference) in the API reference.
