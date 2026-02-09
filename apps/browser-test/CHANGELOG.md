# browser-test

## 0.3.1

### Patch Changes

- Updated dependencies [dceec3d]
  - awaitly@1.20.0
  - awaitly-visualizer@9.0.0

## 0.3.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

### Patch Changes

- Updated dependencies [34022b8]
  - awaitly-visualizer@8.0.0
  - awaitly@1.19.0

## 0.2.5

### Patch Changes

- Updated dependencies [6119f95]
  - awaitly@1.18.0
  - awaitly-visualizer@7.0.0

## 0.2.4

### Patch Changes

- Updated dependencies [afc8f6c]
  - awaitly-visualizer@6.0.0
  - awaitly@1.17.0

## 0.2.3

### Patch Changes

- Updated dependencies [d4cd1ac]
  - awaitly@1.16.0
  - awaitly-visualizer@5.0.0

## 0.2.2

### Patch Changes

- Updated dependencies [1830163]
  - awaitly-visualizer@4.0.0
  - awaitly@1.15.0

## 0.2.1

### Patch Changes

- Updated dependencies [f5957ad]
  - awaitly@1.14.0
  - awaitly-visualizer@3.0.0

## 0.2.0

### Minor Changes

- 6114dd9: Split workflow visualization and devtools out of the main `awaitly` package into a new `awaitly-visualizer` package. The core package no longer ships visualize/devtools entry points; use `awaitly-visualizer` for Mermaid diagrams, ASCII art, HTML rendering, Kroki integration, and Slack/Discord/webhook notifiers. Persistence packages (`awaitly-postgres`, `awaitly-libsql`, `awaitly-mongo`) gain dedicated lock modules. Docs and browser-test app updated for the new layout.

### Patch Changes

- Updated dependencies [6114dd9]
  - awaitly-visualizer@2.0.0
  - awaitly@1.13.0

## 0.1.0

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
