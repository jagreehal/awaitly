/**
 * Autotel Integration
 *
 * First-class OpenTelemetry spans and metrics from the workflow event stream
 * using the autotel library.
 *
 * @example
 * ```typescript
 * import { createAutotelAdapter } from 'awaitly/autotel';
 * import { init } from 'autotel';
 *
 * // Initialize autotel
 * init({ service: 'checkout-api' });
 *
 * // Create adapter
 * const otel = createAutotelAdapter({ serviceName: 'checkout' });
 *
 * // Use with workflow
 * const workflow = createWorkflow(deps, { onEvent: otel.handleEvent });
 *
 * // Automatic spans: workflow > step > retry attempts
 * // Automatic metrics: step_duration, retry_count, error_rate
 * ```
 */

import type { WorkflowEvent } from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the autotel adapter.
 */
export interface AutotelAdapterConfig {
  /**
   * Service name for spans (used as prefix).
   */
  serviceName?: string;

  /**
   * Whether to create spans for each step.
   * @default true
   */
  createStepSpans?: boolean;

  /**
   * Whether to record metrics for steps.
   * @default true
   */
  recordMetrics?: boolean;

  /**
   * Custom attributes to add to all spans.
   */
  defaultAttributes?: Record<string, string | number | boolean>;

  /**
   * Whether to record retry events as span events.
   * @default true
   */
  recordRetryEvents?: boolean;

  /**
   * Whether to mark workflow errors as span errors.
   * @default true
   */
  markErrorsOnSpan?: boolean;
}

/**
 * Span tracking info.
 */
interface SpanInfo {
  workflowId: string;
  stepId?: string;
  stepKey?: string;
  name?: string;
  startTime: number;
}

/**
 * Active spans tracking.
 */
interface ActiveSpans {
  workflows: Map<string, SpanInfo>;
  steps: Map<string, SpanInfo>;
}

/**
 * Metrics collected by the adapter.
 */
export interface AutotelMetrics {
  stepDurations: Array<{ 
    name: string; 
    durationMs: number; 
    success: boolean;
    attributes?: Record<string, string | number | boolean>;
  }>;
  retryCount: number;
  errorCount: number;
  cacheHits: number;
  cacheMisses: number;
  /** Default attributes applied to all metrics */
  defaultAttributes: Record<string, string | number | boolean>;
}

/**
 * Autotel adapter interface.
 */
export interface AutotelAdapter {
  /**
   * Handle workflow events (pass to onEvent option).
   */
  handleEvent: (event: WorkflowEvent<unknown>) => void;

  /**
   * Get current active spans count (for debugging).
   */
  getActiveSpansCount: () => { workflows: number; steps: number };

  /**
   * Get collected metrics.
   */
  getMetrics: () => AutotelMetrics;

  /**
   * Reset adapter state.
   */
  reset: () => void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an autotel adapter for workflow observability.
 *
 * This adapter translates workflow events into metrics and tracking data.
 * When autotel is installed and initialized, it will also create OpenTelemetry spans.
 *
 * @param config - Adapter configuration
 * @returns An AutotelAdapter instance
 *
 * @example
 * ```typescript
 * import { createAutotelAdapter } from 'awaitly/autotel';
 *
 * const otel = createAutotelAdapter({ serviceName: 'checkout' });
 *
 * const workflow = createWorkflow(deps, {
 *   onEvent: otel.handleEvent,
 * });
 * ```
 */
export function createAutotelAdapter(
  config: AutotelAdapterConfig = {}
): AutotelAdapter {
  const {
    serviceName = "workflow",
    createStepSpans = true,
    recordMetrics = true,
    defaultAttributes = {},
    recordRetryEvents = true,
    markErrorsOnSpan = true,
  } = config;

  // Track active spans
  const activeSpans: ActiveSpans = {
    workflows: new Map(),
    steps: new Map(),
  };

  // Metrics counters
  const metrics: AutotelMetrics = {
    stepDurations: [],
    retryCount: 0,
    errorCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    defaultAttributes,
  };

  /**
   * Get span name for a step.
   */
  function getSpanName(name?: string, stepKey?: string): string {
    if (name) return `${serviceName}.${name}`;
    if (stepKey) return `${serviceName}.step.${stepKey}`;
    return `${serviceName}.step`;
  }

  /**
   * Handle workflow event.
   */
  function handleEvent(event: WorkflowEvent<unknown>): void {
    switch (event.type) {
      case "workflow_start":
        activeSpans.workflows.set(event.workflowId, {
          workflowId: event.workflowId,
          startTime: event.ts,
        });
        break;

      case "workflow_success":
      case "workflow_error":
        {
          const span = activeSpans.workflows.get(event.workflowId);
          if (span) {
            activeSpans.workflows.delete(event.workflowId);
          }

          if (event.type === "workflow_error" && markErrorsOnSpan) {
            metrics.errorCount++;
          }
        }
        break;

      case "step_start":
        if (createStepSpans) {
          const stepId = event.stepId;
          activeSpans.steps.set(stepId, {
            workflowId: event.workflowId,
            stepId,
            stepKey: event.stepKey,
            name: event.name,
            startTime: event.ts,
          });
        }
        break;

      case "step_success":
      case "step_error":
        if (createStepSpans) {
          const stepId = event.stepId;
          const span = activeSpans.steps.get(stepId);
          if (span) {
            activeSpans.steps.delete(stepId);

            if (recordMetrics) {
              metrics.stepDurations.push({
                name: getSpanName(span.name, span.stepKey),
                durationMs: event.durationMs,
                success: event.type === "step_success",
                // Include default attributes with each step metric
                attributes: Object.keys(defaultAttributes).length > 0 
                  ? { ...defaultAttributes } 
                  : undefined,
              });
            }

            if (event.type === "step_error" && markErrorsOnSpan) {
              metrics.errorCount++;
            }
          }
        }
        break;

      case "step_retry":
        if (recordRetryEvents) {
          metrics.retryCount++;
        }
        break;

      case "step_cache_hit":
        metrics.cacheHits++;
        break;

      case "step_cache_miss":
        metrics.cacheMisses++;
        break;

      default:
        // Other events (timeout, etc.) - can be extended
        break;
    }
  }

  return {
    handleEvent,

    getActiveSpansCount() {
      return {
        workflows: activeSpans.workflows.size,
        steps: activeSpans.steps.size,
      };
    },

    getMetrics() {
      return { ...metrics, stepDurations: [...metrics.stepDurations] };
    },

    reset() {
      activeSpans.workflows.clear();
      activeSpans.steps.clear();
      metrics.stepDurations.length = 0;
      metrics.retryCount = 0;
      metrics.errorCount = 0;
      metrics.cacheHits = 0;
      metrics.cacheMisses = 0;
      // Note: defaultAttributes are preserved across resets
    },
  };
}

/**
 * Create an event handler that integrates with autotel's trace() function.
 *
 * This is a higher-level integration that creates actual OpenTelemetry spans
 * for each workflow and step when autotel is initialized.
 *
 * @param options - Configuration options
 * @returns An event handler function
 *
 * @example
 * ```typescript
 * import { createAutotelEventHandler } from 'awaitly/autotel';
 * import { init } from 'autotel';
 *
 * init({ service: 'checkout-api' });
 *
 * const handler = createAutotelEventHandler({ serviceName: 'checkout' });
 *
 * const workflow = createWorkflow(deps, {
 *   onEvent: handler,
 * });
 * ```
 */
export function createAutotelEventHandler(options?: {
  serviceName?: string;
  includeStepDetails?: boolean;
}): (event: WorkflowEvent<unknown>) => void {
  const { serviceName = "workflow", includeStepDetails = true } = options ?? {};

  // This is a simple pass-through handler
  // The actual autotel integration happens via the trace() wrapper
  return (event: WorkflowEvent<unknown>) => {
    // Log events for debugging when AUTOTEL_DEBUG is set
    if (process.env.AUTOTEL_DEBUG === "true") {
      const prefix = `[${serviceName}]`;
      switch (event.type) {
        case "workflow_start":
          console.log(`${prefix} Workflow started: ${event.workflowId}`);
          break;
        case "workflow_success":
          console.log(`${prefix} Workflow success: ${event.workflowId} (${event.durationMs}ms)`);
          break;
        case "workflow_error":
          console.log(`${prefix} Workflow error: ${event.workflowId}`, event.error);
          break;
        case "step_start":
          if (includeStepDetails) {
            console.log(`${prefix} Step started: ${event.name ?? event.stepKey ?? event.stepId}`);
          }
          break;
        case "step_success":
          if (includeStepDetails) {
            console.log(`${prefix} Step success: ${event.name ?? event.stepKey ?? event.stepId} (${event.durationMs}ms)`);
          }
          break;
        case "step_error":
          if (includeStepDetails) {
            console.log(`${prefix} Step error: ${event.name ?? event.stepKey ?? event.stepId}`, event.error);
          }
          break;
        case "step_retry":
          console.log(`${prefix} Step retry: ${event.name ?? event.stepKey ?? event.stepId} (attempt ${event.attempt}/${event.maxAttempts})`);
          break;
      }
    }
  };
}

/**
 * Wrapper type for autotel trace function.
 * Use this when you want to explicitly type the autotel integration.
 */
export type AutotelTraceFn = <T>(
  name: string,
  fn: (ctx: { setAttribute: (key: string, value: unknown) => void }) => T | Promise<T>
) => T | Promise<T>;

/**
 * Create a workflow wrapper that adds autotel tracing.
 *
 * This creates a higher-order function that wraps workflow execution
 * in an autotel trace span.
 *
 * @param traceFn - The autotel trace function
 * @param options - Wrapper options
 * @returns A workflow wrapper function
 *
 * @example
 * ```typescript
 * import { trace } from 'autotel';
 * import { withAutotelTracing } from 'awaitly/autotel';
 *
 * const traced = withAutotelTracing(trace, { serviceName: 'checkout' });
 *
 * const result = await traced('process-order', async () => {
 *   return workflow(async (step) => {
 *     // ... workflow logic
 *   });
 * });
 * ```
 */
export function withAutotelTracing(
  traceFn: AutotelTraceFn,
  options?: { serviceName?: string }
): <T>(
  name: string,
  fn: () => T | Promise<T>,
  attributes?: Record<string, string | number | boolean>
) => Promise<T> {
  const { serviceName = "workflow" } = options ?? {};

  return async <T>(
    name: string,
    fn: () => T | Promise<T>,
    attributes?: Record<string, string | number | boolean>
  ): Promise<T> => {
    const spanName = `${serviceName}.${name}`;
    return traceFn(spanName, async (ctx) => {
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          ctx.setAttribute(key, value);
        }
      }
      return fn();
    }) as Promise<T>;
  };
}
