# Devtools

Debug, visualize, and analyze workflow executions. The devtools module provides timeline rendering, run comparison, and console logging for development.

## Table of Contents

- [Overview](#overview)
- [Basic Setup](#basic-setup)
- [Rendering](#rendering)
- [Run History](#run-history)
- [Comparing Runs](#comparing-runs)
- [Timeline](#timeline)
- [Console Logging](#console-logging)
- [Export & Import](#export--import)
- [API Reference](#api-reference)

## Overview

```typescript
import { createDevtools } from 'awaitly/devtools';
import { createWorkflow } from 'awaitly';

const devtools = createDevtools({ workflowName: 'checkout' });

const workflow = createWorkflow(deps, {
  onEvent: devtools.handleEvent,
});

await workflow(async (step) => {
  // ... your workflow
});

// Visualize
console.log(devtools.render());        // ASCII visualization
console.log(devtools.renderMermaid()); // Mermaid diagram
console.log(devtools.renderTimeline()); // Timeline view
```

## Basic Setup

### Create Devtools Instance

```typescript
import { createDevtools } from 'awaitly/devtools';

const devtools = createDevtools({
  // Workflow name for display
  workflowName: 'checkout',

  // Log events to console
  logEvents: false,

  // Max runs to keep in history
  maxHistory: 10,

  // Custom logger function
  logger: console.log,
});
```

### Connect to Workflow

```typescript
const workflow = createWorkflow(deps, {
  onEvent: devtools.handleEvent,
});
```

### Multiple Event Handlers

```typescript
import { createAutotelAdapter } from 'awaitly/otel';

const otel = createAutotelAdapter({ serviceName: 'checkout' });
const devtools = createDevtools({ workflowName: 'checkout' });

const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    otel.handleEvent(event);       // Metrics
    devtools.handleEvent(event);   // Visualization
  },
});
```

## Rendering

### ASCII Visualization

```typescript
const output = devtools.render();
console.log(output);

// Output:
// checkout
// ├─ fetch-user ✓ (45ms)
// ├─ validate-order ✓ (12ms)
// ├─ charge-card ✓ (230ms)
// └─ send-email ✓ (89ms)
//
// Total: 376ms
```

### Mermaid Diagrams

Generate Mermaid diagrams for documentation or visualization tools:

```typescript
const mermaid = devtools.renderMermaid();
console.log(mermaid);

// Output:
// graph TD
//   A[fetch-user] --> B[validate-order]
//   B --> C[charge-card]
//   C --> D[send-email]
//
//   style A fill:#90EE90
//   style B fill:#90EE90
//   style C fill:#90EE90
//   style D fill:#90EE90
```

### Custom Format

```typescript
const json = devtools.renderAs('json');
const html = devtools.renderAs('html');
```

## Run History

### Get Current Run

```typescript
const currentRun = devtools.getCurrentRun();

if (currentRun) {
  console.log({
    id: currentRun.id,
    name: currentRun.name,
    startTime: currentRun.startTime,
    endTime: currentRun.endTime,
    durationMs: currentRun.durationMs,
    success: currentRun.success,
    error: currentRun.error,
    events: currentRun.events,
  });
}
```

### Browse History

```typescript
// Get all historical runs
const history = devtools.getHistory();

for (const run of history) {
  console.log(`${run.id}: ${run.success ? 'success' : 'error'} (${run.durationMs}ms)`);
}

// Get specific run by ID
const run = devtools.getRun('wf_123');
```

### Clear History

```typescript
devtools.clearHistory();
```

## Comparing Runs

### Compare Two Runs

```typescript
const diff = devtools.diff('run_abc', 'run_xyz');

if (diff) {
  console.log('Added steps:', diff.added);
  console.log('Removed steps:', diff.removed);
  console.log('Changed steps:', diff.changed);
  console.log('Unchanged:', diff.unchanged);

  if (diff.statusChange) {
    console.log(`Status: ${diff.statusChange.from} → ${diff.statusChange.to}`);
  }

  if (diff.durationChange !== undefined) {
    const sign = diff.durationChange >= 0 ? '+' : '';
    console.log(`Duration: ${sign}${diff.durationChange}ms`);
  }
}
```

### Compare with Previous Run

```typescript
const diff = devtools.diffWithPrevious();

if (diff) {
  console.log(renderDiff(diff));
}
```

### Render Diff

```typescript
import { renderDiff } from 'awaitly/devtools';

const diff = devtools.diff('run_1', 'run_2');
if (diff) {
  console.log(renderDiff(diff));

  // Output:
  // Status: success → error
  // Duration: +150ms
  //
  // Added steps:
  //   + validate-inventory
  //
  // Changed steps:
  //   ~ charge-card: success → error
  //
  // Unchanged: 3 steps
}
```

## Timeline

### Get Timeline Data

```typescript
const timeline = devtools.getTimeline();

for (const entry of timeline) {
  console.log({
    name: entry.name,
    key: entry.key,
    startMs: entry.startMs,      // Relative to workflow start
    endMs: entry.endMs,
    durationMs: entry.durationMs,
    status: entry.status,        // 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'cached'
    error: entry.error,
    attempt: entry.attempt,
  });
}
```

### Render ASCII Timeline

```typescript
const timeline = devtools.renderTimeline();
console.log(timeline);

// Output:
// Timeline:
// ────────────────────────────────────────────────────────────
// fetch-user           |████                                    | 45ms
// validate-order       |    ██                                  | 12ms
// charge-card          |      ████████████████                  | 230ms
// send-email           |                      ██████            | 89ms
// ────────────────────────────────────────────────────────────
```

### Timeline Status Characters

| Status | Character |
|--------|-----------|
| `success` | `█` |
| `error` | `░` |
| `running` | `▒` |
| `cached` | `▓` |
| `skipped` | `·` |

## Console Logging

### Create Console Logger

```typescript
import { createConsoleLogger } from 'awaitly/devtools';

const logger = createConsoleLogger({
  prefix: '[checkout]',
  colors: true,  // ANSI colors
});

const workflow = createWorkflow(deps, {
  onEvent: logger,
});

// Output with colors:
// 12:34:56.789 [checkout] ⏵ Workflow started
// 12:34:56.834 [checkout] → fetch-user
// 12:34:56.879 [checkout] ✓ fetch-user (45ms)
// 12:34:56.891 [checkout] → charge-card
// 12:34:57.121 [checkout] ✓ charge-card (230ms)
// 12:34:57.121 [checkout] ✓ Workflow completed (332ms)
```

### Combine with Devtools

```typescript
const logger = createConsoleLogger({ prefix: '[checkout]' });
const devtools = createDevtools({ workflowName: 'checkout' });

const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    logger(event);              // Console output
    devtools.handleEvent(event); // Visualization
  },
});
```

### Enable Event Logging in Devtools

```typescript
const devtools = createDevtools({
  workflowName: 'checkout',
  logEvents: true,  // Logs all events
});
```

## Export & Import

### Export Run Data

```typescript
// Export current run
const json = devtools.exportRun();

// Export specific run
const json = devtools.exportRun('run_123');

// Save to file
await fs.writeFile('run-debug.json', json);
```

### Import Run Data

```typescript
const json = await fs.readFile('run-debug.json', 'utf-8');
const run = devtools.importRun(json);

console.log(`Imported run ${run.id}`);
```

### Share Debugging Data

```typescript
// Developer A: Export failing run
const debug = devtools.exportRun();
await sendToSlack('#bugs', debug);

// Developer B: Import and analyze
const run = devtools.importRun(debugJson);
console.log(devtools.render());  // Visualize the imported run
```

## API Reference

### Functions

| Function | Description |
|----------|-------------|
| `createDevtools(options?)` | Create devtools instance |
| `renderDiff(diff)` | Render diff as string |
| `createConsoleLogger(options?)` | Create console event logger |
| `quickVisualize(workflowFn, options?)` | Quick visualization helper |

### Devtools Methods

| Method | Description |
|--------|-------------|
| `handleEvent(event)` | Process workflow event |
| `handleDecisionEvent(event)` | Process decision event |
| `getCurrentRun()` | Get current run |
| `getHistory()` | Get run history |
| `getRun(id)` | Get specific run |
| `diff(id1, id2)` | Compare two runs |
| `diffWithPrevious()` | Compare with previous |
| `render()` | Render ASCII |
| `renderAs(format)` | Render to format |
| `renderMermaid()` | Render Mermaid diagram |
| `renderTimeline()` | Render ASCII timeline |
| `getTimeline()` | Get timeline data |
| `clearHistory()` | Clear run history |
| `reset()` | Reset current run |
| `exportRun(id?)` | Export as JSON |
| `importRun(json)` | Import from JSON |

### Types

```typescript
interface WorkflowRun {
  id: string;
  name?: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success?: boolean;
  error?: unknown;
  events: CollectableEvent[];
  metadata?: Record<string, unknown>;
}

interface RunDiff {
  added: StepDiff[];
  removed: StepDiff[];
  changed: StepDiff[];
  unchanged: string[];
  statusChange?: { from: string; to: string };
  durationChange?: number;
}

interface TimelineEntry {
  name: string;
  key?: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped' | 'cached';
  error?: unknown;
  attempt?: number;
}
```

### Options

```typescript
interface DevtoolsOptions {
  workflowName?: string;   // Display name
  logEvents?: boolean;     // Log to console
  maxHistory?: number;     // Max history size
  logger?: (msg) => void;  // Custom logger
}
```
