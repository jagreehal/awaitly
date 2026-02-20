---
'awaitly-visualizer': minor
'awaitly-postgres': minor
'awaitly-analyze': minor
'awaitly-libsql': minor
'awaitly-mongo': minor
'awaitly': minor
'awaitly-docs': minor
'eslint-plugin-awaitly': minor
---

Refactor workflow API: spec-driven `workflow.run` with call-time dependency injection

- **awaitly**: Replaces `createWorkflow(name, deps, opts)` with a spec-driven API using `Step<F>()` tokens and call-time dependency injection. Adds `workflow.run()` and related types; introduces serialize-resume-state and store-contract for durable execution.
- **awaitly-analyze**: Static analyzer and fixtures updated for the new workflow API and step signatures.
- **awaitly-visualizer**: Decision tracker, devtools, event capture, and examples updated for the new workflow shape.
- **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: Persistence adapters updated for new workflow types and run API.
- **awaitly-docs**: Documentation and guides updated across foundations, comparison, guides, and reference to describe the new workflow API and migration.
