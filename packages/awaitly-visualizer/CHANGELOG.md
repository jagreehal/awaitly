# awaitly-visualizer

## 15.0.0

### Patch Changes

- Updated dependencies [fe5dddf]
  - awaitly@1.26.0

## 14.0.0

### Patch Changes

- Updated dependencies [5eec7cc]
  - awaitly@1.25.0

## 13.0.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

### Patch Changes

- Updated dependencies [c3a9f08]
  - awaitly@1.24.0

## 12.0.0

### Patch Changes

- Updated dependencies [98f110a]
  - awaitly@1.23.0

## 11.0.0

### Patch Changes

- Updated dependencies [84bfb7a]
  - awaitly@1.22.0

## 10.0.0

### Patch Changes

- Updated dependencies [f68ccdb]
  - awaitly@1.21.0

## 9.0.0

### Patch Changes

- Updated dependencies [dceec3d]
  - awaitly@1.20.0

## 8.0.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

### Patch Changes

- Updated dependencies [34022b8]
  - awaitly@1.19.0

## 7.0.0

### Patch Changes

- Updated dependencies [6119f95]
  - awaitly@1.18.0

## 6.0.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

### Patch Changes

- Updated dependencies [afc8f6c]
  - awaitly@1.17.0

## 5.0.0

### Patch Changes

- Updated dependencies [d4cd1ac]
  - awaitly@1.16.0

## 4.0.0

### Minor Changes

- 1830163: **Step IDs for workflows and steps**

  - **awaitly**: Workflow execution and snapshots now use explicit step IDs. Steps and helpers (`step()`, `step.sleep()`, `step.retry()`, `step.withTimeout()`, `step.try()`, `step.fromResult()`) accept an optional string literal as the first argument for durable execution, resumption, and observability.
  - **eslint-plugin-awaitly**: New rule `require-step-id` enforces that all step calls use a string literal step ID as the first argument.
  - **awaitly-analyze**: Static workflow IR and analyzer updated to support step IDs.
  - **awaitly-visualizer**: IR builder updated for step ID support.
  - **awaitly-postgres**, **awaitly-mongo**, **awaitly-libsql**: README and docs updated for step IDs.
  - **awaitly-docs**: Documentation updated across foundations, guides, and reference for step IDs and the new ESLint rule.

### Patch Changes

- Updated dependencies [1830163]
  - awaitly@1.15.0

## 3.0.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

### Patch Changes

- Updated dependencies [f5957ad]
  - awaitly@1.14.0

## 2.0.1

### Patch Changes

- c9924c7: - **awaitly-visualizer**: Add `./devtools` export with `createDevtools`, `quickVisualize`, `createConsoleLogger`, and `renderDiff` for timeline visualization, run comparison, and console logging from a single entry point.
  - **awaitly-docs**: Document `awaitly-visualizer/devtools` in the visualization guide and API reference; add devtools usage examples and migration note from `awaitly/devtools`.
  - **awaitly-postgres**: (version bump only; no code changes in this changeset)

## 2.0.0

### Minor Changes

- 6114dd9: Split workflow visualization and devtools out of the main `awaitly` package into a new `awaitly-visualizer` package. The core package no longer ships visualize/devtools entry points; use `awaitly-visualizer` for Mermaid diagrams, ASCII art, HTML rendering, Kroki integration, and Slack/Discord/webhook notifiers. Persistence packages (`awaitly-postgres`, `awaitly-libsql`, `awaitly-mongo`) gain dedicated lock modules. Docs and browser-test app updated for the new layout.

### Patch Changes

- Updated dependencies [6114dd9]
  - awaitly@1.13.0
