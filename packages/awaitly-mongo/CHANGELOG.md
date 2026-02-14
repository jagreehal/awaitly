# awaitly-mongo

## 14.0.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

### Patch Changes

- Updated dependencies [c3a9f08]
  - awaitly@1.24.0

## 13.0.0

### Patch Changes

- Updated dependencies [98f110a]
  - awaitly@1.23.0

## 12.0.0

### Patch Changes

- Updated dependencies [84bfb7a]
  - awaitly@1.22.0

## 11.0.0

### Patch Changes

- f68ccdb: ### createWorkflow introspection (WorkflowClass parity)

  - **createWorkflow return value** now exposes `name`, `deps`, `options`, and `snapshot` (read-only). Aligns with WorkflowClass for inspection and persistence. Use `workflow.snapshot` for one-off access or `workflow.getSnapshot()` when reusing. `deps` and `options` are frozen.
  - **WorkflowSnapshot** gains optional `workflowName` (set by the engine when creating a snapshot).
  - **awaitly/core** exports `matchWhen` and type `MatchTag` for tagged-union pattern matching.

  ### Docs

  - API reference: Workflow instance (createWorkflow return value) and Pattern matching (awaitly/core). Foundations and quick reference updated. Functional utilities guide links to core pattern matching.

  ### Tests and quality

  - **awaitly-postgres**, **awaitly-mongo**: Integration tests skip when the database is unavailable (beforeAll connection check + `it.skipIf`), so `pnpm quality` passes without a running Postgres/Mongo.

- Updated dependencies [f68ccdb]
  - awaitly@1.21.0

## 10.0.0

### Patch Changes

- Updated dependencies [dceec3d]
  - awaitly@1.20.0

## 9.1.0

### Minor Changes

- 69c2fa8: - **awaitly-analyze**: Static analyzer enhancements (path generation, complexity metrics, Mermaid output), kitchen-sink fixtures, and fixture tsconfig for type-checking test sources.
  - **awaitly-docs**: Astro and content config updates for docs site.

## 9.0.0

### Patch Changes

- Updated dependencies [34022b8]
  - awaitly@1.19.0

## 8.0.0

### Patch Changes

- Updated dependencies [6119f95]
  - awaitly@1.18.0

## 7.0.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

### Patch Changes

- Updated dependencies [afc8f6c]
  - awaitly@1.17.0

## 6.0.0

### Patch Changes

- Updated dependencies [d4cd1ac]
  - awaitly@1.16.0

## 5.0.0

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

## 4.0.0

### Minor Changes

- f5957ad: Persistence DX: improved snapshot store APIs, Postgres/Mongo/LibSQL adapter consistency, and updated persistence docs and API reference.

### Patch Changes

- Updated dependencies [f5957ad]
  - awaitly@1.14.0

## 3.0.0

### Minor Changes

- 6114dd9: Split workflow visualization and devtools out of the main `awaitly` package into a new `awaitly-visualizer` package. The core package no longer ships visualize/devtools entry points; use `awaitly-visualizer` for Mermaid diagrams, ASCII art, HTML rendering, Kroki integration, and Slack/Discord/webhook notifiers. Persistence packages (`awaitly-postgres`, `awaitly-libsql`, `awaitly-mongo`) gain dedicated lock modules. Docs and browser-test app updated for the new layout.

### Patch Changes

- Updated dependencies [6114dd9]
  - awaitly@1.13.0

## 2.0.0

### Minor Changes

- 5f2ff00: Split `run()` function into separate entry point (`awaitly/run`) for better tree-shaking and bundle size optimization. The main `awaitly` package now exports only Result types and utilities, while `run()` and its related types (`RunStep`, `RunOptions`, `StepTimeoutError`, etc.) are available via `awaitly/run`. This allows users who only need Result types to import a smaller bundle without the step orchestration overhead.

  **What changed:**

  - `run()` is now available from `awaitly/run` entry point
  - Main `awaitly` entry point no longer exports `run()` (only Result types)
  - Related types (`RunStep`, `RunOptions`, `StepTimeoutError`, etc.) moved to `awaitly/run`
  - Documentation updated to reflect new import paths

  **Migration:**

  ```typescript
  // Before
  import { run } from "awaitly";

  // After (recommended)
  import { run } from "awaitly/run";
  import { ok, err, type AsyncResult } from "awaitly";

  // Or import both from their respective entry points
  import { run, type RunStep } from "awaitly/run";
  import { ok, err } from "awaitly";
  ```

  This change improves bundle size for users who only need Result types, while keeping `run()` easily accessible for those who need step-based composition.

### Patch Changes

- Updated dependencies [5f2ff00]
  - awaitly@1.12.0

## 1.0.0

### Patch Changes

- Updated dependencies [e9396f1]
  - awaitly@1.11.0
