---
"eslint-plugin-awaitly": minor
"awaitly-visualizer": minor
"awaitly-analyze": minor
"example-nextjs": minor
"browser-test": minor
"awaitly": minor
"awaitly-docs": minor
---

- **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
- **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
- **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.
