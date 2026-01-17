/**
 * Workflow Visualization Module
 *
 * Provides tools for visualizing workflow execution with color-coded
 * step states and support for parallel/race operations.
 *
 * @example
 * ```typescript
 * import { createVisualizer } from 'awaitly/visualize';
 *
 * const viz = createVisualizer({ workflowName: 'checkout' });
 * const workflow = createWorkflow(deps, { onEvent: viz.handleEvent });
 *
 * await workflow(async (step) => {
 *   await step(() => validateCart(cart), 'Validate cart');
 *   await step(() => processPayment(payment), 'Process payment');
 * });
 *
 * console.log(viz.render());
 * ```
 */

import type { WorkflowEvent } from "../core";
import type {
  OutputFormat,
  RenderOptions,
  ScopeEndEvent,
  ScopeStartEvent,
  DecisionStartEvent,
  DecisionBranchEvent,
  DecisionEndEvent,
  VisualizerOptions,
  WorkflowIR,
} from "./types";
import { createIRBuilder } from "./ir-builder";
import { asciiRenderer, mermaidRenderer, loggerRenderer, flowchartRenderer, defaultColorScheme } from "./renderers";

// =============================================================================
// Re-exports
// =============================================================================

export * from "./types";
export { createIRBuilder, type IRBuilderOptions } from "./ir-builder";
export { asciiRenderer, mermaidRenderer, loggerRenderer, flowchartRenderer, defaultColorScheme } from "./renderers";
export type { LoggerOutput, LoggerRenderOptions, StepLog, HookLog, WorkflowSummary } from "./renderers";
export { htmlRenderer, renderToHTML } from "./renderers/html";
export { detectParallelGroups, createParallelDetector, type ParallelDetectorOptions } from "./parallel-detector";
export { createLiveVisualizer, type LiveVisualizer } from "./live-visualizer";
export { trackDecision, trackIf, trackSwitch, type DecisionTracker, type IfTracker, type SwitchTracker } from "./decision-tracker";

// Time-travel debugging
export {
  createTimeTravelController,
  type TimeTravelController,
  type TimeTravelOptions,
} from "./time-travel";

// Performance analysis
export {
  createPerformanceAnalyzer,
  getHeatLevel,
  type PerformanceAnalyzer,
  type WorkflowRun,
} from "./performance-analyzer";

// Dev server (WebSocket-based live visualization)
// Note: ws is an optional peer dependency
export {
  createDevServer,
  type DevServer,
  type DevServerOptions,
} from "./dev-server";

// =============================================================================
// Visualizer Interface
// =============================================================================

/**
 * Workflow visualizer that processes events and renders output.
 */
export interface WorkflowVisualizer {
  /** Process a workflow event */
  handleEvent: (event: WorkflowEvent<unknown>) => void;

  /** Process a scope event (parallel/race) */
  handleScopeEvent: (event: ScopeStartEvent | ScopeEndEvent) => void;

  /** Process a decision event (conditional branches) */
  handleDecisionEvent: (event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent) => void;

  /** Get current IR state */
  getIR: () => WorkflowIR;

  /** Render current state using the default renderer */
  render: () => string;

  /** Render to a specific format */
  renderAs: (format: OutputFormat) => string;

  /** Reset state for a new workflow */
  reset: () => void;

  /** Subscribe to IR updates (for live visualization) */
  onUpdate: (callback: (ir: WorkflowIR) => void) => () => void;
}

// =============================================================================
// Create Visualizer
// =============================================================================

/**
 * Create a workflow visualizer.
 *
 * @example
 * ```typescript
 * const viz = createVisualizer({ workflowName: 'my-workflow' });
 *
 * const workflow = createWorkflow(deps, {
 *   onEvent: viz.handleEvent,
 * });
 *
 * await workflow(async (step) => { ... });
 *
 * console.log(viz.render());
 * ```
 */
export function createVisualizer(
  options: VisualizerOptions = {}
): WorkflowVisualizer {
  const {
    workflowName,
    detectParallel = true,
    showTimings = true,
    showKeys = false,
    colors: customColors,
  } = options;

  const builder = createIRBuilder({ detectParallel });
  const updateCallbacks: Set<(ir: WorkflowIR) => void> = new Set();

  // Renderers
  const ascii = asciiRenderer();
  const mermaid = mermaidRenderer();
  const logger = loggerRenderer();
  const flowchart = flowchartRenderer();

  // Build render options
  const renderOptions: RenderOptions = {
    showTimings,
    showKeys,
    terminalWidth: process.stdout?.columns ?? 80,
    colors: { ...defaultColorScheme, ...customColors },
  };

  function notifyUpdate(): void {
    if (updateCallbacks.size > 0) {
      const ir = builder.getIR();
      for (const callback of updateCallbacks) {
        callback(ir);
      }
    }
  }

  function handleEvent(event: WorkflowEvent<unknown>): void {
    // Route scope events to handleScopeEvent for proper IR building
    if (event.type === "scope_start" || event.type === "scope_end") {
      handleScopeEvent(event as ScopeStartEvent | ScopeEndEvent);
      return;
    }

    builder.handleEvent(event);

    // Set workflow name if provided
    if (event.type === "workflow_start" && workflowName) {
      // Note: We'd need to extend the builder to support setting name
      // For now, the name is passed in render options
    }

    notifyUpdate();
  }

  function handleScopeEvent(event: ScopeStartEvent | ScopeEndEvent): void {
    builder.handleScopeEvent(event);
    notifyUpdate();
  }

  function handleDecisionEvent(
    event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent
  ): void {
    builder.handleDecisionEvent(event);
    notifyUpdate();
  }

  function getIR(): WorkflowIR {
    const ir = builder.getIR();
    // Apply workflow name if provided
    if (workflowName && !ir.root.name) {
      ir.root.name = workflowName;
    }
    return ir;
  }

  function render(): string {
    const ir = getIR();
    return ascii.render(ir, renderOptions);
  }

  function renderAs(format: OutputFormat): string {
    const ir = getIR();

    switch (format) {
      case "ascii":
        return ascii.render(ir, renderOptions);

      case "mermaid":
        return mermaid.render(ir, renderOptions);

      case "json":
        return JSON.stringify(ir, null, 2);

      case "logger":
        return logger.render(ir, renderOptions);

      case "flowchart":
        return flowchart.render(ir, renderOptions);

      default:
        throw new Error(`Unknown format: ${format}`);
    }
  }

  function reset(): void {
    builder.reset();
    notifyUpdate();
  }

  function onUpdate(callback: (ir: WorkflowIR) => void): () => void {
    updateCallbacks.add(callback);
    return () => updateCallbacks.delete(callback);
  }

  return {
    handleEvent,
    handleScopeEvent,
    handleDecisionEvent,
    getIR,
    render,
    renderAs,
    reset,
    onUpdate,
  };
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Union type for all collectable/visualizable events (workflow + decision).
 */
export type CollectableEvent =
  | WorkflowEvent<unknown>
  | DecisionStartEvent
  | DecisionBranchEvent
  | DecisionEndEvent;

/**
 * Visualize collected events (post-execution).
 *
 * Supports both workflow events (from onEvent) and decision events
 * (from trackDecision/trackIf/trackSwitch).
 *
 * @example
 * ```typescript
 * const events: CollectableEvent[] = [];
 * const workflow = createWorkflow(deps, {
 *   onEvent: (e) => events.push(e),
 * });
 *
 * await workflow(async (step) => {
 *   const decision = trackIf('check', condition, {
 *     emit: (e) => events.push(e),
 *   });
 *   // ...
 * });
 *
 * console.log(visualizeEvents(events));
 * ```
 */
export function visualizeEvents(
  events: CollectableEvent[],
  options: VisualizerOptions = {}
): string {
  const viz = createVisualizer(options);

  for (const event of events) {
    if (event.type.startsWith("decision_")) {
      viz.handleDecisionEvent(event as DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent);
    } else {
      viz.handleEvent(event as WorkflowEvent<unknown>);
    }
  }

  return viz.render();
}

/**
 * Create an event collector for later visualization.
 *
 * Supports both workflow events (from onEvent) and decision events
 * (from trackDecision/trackIf/trackSwitch).
 *
 * @example
 * ```typescript
 * const collector = createEventCollector();
 *
 * const workflow = createWorkflow(deps, {
 *   onEvent: collector.handleEvent,
 * });
 *
 * await workflow(async (step) => {
 *   // Decision events can also be collected
 *   const decision = trackIf('check', condition, {
 *     emit: collector.handleDecisionEvent,
 *   });
 *   // ...
 * });
 *
 * console.log(collector.visualize());
 * ```
 */
export function createEventCollector(options: VisualizerOptions = {}) {
  const events: CollectableEvent[] = [];

  return {
    /** Handle a workflow event */
    handleEvent: (event: WorkflowEvent<unknown>) => {
      events.push(event);
    },

    /** Handle a decision event */
    handleDecisionEvent: (event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent) => {
      events.push(event);
    },

    /** Get all collected events */
    getEvents: () => [...events],

    /** Get workflow events only */
    getWorkflowEvents: () => events.filter((e): e is WorkflowEvent<unknown> =>
      !e.type.startsWith("decision_")
    ),

    /** Get decision events only */
    getDecisionEvents: () => events.filter((e): e is DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent =>
      e.type.startsWith("decision_")
    ),

    /** Clear collected events */
    clear: () => {
      events.length = 0;
    },

    /** Visualize collected events */
    visualize: () => {
      const viz = createVisualizer(options);
      for (const event of events) {
        if (event.type.startsWith("decision_")) {
          viz.handleDecisionEvent(event as DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent);
        } else {
          viz.handleEvent(event as WorkflowEvent<unknown>);
        }
      }
      return viz.render();
    },

    /** Visualize in a specific format */
    visualizeAs: (format: OutputFormat) => {
      const viz = createVisualizer(options);
      for (const event of events) {
        if (event.type.startsWith("decision_")) {
          viz.handleDecisionEvent(event as DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent);
        } else {
          viz.handleEvent(event as WorkflowEvent<unknown>);
        }
      }
      return viz.renderAs(format);
    },
  };
}

