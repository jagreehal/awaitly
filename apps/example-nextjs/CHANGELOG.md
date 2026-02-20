# example-nextjs

## 0.5.4

### Patch Changes

- Updated dependencies [7a97004]
  - awaitly@1.28.0

## 0.5.3

### Patch Changes

- Updated dependencies [2fae4a4]
  - awaitly@1.27.0

## 0.5.2

### Patch Changes

- Updated dependencies [fe5dddf]
  - awaitly@1.26.0

## 0.5.1

### Patch Changes

- Updated dependencies [5eec7cc]
  - awaitly@1.25.0

## 0.5.0

### Minor Changes

- c3a9f08: - **Docs (awaitly vs Effect)**: Rewrote intro and Quick Comparison for accuracy and tone. Narrowed overlap claim; added scope-of-comparison note; softened bundle and learning-curve wording; corrected error-typing (Effect generally inferred); clarified DI (explicit parameter vs Layers/Context); qualified circuit breaker/saga/durable/HITL as "not shipped as a core feature"; refined observability and resource rows; added per-run dependency injection note; reframed "What awaitly provides" as first-class modules; removed em dashes; aligned durable/HITL/circuit breaker prose.
  - **Docs (Effect-style Layers in awaitly)**: Added workflow-factory pattern, lifecycle note, and "Day-to-day JavaScript ergonomics"; tightened intro and Aside; standardized "construct and execute" and terminology; added mental-model closing line.

### Patch Changes

- Updated dependencies [c3a9f08]
  - awaitly@1.24.0

## 0.4.4

### Patch Changes

- Updated dependencies [98f110a]
  - awaitly@1.23.0

## 0.4.3

### Patch Changes

- Updated dependencies [84bfb7a]
  - awaitly@1.22.0

## 0.4.2

### Patch Changes

- Updated dependencies [f68ccdb]
  - awaitly@1.21.0

## 0.4.1

### Patch Changes

- Updated dependencies [dceec3d]
  - awaitly@1.20.0

## 0.4.0

### Minor Changes

- 34022b8: - **Workflow naming:** `createWorkflow` now takes a required workflow name as the first argument (e.g. `createWorkflow('checkout', deps, options)`). The name is used in visualization, static analysis, and error messages.
  - **Docs:** Updated error-handling, ESLint plugin, functional utilities, visualization, parallel operations, and quick reference to use the new signature and to document event capture and library workflow options.
  - **awaitly-visualizer:** Added `event-capture` test suite and kitchen-sink workflow for event-to-IR and visualization pipelines.

### Patch Changes

- Updated dependencies [34022b8]
  - awaitly@1.19.0

## 0.3.1

### Patch Changes

- Updated dependencies [6119f95]
  - awaitly@1.18.0

## 0.3.0

### Minor Changes

- afc8f6c: Documentation updates, static analyzer improvements, visualizer and ESLint plugin updates, and dependency bumps across packages.

### Patch Changes

- Updated dependencies [afc8f6c]
  - awaitly@1.17.0

## 0.2.8

### Patch Changes

- Updated dependencies [d4cd1ac]
  - awaitly@1.16.0

## 0.2.7

### Patch Changes

- Updated dependencies [23ed022]
  - autotel@2.18.0

## 0.2.6

### Patch Changes

- Updated dependencies [e62eb75]
  - autotel@2.17.0

## 0.2.5

### Patch Changes

- Updated dependencies [8a6769a]
  - autotel@2.16.0

## 0.2.4

### Patch Changes

- Updated dependencies [c68a580]
  - autotel@2.15.0

## 0.2.3

### Patch Changes

- Updated dependencies [78202aa]
  - autotel@2.14.2

## 0.2.2

### Patch Changes

- Updated dependencies [acfd0de]
  - autotel@2.14.1

## 0.2.1

### Patch Changes

- Updated dependencies [47c70fb]
  - autotel@2.14.0

## 0.2.0

### Minor Changes

- 8256dac: Add comprehensive awaitly integration example demonstrating workflow instrumentation with autotel OpenTelemetry. The new `awaitly-example` app showcases successful workflows, error handling, decision tracking, cache behavior, and visualization features. Updated prettier to 3.8.1 across all packages.

### Patch Changes

- Updated dependencies [8256dac]
  - autotel@2.13.0

## 0.1.4

### Patch Changes

- Updated dependencies [3e12422]
  - autotel@2.12.1

## 0.1.3

### Patch Changes

- Updated dependencies [8831cf8]
  - autotel@2.12.0

## 0.1.2

### Patch Changes

- Updated dependencies [92206af]
  - autotel@2.11.0

## 0.1.1

### Patch Changes

- Updated dependencies [e5337b0]
  - autotel@2.10.0

## 0.1.1

### Patch Changes

- Updated dependencies [86ae1a8]
  - autotel@2.10.0
