---
title: Visualization
description: Generate diagrams of workflow execution
---

Visualize workflow execution as ASCII diagrams or Mermaid charts for debugging, documentation, or dashboards. Use **`step('id', fn, opts)`** so step IDs appear as stable labels in diagrams and in [statically generated docs](/docs/guides/static-analysis/).

## Basic usage

```typescript
import { createWorkflow, ok, err, type Result } from 'awaitly';
import { createVisualizer } from 'awaitly-visualizer';

// Define your dependencies with Result-returning functions
const deps = {
  fetchOrder: async (id: string): Promise<Result<Order, OrderNotFound>> => {
    const order = await db.orders.find(id);
    return order ? ok(order) : err({ type: 'ORDER_NOT_FOUND', id });
  },
  chargeCard: async (amount: number): Promise<Result<Payment, PaymentFailed>> => {
    const result = await paymentGateway.charge(amount);
    return result.success
      ? ok(result.payment)
      : err({ type: 'PAYMENT_FAILED', reason: result.error });
  },
};

const viz = createVisualizer({ workflowName: 'checkout' });

const workflow = createWorkflow(deps, {
  onEvent: viz.handleEvent,
});

await workflow(async (step) => {
  const order = await step('fetchOrder', () => deps.fetchOrder('123'));
  const payment = await step('chargeCard', () => deps.chargeCard(order.total));
  return { order, payment };
});

// ASCII output
console.log(viz.render());

// Mermaid output
console.log(viz.renderAs('mermaid'));
```

## Migration from manual logging

If you're currently using manual `onEvent` logging, here's how to migrate to `createVisualizer`:

### Before: Manual logging

```typescript
const workflow = createWorkflow(deps, {
  onEvent: (event) => {
    if (event.type === 'step_start') {
      console.log(`Starting: ${event.name}`);
    }
    if (event.type === 'step_complete') {
      console.log(`Completed: ${event.name} in ${event.durationMs}ms`);
    }
    if (event.type === 'step_error') {
      console.error(`Failed: ${event.name}`, event.error);
    }
  },
});
```

### After: Using createVisualizer

```typescript
import { createVisualizer } from 'awaitly-visualizer';

const viz = createVisualizer({ workflowName: 'checkout' });
const workflow = createWorkflow(deps, {
  onEvent: viz.handleEvent,
});

// Run workflow...
console.log(viz.render()); // ASCII diagram with all steps
```

### Benefits comparison

| Feature | Manual Logging | createVisualizer |
|---------|---------------|------------------|
| Timing per step | Manual calculation | Automatic |
| Error formatting | Custom | Structured |
| Parallel detection | Not supported | Automatic |
| Output formats | Text only | ASCII, Mermaid, JSON, Flowchart |
| Diagram generation | Not supported | Built-in |
| Post-execution analysis | Manual | Built-in |

## ASCII output

```
┌── checkout ──────────────────────────────────────────────────────┐
│                                                                  │
│  ✓ Fetch order [12ms]                                            │
│  ✓ Charge card [45ms]                                            │
│                                                                  │
│  Completed in 57ms                                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Mermaid output

```mermaid
flowchart TD
    start(("▶ Start"))
    step_fetch_order[✓ Fetch order 12ms]:::success
    start --> step_fetch_order
    step_charge_card[✓ Charge card 45ms]:::success
    step_fetch_order --> step_charge_card
    finish(("✓ Done")):::success
    step_charge_card --> finish
```

Paste into GitHub markdown or any Mermaid-compatible renderer.

## JSON output

Get structured data for custom rendering:

```typescript
const ir = viz.renderAs('json');
// {
//   workflowName: 'checkout',
//   status: 'completed',
//   steps: [...],
//   duration: 57
// }
```

## Naming steps

Give steps descriptive names for better diagrams:

```typescript
const user = await step('fetchUser', () => fetchUser('1'), { name: 'Fetch user' });
const posts = await step('fetchPosts', () => fetchPosts(user.id), { name: 'Fetch posts' });
```

Without names, steps show as "unnamed step".

## Parallel operations

Track parallel operations individually:

```typescript
import { allAsync } from 'awaitly';

const result = await workflow(async (step) => {
  const [user, posts] = await step(
    'fetchUserData',
    () => allAsync([
      fetchUser('1'),
      fetchPosts('1'),
    ]),
    { name: 'Fetch user data' }
  );
  return { user, posts };
});
```

## Decision tracking

Track conditional logic (if/switch) to visualize branching in your workflows:

### Basic decision tracking

```typescript
import { trackDecision } from 'awaitly-visualizer';

const viz = createVisualizer();
const workflow = createWorkflow(deps, {
  onEvent: viz.handleEvent,
});

await workflow(async (step) => {
  const user = await step('fetchUser', () => fetchUser('1'), { name: 'Fetch user' });

  // Track a decision point
  const decision = trackDecision('check-role', {
    condition: "user.role === 'admin'",
    value: user.role,
    emit: viz.handleDecisionEvent,
  });

  if (user.role === 'admin') {
    decision.takeBranch('admin', true);
    await step('adminDashboard', () => adminDashboard(user), { name: 'Admin dashboard' });
  } else {
    decision.takeBranch('user', true);
    await step('userDashboard', () => userDashboard(user), { name: 'User dashboard' });
  }

  decision.end();
});
```

### trackIf - Simple if/else

```typescript
import { trackIf } from 'awaitly-visualizer';

const decision = trackIf('check-premium', user.isPremium, {
  condition: 'user.isPremium',
  emit: viz.handleDecisionEvent,
});

if (decision.condition) {
  decision.then();
  await step('fetchPremiumData', () => fetchPremiumData(user.id));
} else {
  decision.else();
  await step('fetchBasicData', () => fetchBasicData(user.id));
}

decision.end();
```

### trackSwitch - Switch statements

```typescript
import { trackSwitch } from 'awaitly-visualizer';

const decision = trackSwitch('process-by-role', user.role, {
  condition: 'switch(user.role)',
  emit: viz.handleDecisionEvent,
});

switch (user.role) {
  case 'admin':
    decision.case('admin', true);
    await step('processAdmin', () => processAdmin(user));
    break;
  case 'moderator':
    decision.case('moderator', true);
    await step('processModerator', () => processModerator(user));
    break;
  default:
    decision.default(true);
    await step('processUser', () => processUser(user));
}

decision.end();
```

### With event collector

```typescript
import { createEventCollector, trackIf } from 'awaitly-visualizer';

const collector = createEventCollector({ workflowName: 'Role Check' });
const workflow = createWorkflow(deps, {
  onEvent: collector.handleEvent,
});

await workflow(async (step) => {
  const user = await step('fetchUser', () => fetchUser('1'), { name: 'Fetch user' });

  const decision = trackIf('check-role', user.role === 'admin', {
    condition: "user.role === 'admin'",
    value: user.role,
    emit: collector.handleDecisionEvent,
  });

  if (decision.condition) {
    decision.then();
    await step('processAdmin', () => processAdmin(user));
  } else {
    decision.else();
    await step('processUser', () => processUser(user));
  }
  decision.end();

  return user;
});

// Visualize with decision tracking
console.log(collector.visualize());
```

## Post-execution visualization

Collect events and visualize later:

```typescript
import { createEventCollector } from 'awaitly-visualizer';

const collector = createEventCollector({ workflowName: 'my-workflow' });

const workflow = createWorkflow(deps, {
  onEvent: collector.handleEvent,
});

await workflow(async (step) => { ... });

// Visualize anytime after
console.log(collector.visualize());
console.log(collector.visualizeAs('mermaid'));
```

## Options

```typescript
const viz = createVisualizer({
  workflowName: 'checkout',
  showTimings: true,       // Show step durations (default: true)
  showKeys: false,         // Show step cache keys (default: false)
  detectParallel: true,    // Enable parallel detection (default: true)
});
```

## Convenience APIs

### combineEventHandlers

Combine multiple event handlers for visualization + logging + metrics:

```typescript
import { createVisualizer, combineEventHandlers } from 'awaitly-visualizer';

const viz = createVisualizer({ workflowName: 'checkout' });

const workflow = createWorkflow(deps, {
  onEvent: combineEventHandlers(
    viz.handleEvent,
    (e) => console.log(e.type),
    (e) => metrics.track(e),
  ),
});
```

## When to use each renderer

| Renderer | Best For | Example Use |
|----------|----------|-------------|
| ASCII | Terminal debugging | Quick inspection during development |
| Mermaid | Documentation | GitHub READMEs, Confluence pages |
| Logger | Production | Structured logging with Pino/Winston |
| Flowchart | Complex workflows | Box-and-arrow diagrams in terminal |
| JSON | Custom rendering | Building custom UIs or dashboards |

### ASCII renderer

Best for terminal-based debugging during development:

```typescript
const output = viz.renderAs('ascii');
// ┌── checkout ──────────────────────────────────────────┐
// │  ✓ Fetch order [12ms]                                │
// │  ✓ Charge card [45ms]                                │
// │  Completed in 57ms                                   │
// └──────────────────────────────────────────────────────┘
```

### Mermaid renderer

Best for documentation that renders in GitHub, Confluence, or other Markdown viewers:

```typescript
const mermaid = viz.renderAs('mermaid');
// flowchart TD
//     start(("▶ Start"))
//     step_1[✓ Fetch order 12ms]:::success
//     ...
```

### Logger renderer

Best for production logging with structured output:

```typescript
import { loggerRenderer } from 'awaitly-visualizer';

const renderer = loggerRenderer();
const output = renderer.render(viz.getIR(), {
  showTimings: true,
  showKeys: false,
  colors: { success: 'green', error: 'red', ... },
});
```

### Flowchart renderer

Best for complex workflows with box-and-arrow diagrams:

```typescript
const flowchart = viz.renderAs('flowchart');
// ╭──────────────────╮
// │   Fetch order    │
// ╰────────┬─────────╯
//          │
//          ▼
// ╭──────────────────╮
// │   Charge card    │
// ╰──────────────────╯
```

## Integration patterns

### Express middleware

Log and visualize workflows in HTTP handlers:

```typescript
import { createEventCollector } from 'awaitly-visualizer';

app.post('/checkout', async (req, res) => {
  const collector = createEventCollector({ workflowName: 'checkout' });

  const workflow = createWorkflow(deps, {
    onEvent: collector.handleEvent,
  });

  const result = await workflow(async (step) => {
    const order = await step('fetchOrder', () => deps.fetchOrder(req.body.orderId), { name: 'Fetch order' });
    const payment = await step('chargeCard', () => deps.chargeCard(order.total), { name: 'Charge card' });
    return { order, payment };
  });

  // Log visualization on error for debugging
  if (!result.ok) {
    logger.error('Checkout failed', {
      visualization: collector.visualize(),
      events: collector.getEvents(),
    });
    return res.status(500).json({ error: result.error });
  }

  res.json(result.value);
});
```

### Event collector for batched logging

Collect events across multiple workflow runs for aggregated analysis:

```typescript
import { createEventCollector, visualizeEvents } from 'awaitly-visualizer';

const allEvents: CollectableEvent[] = [];

const workflow = createWorkflow(deps, {
  onEvent: (e) => allEvents.push(e),
});

// Run multiple workflows
await workflow(async (step) => { ... });
await workflow(async (step) => { ... });

// Visualize all events together
console.log(visualizeEvents(allEvents, { workflowName: 'batch-run' }));
```

### CI/CD artifact generation

Generate Mermaid diagrams as build artifacts:

```typescript
import fs from 'fs';
import { createVisualizer } from 'awaitly-visualizer';
import { createWorkflow } from 'awaitly';

const viz = createVisualizer({ workflowName: 'deployment' });

const workflow = createWorkflow(deps, {
  onEvent: viz.handleEvent,
});

await workflow(async (step) => {
  await step('runTests', () => deps.runTests(), { name: 'Run tests' });
  await step('buildApp', () => deps.buildApp(), { name: 'Build app' });
  await step('deploy', () => deps.deploy(), { name: 'Deploy' });
});

// Write Mermaid diagram to artifacts
const mermaid = viz.renderAs('mermaid');
fs.writeFileSync('artifacts/workflow-diagram.md', `\`\`\`mermaid\n${mermaid}\n\`\`\``);

// Write JSON for further processing
const ir = viz.getIR();
fs.writeFileSync('artifacts/workflow-data.json', JSON.stringify(ir, null, 2));
```

## Common visualization patterns

### Development debugging

ASCII output with timings for quick terminal debugging:

```typescript
const viz = createVisualizer({
  workflowName: 'debug-session',
  showTimings: true,
});

const workflow = createWorkflow(deps, {
  onEvent: viz.handleEvent,
});

await workflow(async (step) => {
  const user = await step('fetchUser', () => deps.fetchUser('1'), { name: 'Fetch user' });
  const posts = await step('fetchPosts', () => deps.fetchPosts(user.id), { name: 'Fetch posts' });
  return { user, posts };
});

// Quick debug output
console.log(viz.render());
```

### Production monitoring

JSON output for structured logging and metrics:

```typescript
import { createVisualizer } from 'awaitly-visualizer';

const viz = createVisualizer({ workflowName: 'api-request' });

const workflow = createWorkflow(deps, {
  onEvent: viz.handleEvent,
});

const result = await workflow(async (step) => { ... });

// Structured logging for production
const ir = viz.getIR();
logger.info('Workflow completed', {
  workflowName: ir.root.name,
  status: ir.root.state,
  durationMs: ir.root.children.reduce((sum, s) => sum + (s.durationMs || 0), 0),
  stepCount: ir.root.children.length,
  steps: ir.root.children.map(s => ({ name: s.name, status: s.state, durationMs: s.durationMs })),
});

// Send to metrics
metrics.histogram('workflow.duration', ir.root.children.reduce((sum, s) => sum + (s.durationMs || 0), 0), {
  workflow: ir.root.name,
  status: ir.root.state,
});
```

### Documentation generation

Mermaid output for workflow documentation:

```typescript
import fs from 'fs';
import { createVisualizer } from 'awaitly-visualizer';
import { createWorkflow } from 'awaitly';

// Document all your workflows
const workflows = [
  { name: 'checkout', deps: checkoutDeps, fn: checkoutWorkflow },
  { name: 'refund', deps: refundDeps, fn: refundWorkflow },
  { name: 'subscription', deps: subscriptionDeps, fn: subscriptionWorkflow },
];

const docs: string[] = ['# Workflow Documentation\n'];

for (const { name, deps, fn } of workflows) {
  const viz = createVisualizer({ workflowName: name });
  const workflow = createWorkflow(deps, {
    onEvent: viz.handleEvent,
  });

  await workflow(fn);

  docs.push(`## ${name}\n`);
  docs.push('```mermaid');
  docs.push(viz.renderAs('mermaid'));
  docs.push('```\n');
}

fs.writeFileSync('docs/workflows.md', docs.join('\n'));
```

### CI/CD reporting

Build artifacts with stats and warnings:

```typescript
import fs from 'fs';
import { createVisualizer } from 'awaitly-visualizer';

const viz = createVisualizer({ workflowName: 'ci-pipeline' });

const workflow = createWorkflow(deps, {
  onEvent: viz.handleEvent,
});

await workflow(async (step) => {
  await step('lint', () => deps.lint(), { name: 'Lint' });
  await step('test', () => deps.test(), { name: 'Test' });
  await step('build', () => deps.build(), { name: 'Build' });
});

const ir = viz.getIR();

// Generate CI report
const report = {
  workflow: ir.root.name,
  status: ir.root.state,
  timestamp: new Date().toISOString(),
  steps: ir.root.children.map(s => ({
    name: s.name,
    status: s.state,
    durationMs: s.durationMs,
  })),
  totalDurationMs: ir.root.children.reduce((sum, s) => sum + (s.durationMs || 0), 0),
  warnings: ir.root.children.filter(s => s.state === 'error').map(s => s.name),
};

// Write artifacts
fs.writeFileSync('artifacts/ci-report.json', JSON.stringify(report, null, 2));
fs.writeFileSync('artifacts/workflow-diagram.md', `\`\`\`mermaid\n${viz.renderAs('mermaid')}\n\`\`\``);

// Exit with appropriate code
process.exit(ir.root.state === 'success' ? 0 : 1);
```

## Devtools (awaitly-visualizer/devtools)

For debugging and development, use the combined devtools entry. It provides timeline visualization, run comparison, and the console logger in one import:

```typescript
import { createWorkflow } from 'awaitly';
import { createDevtools, quickVisualize, createConsoleLogger } from 'awaitly-visualizer/devtools';

const devtools = createDevtools();
const workflow = createWorkflow(deps, {
  onEvent: devtools.handleEvent,
});

await workflow(async (step) => {
  await step('fetchOrder', () => deps.fetchOrder('123'), { name: 'Fetch order' });
  await step('chargeCard', () => deps.chargeCard(99.99), { name: 'Charge card' });
});

// Timeline (ordered steps with timing)
console.log(devtools.getTimeline());

// Quick visualization from raw events
quickVisualize(devtools.getEvents(), { workflowName: 'checkout' });
```

You can use `createConsoleLogger` from the same entry, or combine devtools with other handlers via `combineEventHandlers` from the main package. For run diffing, use `renderDiff(baselineRun, currentRun)`.

## Console logging

For simple console output during development, use `createConsoleLogger`:

```typescript
import { createConsoleLogger } from 'awaitly-visualizer/console-logger';

const logger = createConsoleLogger();

const workflow = createWorkflow(deps, {
  onEvent: logger,
});

await workflow(async (step) => {
  await step('fetchOrder', () => deps.fetchOrder('123'), { name: 'Fetch order' });
  await step('chargeCard', () => deps.chargeCard(99.99), { name: 'Charge card' });
});

// Output:
// 12:34:56.789 [workflow] ⏵ Workflow started
// 12:34:56.801 [workflow] → Fetch order
// 12:34:56.812 [workflow] ✓ Fetch order (11ms)
// 12:34:56.813 [workflow] → Charge card
// 12:34:56.858 [workflow] ✓ Charge card (45ms)
// 12:34:56.859 [workflow] ✓ Workflow completed (70ms)
```

### Options

```typescript
const logger = createConsoleLogger({
  prefix: '[checkout]',  // Custom prefix (default: '[workflow]')
  colors: false,         // Disable ANSI colors (default: true)
});
```

### Migration from awaitly/devtools

If you were using the old import path from the core package:

```typescript
// Before (v1.x)
import { createConsoleLogger } from 'awaitly/devtools';

// After (v2.x) – same single-import experience
import { createDevtools, createConsoleLogger } from 'awaitly-visualizer/devtools';

// Or use the dedicated console-logger entry
import { createConsoleLogger } from 'awaitly-visualizer/console-logger';
```

## Integration with logging

Combine console logging with visualization or custom logging:

```typescript
import { createConsoleLogger } from 'awaitly-visualizer/console-logger';
import { combineEventHandlers, createVisualizer } from 'awaitly-visualizer';

const viz = createVisualizer({ workflowName: 'checkout' });
const consoleLog = createConsoleLogger();

const workflow = createWorkflow(deps, {
  onEvent: combineEventHandlers(
    viz.handleEvent,
    consoleLog,
    (event) => {
      // Custom logging
      if (event.type === 'step_error') {
        logger.error(`Step ${event.name} failed:`, event.error);
      }
    },
  ),
});
```

## Advanced features

### Time-travel debugging

Step through workflow execution history:

```typescript
import { createTimeTravelController } from 'awaitly-visualizer';

const controller = createTimeTravelController({ maxSnapshots: 1000 });

const workflow = createWorkflow(deps, {
  onEvent: controller.handleEvent,
});

await workflow(async (step) => { ... });

// Navigate through execution history
controller.seek(0);              // Go to start
controller.stepForward();        // Step forward one event
controller.stepBackward();      // Step backward one event
controller.seek(10);            // Jump to event 10
controller.play(2.0);            // Playback at 2x speed
controller.pause();              // Pause playback

// Get current state
const ir = controller.getCurrentIR();
const state = controller.getState();
```

### Performance analyzer

Identify slow steps with heatmap visualization:

```typescript
import { createPerformanceAnalyzer, createEventCollector, createVisualizer, getHeatLevel } from 'awaitly-visualizer';

const analyzer = createPerformanceAnalyzer();

// Collect events from multiple runs for analysis
for (let i = 0; i < 5; i++) {
  const collector = createEventCollector();
  const workflow = createWorkflow(deps, {
    onEvent: collector.handleEvent,
  });

  const startTime = Date.now();
  await workflow(async (step) => { ... });

  // Add completed run to analyzer
  analyzer.addRun({
    id: `run-${i}`,
    startTime,
    events: collector.getEvents(),
  });
}

// Get slowest steps
const slowest = analyzer.getSlowestNodes(5);

// Get error-prone steps
const errorProne = analyzer.getErrorProneNodes(5);

// Get heatmap data for visualization
const viz = createVisualizer({ workflowName: 'analysis' });
// ... run a workflow with viz.handleEvent
const heatmap = analyzer.getHeatmap(viz.getIR(), 'duration');

// Export for persistence
const json = analyzer.exportData();
```

### Live visualizer

Real-time visualization as workflow executes:

```typescript
import { createLiveVisualizer } from 'awaitly-visualizer';

const visualizer = createLiveVisualizer({ workflowName: 'checkout' });

// Subscribe to updates
visualizer.onUpdate((ir) => {
  console.log('Workflow state updated:', ir);
  // Update UI, render diagram, etc.
});

const workflow = createWorkflow(deps, {
  onEvent: visualizer.handleEvent,
});

await workflow(async (step) => { ... });
```

### Notifiers (Slack, Discord, Webhook)

Push workflow visualizations to external services:

```typescript
// Slack notifier (requires @slack/web-api)
import { createSlackNotifier } from 'awaitly-visualizer/notifiers/slack';

const slack = createSlackNotifier({
  token: process.env.SLACK_TOKEN!,
  channel: '#workflows',
});

// Live updates (posts once, then updates same message - no spam)
const live = slack.createLive({ title: 'Order #123' });
const workflow = createWorkflow(deps, {
  onEvent: live.update,
});

await workflow(async (step) => { ... });
await live.finalize();
```

```typescript
// Discord notifier (plain HTTP, no SDK needed)
import { createDiscordNotifier } from 'awaitly-visualizer/notifiers/discord';

const discord = createDiscordNotifier({
  webhookUrl: process.env.DISCORD_WEBHOOK!,
});
```

```typescript
// Generic webhook for custom dashboards
import { createWebhookNotifier } from 'awaitly-visualizer/notifiers/webhook';

const webhook = createWebhookNotifier({
  url: 'https://my-dashboard.com/workflow-events',
  headers: { 'X-API-Key': '...' },
});
```

### Kroki URL generation

Generate shareable image URLs without rendering dependencies:

```typescript
import { toKrokiSvgUrl, toKrokiPngUrl } from 'awaitly-visualizer';

const viz = createVisualizer({ workflowName: 'checkout' });
// ... run workflow

const ir = viz.getIR();
const svgUrl = toKrokiSvgUrl(ir);
// Share this URL - image renders when viewed

// Optional: download the actual bytes (Node-only)
import { fetchKrokiPng } from 'awaitly-visualizer/kroki-fetch';
const buffer = await fetchKrokiPng(ir);
```

## Browser support

The visualization module works in browser environments. Bundlers (Vite, webpack, esbuild, Rollup) automatically resolve a browser-safe entry point.

### Browser-safe features

All visualization features work in browser:

```typescript
import {
  createVisualizer,
  createEventCollector,
  combineEventHandlers,
  visualizeEvents,
  trackIf,
  trackSwitch,
  trackDecision,
  asciiRenderer,
  mermaidRenderer,
  htmlRenderer,
  createTimeTravelController,
  createPerformanceAnalyzer,
} from 'awaitly-visualizer';
```

### Node.js-only features

These features require Node.js and throw helpful errors in browser:

| Feature | Reason | Browser Error |
|---------|--------|---------------|
| `createLiveVisualizer` | Uses `process.stdout` | "createLiveVisualizer is not available in browser..." |
| `fetchKrokiSvg/Png` | Uses Node.js Buffer | Import from `awaitly-visualizer/kroki-fetch` |

### Type-only imports

You can still import types for Node-only features in browser code:

```typescript
import type { LiveVisualizer } from 'awaitly-visualizer';

// Types work fine - only runtime calls throw
```

### React/Vue/Svelte usage

Use visualization in frontend frameworks:

```typescript
// React example
import { useState, useEffect } from 'react';
import { createVisualizer } from 'awaitly-visualizer';
import { createWorkflow } from 'awaitly/workflow';

function WorkflowDashboard() {
  const [output, setOutput] = useState('');

  useEffect(() => {
    const viz = createVisualizer({ workflowName: 'dashboard' });
    const workflow = createWorkflow(deps, {
      onEvent: viz.handleEvent,
    });

    workflow(async (step) => {
      await step('fetchData', () => fetchData(), { name: 'Fetch data' });
    }).then(() => {
      setOutput(viz.renderAs('mermaid'));
    });
  }, []);

  return <pre>{output}</pre>;
}
```

## Next

[Learn about Testing →](/guides/testing/)
