# awaitly-analyze

Static workflow analysis for [awaitly](https://github.com/jagreehal/awaitly). Analyze workflow source code to extract structure, calculate complexity metrics, and generate visualizations.

## Features

- **Static Analysis** - Extract workflow structure from TypeScript source without execution
- **Path Generation** - Enumerate all possible execution paths through a workflow
- **Complexity Metrics** - Calculate cyclomatic complexity, cognitive complexity, and more
- **Mermaid Diagrams** - Generate flowchart visualizations
- **Test Matrix** - Generate test coverage matrices for workflow paths
- **Cross-Workflow Composition** - Analyze dependencies between workflows

## Installation

```bash
npm install awaitly-analyze ts-morph
# or
pnpm add awaitly-analyze ts-morph
```

`ts-morph` is a required peer dependency.

## Quick Start

```typescript
import {
  analyze,
  generatePaths,
  calculateComplexity,
  renderStaticMermaid,
} from 'awaitly-analyze';

// Analyze a workflow file
const ir = analyze('./src/workflows/checkout.ts').single();

// Generate all possible paths
const paths = generatePaths(ir);
console.log(`Found ${paths.length} unique execution paths`);

// Calculate complexity metrics
const metrics = calculateComplexity(ir);
console.log(`Cyclomatic complexity: ${metrics.cyclomaticComplexity}`);

// Generate Mermaid diagram
const mermaid = renderStaticMermaid(ir);
console.log(mermaid);
```

## API Reference

### Analyzing Workflows

#### `analyze(filePath, options?)`

Returns a fluent interface for analyzing workflows in a file.

```typescript
import { analyze } from 'awaitly-analyze';

// Single workflow file - get the workflow directly
const ir = analyze('./checkout.ts').single();

// Multiple workflows - get all as array
const workflows = analyze('./workflows.ts').all();

// Get specific workflow by name
const checkout = analyze('./workflows.ts').named('checkoutWorkflow');

// Safe access (returns null instead of throwing)
const ir = analyze('./checkout.ts').singleOrNull();
const first = analyze('./workflows.ts').firstOrNull();
```

#### `analyze.source(code, options?)`

Analyze workflow source code from a string.

```typescript
const ir = analyze.source(`
  const workflow = createWorkflow({
    fetchUser: async (id: string) => ({ id, name: 'Alice' }),
  });

  async function run(id: string) {
    return await workflow(async (step, deps) => {
      const user = await step(() => deps.fetchUser(id), { key: 'user' });
      return user;
    });
  }
`).single();
```

### Path Generation

#### `generatePaths(ir, options?)`

Generate all unique execution paths through a workflow.

```typescript
import { generatePaths, calculatePathStatistics } from 'awaitly-analyze';

const paths = generatePaths(ir, { maxPaths: 100 });

// Get statistics
const stats = calculatePathStatistics(paths);
console.log(`Total paths: ${stats.totalPaths}`);
console.log(`Shortest path: ${stats.shortestPathLength} steps`);
console.log(`Longest path: ${stats.longestPathLength} steps`);
```

#### `generatePathsWithMetadata(ir, options?)`

Generate paths with additional metadata about limit hits.

```typescript
import { generatePathsWithMetadata } from 'awaitly-analyze';

const { paths, limitHit } = generatePathsWithMetadata(ir, { maxPaths: 50 });

if (limitHit) {
  console.log('Warning: Path limit reached, not all paths generated');
}
```

### Complexity Metrics

#### `calculateComplexity(ir)`

Calculate complexity metrics for a workflow.

```typescript
import { calculateComplexity } from 'awaitly-analyze';

const metrics = calculateComplexity(ir);

console.log(`Cyclomatic complexity: ${metrics.cyclomaticComplexity}`);
console.log(`Cognitive complexity: ${metrics.cognitiveComplexity}`);
console.log(`Max nesting depth: ${metrics.maxDepth}`);
console.log(`Max parallel breadth: ${metrics.maxParallelBreadth}`);
console.log(`Decision points: ${metrics.decisionPoints}`);
console.log(`Path count: ${metrics.pathCount}`);
```

#### `assessComplexity(ir, thresholds?)`

Get a complexity assessment with warnings.

```typescript
import { assessComplexity, formatComplexitySummary } from 'awaitly-analyze';

const assessment = assessComplexity(ir);

console.log(formatComplexitySummary(assessment));
// Output:
// Complexity: MODERATE
// - Cyclomatic: 8
// - Cognitive: 12
// - Max Depth: 3
// Warnings:
// - Consider breaking down: cognitive complexity (12) exceeds threshold (10)
```

### Mermaid Diagrams

#### `renderStaticMermaid(ir, options?)`

Generate a Mermaid flowchart diagram.

```typescript
import { renderStaticMermaid } from 'awaitly-analyze';

const mermaid = renderStaticMermaid(ir, {
  direction: 'TB',  // 'TB' | 'LR' | 'BT' | 'RL'
  includeKeys: true,
  includeDescriptions: true,
});

// Use in markdown:
// ```mermaid
// ${mermaid}
// ```
```

#### `renderPathsMermaid(ir, paths, options?)`

Generate a diagram highlighting specific paths.

```typescript
import { renderPathsMermaid, generatePaths } from 'awaitly-analyze';

const paths = generatePaths(ir);
const diagram = renderPathsMermaid(ir, paths.slice(0, 3));
```

### Test Matrix

#### `generateTestMatrix(paths)`

Generate a test coverage matrix from paths.

```typescript
import { generateTestMatrix, formatTestMatrixMarkdown } from 'awaitly-analyze';

const paths = generatePaths(ir);
const matrix = generateTestMatrix(paths);

// Format as markdown table
console.log(formatTestMatrixMarkdown(matrix));

// Or as code
import { formatTestMatrixAsCode } from 'awaitly-analyze';
console.log(formatTestMatrixAsCode(matrix));
```

### Cross-Workflow Composition

#### `analyzeWorkflowGraph(files, options?)`

Analyze dependencies between workflows across multiple files.

```typescript
import {
  analyzeWorkflowGraph,
  getTopologicalOrder,
  renderGraphMermaid,
} from 'awaitly-analyze';

const graph = analyzeWorkflowGraph([
  './src/workflows/checkout.ts',
  './src/workflows/payment.ts',
  './src/workflows/shipping.ts',
]);

// Get execution order (workflows with no dependencies first)
const order = getTopologicalOrder(graph);
console.log('Execution order:', order.map(n => n.name).join(' -> '));

// Visualize the dependency graph
const diagram = renderGraphMermaid(graph);
```

### JSON Output

#### `renderStaticJSON(ir, options?)`

Serialize workflow IR to JSON.

```typescript
import { renderStaticJSON } from 'awaitly-analyze';

const json = renderStaticJSON(ir, { pretty: true });
fs.writeFileSync('workflow.json', json);
```

## Detected Patterns

The analyzer detects the following awaitly patterns:

- `createWorkflow()` - Standard workflow creation
- `run()` - Inline workflow execution
- `createSagaWorkflow()` - Saga workflow creation
- `runSaga()` - Inline saga execution

Within workflows, it detects:

- `step()` - Single steps with retry/timeout options
- `step.parallel()` / `allAsync()` / `allSettledAsync()` - Parallel execution
- `step.race()` / `anyAsync()` - Race execution
- `step.sleep()` - Sleep steps
- `step.retry()` - Retry wrappers
- `step.getWritable()` / `step.getReadable()` / `step.streamForEach()` - Streaming
- `when()` / `unless()` / `whenOr()` / `unlessOr()` - Conditional helpers
- `if/else`, `switch` - Control flow
- `for`, `while`, `forEach`, `map` - Loops
- Saga steps with compensation (`saga.step()`, `saga.tryStep()`)

## Import Styles

The analyzer supports various import styles:

```typescript
// Named imports
import { createWorkflow, run } from 'awaitly';

// Aliased imports
import { createWorkflow as cw } from 'awaitly';

// Namespace imports
import * as Awaitly from 'awaitly';
Awaitly.createWorkflow({...});

// Default imports
import Awaitly from 'awaitly';
Awaitly.run(async (step) => {...});
```

## Types

Key types exported from the package:

```typescript
import type {
  // IR nodes
  StaticWorkflowIR,
  StaticFlowNode,
  StaticStepNode,
  StaticParallelNode,
  StaticConditionalNode,

  // Paths
  WorkflowPath,
  PathStatistics,

  // Complexity
  ComplexityMetrics,
  ComplexityAssessment,

  // Test matrix
  TestMatrix,
  TestPath,

  // Graph
  WorkflowGraph,
  WorkflowGraphNode,
} from 'awaitly-analyze';
```

## Requirements

- Node.js >= 22
- TypeScript project with `ts-morph` >= 27.0.2

## License

MIT
