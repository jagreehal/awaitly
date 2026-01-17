# Logging Workflow Events to Pino

Workflow events are structured JSON objects that work perfectly with Pino's structured logging.

## Using `renderAs('logger')` (Recommended)

The easiest way to log workflow data is using the built-in logger renderer:

```typescript
import { createWorkflow } from 'awaitly'; import { createVisualizer } from 'awaitly/visualize';
import pino from 'pino';

const logger = pino();
const viz = createVisualizer({ workflowName: 'checkout' });

const workflow = createWorkflow({ fetchUser, processPayment }, {
  onEvent: viz.handleEvent,
});

const result = await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { name: 'Fetch user' });
  await step(() => processPayment(user.id), { name: 'Process payment' });
});

// Log structured workflow data
// Note: renderAs() returns a JSON string for API consistency across renderers
const logData = JSON.parse(viz.renderAs('logger'));
logger.info(logData, 'Workflow completed');
```

### Logger Output

The renderer returns this structure (Pino will add `level`, `time`, and `msg` when logging):

```json
{
  "workflow": {
    "id": "8757b92c-d415-4555-93cd-37076cbec9ee",
    "name": "checkout",
    "state": "success",
    "durationMs": 33,
    "startedAt": 1768506411038
  },
  "steps": [
    {
      "id": "user:1",
      "name": "Fetch user",
      "state": "success",
      "durationMs": 11
    },
    {
      "id": "payment:1",
      "name": "Process payment",
      "state": "success",
      "durationMs": 21,
      "retryCount": 1
    }
  ],
  "summary": {
    "totalSteps": 2,
    "successCount": 2,
    "errorCount": 0,
    "cacheHits": 0,
    "totalRetries": 1,
    "slowestStep": { "name": "Process payment", "durationMs": 21 }
  },
  "diagram": "┌── checkout ─────────────────────┐\n│  ✓ Fetch user [11ms]           │\n│  ✓ Process payment [21ms]      │\n└─────────────────────────────────┘"
}
```

### Works With Any Logger

The logger renderer is logger-agnostic:

```typescript
// Pino
logger.info(JSON.parse(viz.renderAs('logger')), 'Workflow completed');

// Winston
logger.info('Workflow completed', JSON.parse(viz.renderAs('logger')));

// Console
console.log('Workflow completed:', JSON.parse(viz.renderAs('logger')));

// OpenTelemetry
span.addEvent('workflow_completed', JSON.parse(viz.renderAs('logger')));
```

### Why Use `renderAs('logger')`?

- **Structured data**: Workflow state, step details, and summary stats as queryable fields
- **Summary calculations**: Slowest step, retry counts, error counts computed for you
- **ASCII diagram included**: ANSI colors stripped for clean JSON
- **One call**: No need to parse events manually

### When to Use Each Approach

| Use Case | Recommended Approach |
|----------|---------------------|
| Log workflow summary after completion | `renderAs('logger')` |
| Need custom filtering of steps/events | Manual approach |
| Real-time logging during execution | Manual approach with `onEvent` |
| Just want structured output quickly | `renderAs('logger')` |
| Need to transform events before logging | Manual approach |

---

## Manual Approach (More Control)

For more control over what gets logged, you can collect events manually.

## Basic Example

```typescript
import { createWorkflow } from 'awaitly'; import { createEventCollector } from 'awaitly/visualize';
import pino from 'pino';

const logger = pino();

const collector = createEventCollector();
const workflow = createWorkflow({ fetchUser, fetchPosts }, {
  onEvent: collector.handleEvent,
});

const result = await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { name: 'Fetch user' });
  const posts = await step(() => fetchPosts(user.id), { name: 'Fetch posts' });
  return { user, posts };
});

// After workflow completes, log all events
const events = collector.getWorkflowEvents();

// Log summary
if (result.ok) {
  logger.info({
    workflowId: events[0]?.workflowId,
    duration: events.find(e => e.type === 'workflow_success')?.durationMs,
    stepCount: events.filter(e => e.type === 'step_success').length,
  }, 'Workflow completed successfully');
} else {
  logger.error({
    workflowId: events[0]?.workflowId,
    error: result.error,
    duration: events.find(e => e.type === 'workflow_error')?.durationMs,
  }, 'Workflow failed');
}

// Log all events (optional - can be verbose)
events.forEach(event => {
  logger.debug({ event }, 'Workflow event');
});
```

## Pino Output Format

Pino will serialize workflow events as clean JSON. Here's what the output looks like:

```json
{
  "level": 30,
  "time": 1704067200000,
  "workflowId": "abc-123",
  "duration": 245,
  "stepCount": 2,
  "msg": "Workflow completed successfully"
}
```

For individual events:

```json
{
  "level": 20,
  "time": 1704067200000,
  "event": {
    "type": "step_success",
    "workflowId": "abc-123",
    "stepId": "step-1",
    "name": "Fetch user",
    "stepKey": "user:1",
    "ts": 1704067200100,
    "durationMs": 45,
    "context": {
      "requestId": "req-456",
      "userId": "user-789"
    }
  },
  "msg": "Workflow event"
}
```

## Helper Function

Create a reusable Pino logger helper:

```typescript
import { createEventCollector } from 'awaitly/visualize'; import { type WorkflowEvent } from 'awaitly';
import pino from 'pino';

export function createPinoLogger(logger: pino.Logger) {
  const collector = createEventCollector();

  return {
    handleEvent: collector.handleEvent,
    
    logAfterCompletion: (result: { ok: boolean; error?: unknown }) => {
      const events = collector.getWorkflowEvents();
      const workflowId = events[0]?.workflowId;
      
      // Find workflow completion event
      const completion = events.find(
        e => e.type === 'workflow_success' || e.type === 'workflow_error'
      );
      
      if (result.ok && completion?.type === 'workflow_success') {
        logger.info({
          workflowId,
          duration: completion.durationMs,
          stepCount: events.filter(e => e.type === 'step_success').length,
          cacheHits: events.filter(e => e.type === 'step_cache_hit').length,
          context: completion.context,
        }, 'Workflow completed');
      } else if (!result.ok && completion?.type === 'workflow_error') {
        logger.error({
          workflowId,
          error: result.error,
          duration: completion.durationMs,
          failedStep: events.find(e => e.type === 'step_error')?.name,
          context: completion.context,
        }, 'Workflow failed');
      }
      
      // Log slow steps
      events
        .filter((e): e is WorkflowEvent<unknown> & { durationMs: number } => 
          e.type === 'step_success' && e.durationMs > 1000
        )
        .forEach(step => {
          logger.warn({
            workflowId,
            stepName: step.name,
            stepKey: step.stepKey,
            duration: step.durationMs,
          }, 'Slow step detected');
        });
      
      // Log retries
      events
        .filter(e => e.type === 'step_retry')
        .forEach(retry => {
          logger.warn({
            workflowId,
            stepName: retry.name,
            attempt: retry.attempt,
            maxAttempts: retry.maxAttempts,
            error: retry.error,
          }, 'Step retry');
        });
    },
  };
}

// Usage
const pinoLogger = createPinoLogger(pino());
const workflow = createWorkflow(deps, {
  onEvent: pinoLogger.handleEvent,
});

const result = await workflow(async (step) => {
  // ... workflow logic
});

pinoLogger.logAfterCompletion(result);
```

## Why This Works Well

1. **Structured Events**: All workflow events are plain objects with consistent properties
2. **JSON-Serializable**: Events contain only JSON-safe values (strings, numbers, booleans, objects)
3. **Context Support**: Events include `context` field for correlation IDs, user IDs, etc.
4. **Type Safety**: TypeScript knows all event properties
5. **Pino-Friendly**: Pino automatically serializes objects - no custom formatting needed

## Logging ASCII Visualization

You can log the ASCII diagram directly to Pino:

```typescript
import { createWorkflow } from 'awaitly'; import { createVisualizer } from 'awaitly/visualize';
import pino from 'pino';

const logger = pino();
const viz = createVisualizer({ workflowName: 'checkout' });

const workflow = createWorkflow({ fetchUser, fetchPosts }, {
  onEvent: viz.handleEvent,
});

const result = await workflow(async (step) => {
  const user = await step(() => fetchUser('1'), { name: 'Fetch user' });
  const posts = await step(() => fetchPosts(user.id), { name: 'Fetch posts' });
  return { user, posts };
});

// Log ASCII visualization
const asciiDiagram = viz.render();
logger.info({
  workflowId: result.ok ? 'success' : 'failed',
  visualization: asciiDiagram,
}, 'Workflow completed');
```

### Pino Output with ASCII

In JSON format, the ASCII will be escaped with `\n`:

```json
{
  "level": 30,
  "time": 1704067200000,
  "workflowId": "success",
  "visualization": "┌── checkout ───────────────────────────────┐\n│                                          │\n│  ✓ Fetch user [45ms]                    │\n│  ✓ Fetch posts [67ms]                   │\n│                                          │\n│  Completed in 112ms                     │\n│                                          │\n└──────────────────────────────────────────┘",
  "msg": "Workflow completed"
}
```

### With pino-pretty

When using `pino-pretty` or viewing in a terminal, the ASCII renders correctly:

```
[2024-01-01 12:00:00] INFO: Workflow completed
    workflowId: "success"
    visualization: "
┌── checkout ───────────────────────────────┐
│                                          │
│  ✓ Fetch user [45ms]                    │
│  ✓ Fetch posts [67ms]                   │
│                                          │
│  Completed in 112ms                     │
│                                          │
└──────────────────────────────────────────┘
"
```

### ANSI Colors

The ASCII output includes ANSI color codes. They work in:
- ✅ Terminal output (pino-pretty, console)
- ✅ Log viewers that support ANSI (most modern ones)
- ⚠️ Raw JSON logs (colors are included as escape sequences)

To strip colors for cleaner JSON logs:

```typescript
// Simple regex to strip ANSI codes
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

const asciiDiagram = viz.render();
const asciiWithoutColors = stripAnsi(asciiDiagram);

logger.info({
  visualization: asciiWithoutColors, // Clean box-drawing, no ANSI codes
}, 'Workflow completed');
```

**Note:** The ASCII output includes ANSI color codes. They render correctly in terminals and log viewers that support ANSI (like `pino-pretty`), but appear as escape sequences in raw JSON logs. Use `stripAnsi()` if you want clean box-drawing characters without color codes.

## Example Output

```json
{
  "level": 30,
  "time": 1704067200000,
  "workflowId": "checkout-abc-123",
  "duration": 1234,
  "stepCount": 5,
  "cacheHits": 2,
  "context": {
    "requestId": "req-456",
    "userId": "user-789",
    "orderId": "order-123"
  },
  "msg": "Workflow completed"
}
```

The format looks great in Pino because:
- All fields are at the top level (easy to query/filter)
- Context is nested but accessible
- Duration and counts are numeric (good for metrics)
- Error objects serialize cleanly
- ASCII visualization can be included as a multi-line string field
