---
name: awaitly-analyze
description: "Static analysis patterns for awaitly workflows - complexity metrics, path generation, and visualization"
user-invocable: true
---

# Awaitly Static Analysis Patterns

Use awaitly-analyze to understand workflow structure without execution.

## Quick Start

```typescript
import { analyze, renderStaticMermaid, generatePaths } from 'awaitly-analyze';

const ir = analyze('./workflow.ts').single();
const diagram = renderStaticMermaid(ir);
const paths = generatePaths(ir);
```

## Workflow Selection

```typescript
// Single workflow (throws if not exactly 1)
const ir = analyze('./file.ts').single();

// Named workflow (multiple in file)
const ir = analyze('./file.ts').named('checkoutWorkflow');

// All workflows
const workflows = analyze('./file.ts').all();

// Safe access (returns null instead of throwing)
const ir = analyze('./file.ts').singleOrNull();
const ir = analyze('./file.ts').firstOrNull();
```

## Complexity Analysis

```typescript
import { calculateComplexity, assessComplexity, formatComplexitySummary } from 'awaitly-analyze';

const metrics = calculateComplexity(ir);
const assessment = assessComplexity(metrics);
console.log(formatComplexitySummary(metrics, assessment));
```

Metrics include: cyclomatic complexity, cognitive complexity, path count, max depth.

## Path Generation

```typescript
import { generatePaths, filterPaths, calculatePathStatistics } from 'awaitly-analyze';

const paths = generatePaths(ir);
const stats = calculatePathStatistics(paths);

// Filter paths
const filtered = filterPaths(paths, {
  mustIncludeStep: 'validatePayment',
  noLoops: true,
  maxLength: 10
});
```

## Output Formats

### Mermaid Diagrams
```typescript
import { renderStaticMermaid, renderEnhancedMermaid } from 'awaitly-analyze';

const diagram = renderStaticMermaid(ir, { direction: 'LR' });
const enhanced = renderEnhancedMermaid(ir, {
  showDataFlow: true,
  showErrors: true
});
```

### Test Matrix
```typescript
import { generateTestMatrix, formatTestMatrixMarkdown } from 'awaitly-analyze';

const matrix = generateTestMatrix(paths);
console.log(formatTestMatrixMarkdown(matrix));
```

### JSON
```typescript
import { renderStaticJSON } from 'awaitly-analyze';

const json = renderStaticJSON(ir, { pretty: true });
```

## Data Flow Analysis

```typescript
import { buildDataFlowGraph, validateDataFlow } from 'awaitly-analyze';

const graph = buildDataFlowGraph(ir);
const validation = validateDataFlow(graph);

if (!validation.valid) {
  console.log('Issues:', validation.issues);
}
```

## Error Flow Analysis

```typescript
import { analyzeErrorFlow, formatErrorSummary } from 'awaitly-analyze';

const errorFlow = analyzeErrorFlow(ir);
console.log(formatErrorSummary(errorFlow));
```

## Strict Mode Validation

```typescript
import { validateStrict, formatDiagnostics } from 'awaitly-analyze';

const result = validateStrict(ir, { warningsAsErrors: true });
if (!result.valid) {
  console.log(formatDiagnostics(result));
}
```

Strict validation checks include:
- **missing-step-id**: All step types must use a string as the first argument (ID or name): `step('id', fn, opts)`, `step.sleep('id', duration, opts?)`, `step.retry('id', operation, opts)`, `step.withTimeout('id', operation, opts)`, `step.try('id', operation, opts)`, `step.fromResult('id', operation, opts)`, `step.parallel('name', operations | callback)`, `step.race('name', callback)`, `step.allSettled('name', callback)`. Legacy `step(fn, opts)` is parsed (with `stepId: "<missing>"`) but triggers this warning. For `step.sleep`, both id and duration are required; single-argument `step.sleep(duration)` is invalid. `step.parallel` only supports the name-first form; the legacy `step.parallel(operations, { name })` form is no longer supported.

## Cross-Workflow Analysis

```typescript
import { analyzeWorkflowGraph, renderGraphMermaid } from 'awaitly-analyze';

const graph = analyzeWorkflowGraph(['./workflow1.ts', './workflow2.ts']);
const diagram = renderGraphMermaid(graph);
```

## CLI Usage

```bash
# Generate Mermaid diagram
npx awaitly-analyze ./workflow.ts

# JSON output
npx awaitly-analyze ./workflow.ts --format json

# Write to adjacent file
npx awaitly-analyze ./workflow.ts -o
```

## IR Node Types

The analysis produces these node types:
- `workflow` - Root workflow node
- `step` - Single step execution. Every step type takes a string as the first argument (ID or name): `step('id', fn, opts)`, `step.sleep('id', duration, opts?)`, `step.retry('id', operation, opts)`, `step.withTimeout('id', operation, opts)`, `step.try('id', operation, opts)`, `step.fromResult('id', operation, opts)`, `step.parallel('name', operations | callback)`, `step.race('name', callback)`, `step.allSettled('name', callback)`. Legacy `step(fn, opts)` yields `stepId: "<missing>"` and a warning.
- `saga-step` - Saga step with compensation. Name-first form only: `saga.step(name, operation, options?)`, `saga.tryStep(name, operation, options)`. The analyzer reads the step name from the first argument (string literal), not from the options object.
- `sequence` - Sequential execution
- `parallel` - Concurrent execution (allAsync)
- `race` - First-wins execution (anyAsync)
- `conditional` - if/else or when/unless
- `decision` - step.if labeled branch
- `switch` - switch statement
- `loop` - for/while/forEach iteration
- `stream` - streaming operations
- `workflow-ref` - cross-workflow reference
