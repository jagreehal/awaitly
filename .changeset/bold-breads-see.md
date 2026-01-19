---
'awaitly': minor
---

Split workflow functionality into separate entry point (`awaitly/workflow`) for better tree-shaking and bundle size optimization. The main `awaitly` package now only exports core Result types, while workflow orchestration features (`createWorkflow`, `run`, `Duration`, `createStepCollector`, etc.) are available via `awaitly/workflow`. This allows users who only need Result types to import a smaller bundle (~3 KB gzipped) without the workflow engine overhead.

**Migration:** Update imports from `awaitly` to `awaitly/workflow` for workflow-related functionality:

```typescript
// Before
import { createWorkflow, run } from 'awaitly';

// After
import { createWorkflow, run } from 'awaitly/workflow';
```

Core Result types (`ok`, `err`, `map`, `andThen`, etc.) remain available from the main `awaitly` entry point.
