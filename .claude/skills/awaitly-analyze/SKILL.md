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

const result = validateStrict(ir, { treatWarningsAsErrors: true });
if (!result.valid) {
  console.log(formatDiagnostics(result));
}
```

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
- `step` - Single step execution
- `saga-step` - Saga step with compensation
- `sequence` - Sequential execution
- `parallel` - Concurrent execution (allAsync)
- `race` - First-wins execution (anyAsync)
- `conditional` - if/else or when/unless
- `decision` - step.if labeled branch
- `switch` - switch statement
- `loop` - for/while/forEach iteration
- `stream` - streaming operations
- `workflow-ref` - cross-workflow reference
