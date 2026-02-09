# awaitly-analyze

## 0.12.0

### Minor Changes

- dceec3d: - **awaitly**: Add workflow hook primitive. Suspend a workflow until your app receives an HTTP callback, then resume with the callback payload using `injectHook()`. New exports: `pendingHook`, `createHook`, `injectHook`, `isPendingHook`, `hasPendingHook`, `getPendingHooks`, and the `PendingHook` type. Server-agnostic: you own the callback URL and call `injectHook(state, { hookId, value })` when the request arrives.
  - **awaitly-analyze**: Static analyzer and test updates.

### Patch Changes

- Updated dependencies [dceec3d]
  - awaitly@1.20.0
  - awaitly-visualizer@9.0.0

## 0.11.0

### Minor Changes

- 69c2fa8: - **awaitly-analyze**: Static analyzer enhancements (path generation, complexity metrics, Mermaid output), kitchen-sink fixtures, and fixture tsconfig for type-checking test sources.
  - **awaitly-docs**: Astro and content config updates for docs site.

## 0.10.1

### Patch Changes

- 226b841: Publish awaitly-analyze as a public package (remove private flag).

## 0.10.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

### Patch Changes

- Updated dependencies [34022b8]
  - awaitly-visualizer@8.0.0
  - awaitly@1.19.0

## 0.9.0

### Minor Changes

- 6119f95: Saga step names: require a string name as the first argument to `saga.step()` and `saga.tryStep()` for observability and compensation tracking. Runtime validation rejects empty or non-string names with clear errors. ESLint rule `require-step-id` and static analyzer updated to enforce and analyze step names.

## 0.8.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

## 0.7.0

### Minor Changes

- d4cd1ac: Add example-nextjs verification playground: Next.js App Router app that proves the framework-integration docs using awaitly workflows, Drizzle (libsql/SQLite), and TanStack Query. Includes Server Action signup, API route signup, and Get user (React Query + ResultError) with typed error handling. README updated with setup, run, and layout.

## 0.6.0

### Minor Changes

- 1830163: **Step IDs for workflows and steps**

  - **awaitly**: Workflow execution and snapshots now use explicit step IDs. Steps and helpers (`step()`, `step.sleep()`, `step.retry()`, `step.withTimeout()`, `step.try()`, `step.fromResult()`) accept an optional string literal as the first argument for durable execution, resumption, and observability.
  - **eslint-plugin-awaitly**: New rule `require-step-id` enforces that all step calls use a string literal step ID as the first argument.
  - **awaitly-analyze**: Static workflow IR and analyzer updated to support step IDs.
  - **awaitly-visualizer**: IR builder updated for step ID support.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: README and docs updated for step IDs.
  - **awaitly-docs**: Documentation updated across foundations, guides, and reference for step IDs and the new ESLint rule.

## 0.5.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

## 0.4.0

### Minor Changes

- 6da0d57: - **awaitly-docs**: Restructure docs from `concepts/` to `foundations/` (step, workflows, tagged-errors, results). Content and link updates across getting-started, guides, comparison, and reference. Move `functional-utilities` to guides.
  - **awaitly-analyze**: CLI updates, README updates, and new CLI tests.

## 0.3.0

### Minor Changes

- dcef438: - **awaitly-analyze**: Static analyzer updates (schema, CLI/scripts, JSDoc fixtures, types). Improves workflow analysis and output structure.
  - **awaitly-docs**: New "Documenting workflows" guide, static analysis docs updates, API reference updates, and typedoc-based API generation.

## 0.2.0

### Minor Changes

- 9faf6ac: - **awaitly-analyze**: Switch to ts-morph-based static analysis; add CLI, complexity metrics, composition resolver, path generator, and JSON/Mermaid/test-matrix output. Remove tree-sitter and browser/playground code.
  - **awaitly-docs**: Update static analysis guide and API reference for ts-morph analyzer; remove playground page and related assets.
