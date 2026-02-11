---
title: Documenting Workflows
description: Use description and markdown options for static analysis and doc generation
---

Workflow-level and step-level `description` and `markdown` are the **supported way** to document workflows for:

- **Static analysis** — [awaitly-analyze](/docs/guides/static-analysis/) reads these fields when analyzing workflow source.
- **Generated diagrams and docs** — Mermaid diagrams and doc generators can use them for labels and content.
- **Future tooling** — IDE tooltips or other tooling may surface them.

**Step names:** Step IDs are required. Use **`step('id', fn, opts)`**; the string literal first argument is the step ID used in diagrams, events, caching, and generated docs.

JSDoc comments above workflow or step declarations are **also** extracted by the analyzer and exposed as `jsdocDescription` on the root and step nodes. Option-based `description` and `markdown` remain the canonical fields for display; use them for curated docs and `jsdocDescription` as a fallback (e.g. `description ?? jsdocDescription`). Only the main description (text before the first `@tag`) is extracted; `@param` / `@returns` are not parsed into separate fields.

## Workflow-level documentation

Set `description` and `markdown` when creating the workflow (in the options object or on the deps object). They apply to `createWorkflow` and `createSagaWorkflow` only; `run()` and `runSaga()` have no options object, so they do not support workflow-level docs. For **class-based workflows** (extending `Workflow` from `awaitly/workflow`), pass the same options (including `description`, `markdown`) to the **constructor** as the third argument: `new MyWorkflow('name', deps, { description: '...', markdown: '...' })`. JSDoc above the class is also extracted as `jsdocDescription` when present.

```typescript
import { createWorkflow } from 'awaitly/workflow';

const checkoutWorkflow = createWorkflow('workflow', deps, {
  description: 'Checkout workflow - handles orders and payments',
  markdown: '## Checkout\n\n1. Validate cart\n2. Process payment\n3. Send confirmation',
});

// Or on the deps object when it's the only config
const simpleWorkflow = createWorkflow('workflow', { ...deps,
  description: 'Simple order flow',
  markdown: '# Order Flow',
});
```

## Step-level documentation

Use **`step('id', fn, opts)`** so statically generated docs get a stable step ID, and set `description` and `markdown` in the options object. Same for `step.sleep` and saga steps:

```typescript
// Regular step — named form for static doc generation
await step('getUser', () => deps.fetchUser(id), {
  key: 'user',
  description: 'Load user by ID',
  markdown: 'Calls `deps.fetchUser` with the given id.',
});

// step.sleep
await step.sleep('wait', '5s', {
  description: 'Wait for processing',
  markdown: 'Pauses execution before the next step.',
});

// Saga step
await saga.step('createOrder', () => deps.createOrder(args), {
  description: 'Creates the order record',
  markdown: 'Persists order to the database.',
  compensate: () => deps.cancelOrder(),
});
```

The string literal first argument (`'getUser'`, `'createOrder'`) is what appears in generated step lists and diagrams; `description` and `markdown` add human-readable docs.

## Options reference

For a full list of workflow, step, and saga step options (including `description` and `markdown`), see the [Options reference](/docs/reference/api/#options-reference) in the API reference.
