/**
 * Workflow Visualization Module
 *
 * Provides tools for visualizing workflow execution with color-coded
 * step states and support for parallel/race operations.
 *
 * @example
 * ```typescript
 * import { createVisualizer } from 'awaitly-visualizer';
 *
 * const viz = createVisualizer({ workflowName: 'checkout' });
 * const workflow = createWorkflow(deps, { onEvent: viz.handleEvent });
 *
 * await workflow.run(async ({ step }) => {
 *   await step(() => validateCart(cart), 'Validate cart');
 *   await step(() => processPayment(payment), 'Process payment');
 * });
 *
 * console.log(viz.render());
 * ```
 */

import type { WorkflowEvent } from "awaitly/workflow";
import type { UnexpectedError } from "awaitly/core";
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
  ExportFormat,
  ExportOptions,
  DiagramSource,
} from "./types";
import { createIRBuilder } from "./ir-builder";
import { asciiRenderer, mermaidRenderer, loggerRenderer, flowchartRenderer, defaultColorScheme } from "./renderers";
import { toExportUrl } from "./export/to-url";

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

// Kroki URL generation (browser + Node safe)
export {
  toKrokiUrl,
  toKrokiSvgUrl,
  toKrokiPngUrl,
  createUrlGenerator,
  type KrokiFormat,
  type UrlGeneratorOptions,
} from "./kroki/url";

// Mermaid.ink URL generation (browser + Node safe)
export {
  toMermaidInkUrl,
  toMermaidInkSvgUrl,
  toMermaidInkPngUrl,
  toMermaidInkJpegUrl,
  toMermaidInkWebpUrl,
  toMermaidInkPdfUrl,
  createMermaidInkGenerator,
  encodeForMermaidInk,
  buildMermaidInkUrl,
  type MermaidInkFormat,
  type MermaidInkImageType,
  type MermaidInkTheme,
  type MermaidInkPaperSize,
  type MermaidInkOptions,
  type MermaidInkGenerator,
} from "./kroki/mermaid-ink";

// Re-export notifier provider types for convenience
export type {
  DiagramProvider,
  ProviderOptions,
  KrokiProviderOptions,
  MermaidInkProviderOptions,
} from "./notifiers/types";

// Export URL generation
export { toExportUrl } from "./export/to-url";

// Interactive Mermaid CDN HTML generation
export {
  generateInteractiveHTML,
  escapeHtml,
  type NodeMetadata,
  type WorkflowMetadata,
  type InteractiveHTMLOptions,
  type MermaidHTMLSourceLocation,
  type MermaidHTMLRetryConfig,
  type MermaidHTMLTimeoutConfig,
} from "./mermaid-html";

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

  /**
   * Generate export URL for the current workflow diagram.
   * Requires explicit provider unless export.default is configured.
   *
   * @param format - Export format (svg, png, pdf)
   * @param options - Provider options (required unless default configured)
   * @returns The export URL
   * @throws If no provider configured and none passed
   * @throws If format not supported by provider
   */
  toUrl: (format: ExportFormat, options?: ExportOptions) => string;

  /**
   * Generate SVG export URL for the current workflow diagram.
   * Requires explicit provider unless export.default is configured.
   *
   * @param options - Provider options (required unless default configured)
   * @returns The SVG export URL
   * @throws If no provider configured and none passed
   */
  toSvgUrl: (options?: ExportOptions) => string;

  /**
   * Generate PNG export URL for the current workflow diagram.
   * Requires explicit provider unless export.default is configured.
   *
   * @param options - Provider options (required unless default configured)
   * @returns The PNG export URL
   * @throws If no provider configured and none passed
   */
  toPngUrl: (options?: ExportOptions) => string;

  /**
   * Generate PDF export URL for the current workflow diagram.
   * Requires explicit provider unless export.default is configured.
   * Note: Kroki does not support PDF for mermaid diagrams.
   *
   * @param options - Provider options (required unless default configured)
   * @returns The PDF export URL
   * @throws If no provider configured and none passed
   * @throws If provider doesn't support PDF (e.g., Kroki for mermaid)
   */
  toPdfUrl: (options?: ExportOptions) => string;
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
 * await workflow.run(async ({ step }) => { ... });
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
    export: exportConfig,
  } = options;

  const builder = createIRBuilder({ detectParallel });
  const updateCallbacks: Set<(ir: WorkflowIR) => void> = new Set();
  let nameFromEvent: string | undefined;

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
      const ir = getIR();
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

    if ("workflowName" in event && typeof (event as { workflowName?: string }).workflowName === "string") {
      nameFromEvent = (event as { workflowName: string }).workflowName;
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
    const name = workflowName ?? nameFromEvent ?? ir.root.name;
    if (name) {
      ir.root.name = name;
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

      case "json": {
        // Convert Map (hooks.onAfterStep) to plain object so JSON.stringify serializes it; accept plain object (e.g. from JSON)
        const toSerialize = ir.hooks
          ? {
              ...ir,
              hooks: {
                ...ir.hooks,
                onAfterStep:
                  ir.hooks.onAfterStep instanceof Map
                    ? Object.fromEntries(ir.hooks.onAfterStep)
                    : ir.hooks.onAfterStep ?? {},
              },
            }
          : ir;
        // Replacer: BigInt and other non-JSON values (e.g. decisionValue) so output is robust
        const replacer = (_key: string, value: unknown): unknown =>
          typeof value === "bigint" ? value.toString() : value;
        return JSON.stringify(toSerialize, replacer, 2);
      }

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

  // ==========================================================================
  // Export URL Methods
  // ==========================================================================

  function resolveExportOptions(
    opts: ExportOptions | undefined,
    methodName: string
  ): ExportOptions {
    if (opts) return opts;
    if (exportConfig?.default) return exportConfig.default;
    throw new Error(
      `${methodName}(): No export provider configured. ` +
        `Pass { provider: 'kroki' } or { provider: 'mermaid-ink' }, ` +
        `or set export.default in createVisualizer().`
    );
  }

  function getDiagramSource(): DiagramSource {
    const ir = getIR();
    const source = mermaid.render(ir, renderOptions);
    return { kind: "mermaid", source };
  }

  function toSvgUrl(opts?: ExportOptions): string {
    const result = toExportUrl(
      getDiagramSource(),
      "svg",
      resolveExportOptions(opts, "toSvgUrl"),
      { caller: "toSvgUrl" }
    );
    if (!result.ok) {
      throw new Error(`toSvgUrl: Export failed - ${result.error}`);
    }
    return result.value;
  }

  function toPngUrl(opts?: ExportOptions): string {
    const result = toExportUrl(
      getDiagramSource(),
      "png",
      resolveExportOptions(opts, "toPngUrl"),
      { caller: "toPngUrl" }
    );
    if (!result.ok) {
      throw new Error(`toPngUrl: Export failed - ${result.error}`);
    }
    return result.value;
  }

  function toPdfUrl(opts?: ExportOptions): string {
    const result = toExportUrl(
      getDiagramSource(),
      "pdf",
      resolveExportOptions(opts, "toPdfUrl"),
      { caller: "toPdfUrl" }
    );
    if (!result.ok) {
      throw new Error(`toPdfUrl: Export failed - ${result.error}`);
    }
    return result.value;
  }

  function toUrl(format: ExportFormat, opts?: ExportOptions): string {
    switch (format) {
      case "svg":
        return toSvgUrl(opts);
      case "png":
        return toPngUrl(opts);
      case "pdf":
        return toPdfUrl(opts);
      default: {
        const _exhaustive: never = format;
        return _exhaustive;
      }
    }
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
    toUrl,
    toSvgUrl,
    toPngUrl,
    toPdfUrl,
  };
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Combine multiple event handlers into one.
 * Use when you need visualization + logging + custom handlers.
 *
 * @example
 * ```typescript
 * const viz = createVisualizer({ workflowName: 'checkout' });
 * const workflow = createWorkflow(deps, {
 *   onEvent: combineEventHandlers(
 *     viz.handleEvent,
 *     (e) => console.log(e.type),
 *     (e) => metrics.track(e),
 *   ),
 * });
 * ```
 */
export function combineEventHandlers<E = unknown, C = void>(
  ...handlers: Array<(event: WorkflowEvent<E, C>, ctx?: C) => void>
): (event: WorkflowEvent<E, C>, ctx: C) => void {
  return (event, ctx) => {
    for (const handler of handlers) {
      handler(event, ctx);
    }
  };
}

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
 * await workflow.run(async ({ step }) => {
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
 * await workflow.run(async ({ step }) => {
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
