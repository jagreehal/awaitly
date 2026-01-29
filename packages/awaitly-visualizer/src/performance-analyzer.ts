/**
 * Performance Analyzer
 *
 * Analyzes workflow execution data to identify:
 * - Slow steps (bottlenecks)
 * - Retry patterns
 * - Error-prone steps
 * - Timing anomalies
 *
 * Aggregates metrics across multiple workflow runs to provide
 * statistical insights and heatmap visualization data.
 */

import type { WorkflowEvent } from "awaitly/workflow";
import type {
  NodePerformance,
  HeatmapData,
  WorkflowIR,
  FlowNode,
  HeatLevel,
} from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * A recorded workflow run for analysis.
 */
export interface WorkflowRun {
  /** Unique identifier for this run */
  id: string;
  /** Workflow start timestamp */
  startTime: number;
  /** All events from the workflow execution */
  events: WorkflowEvent<unknown>[];
}

/**
 * Performance analyzer interface.
 */
export interface PerformanceAnalyzer {
  /** Add a completed workflow run for analysis */
  addRun: (run: WorkflowRun) => void;

  /** Add events incrementally (alternative to addRun) */
  addEvent: (event: WorkflowEvent<unknown>) => void;

  /** Finalize current run (when using addEvent) */
  finalizeRun: (runId: string) => void;

  /** Get performance stats for a specific node */
  getNodePerformance: (nodeId: string) => NodePerformance | undefined;

  /** Get heatmap data for an IR */
  getHeatmap: (
    ir: WorkflowIR,
    metric?: "duration" | "retryRate" | "errorRate"
  ) => HeatmapData;

  /** Get slowest nodes */
  getSlowestNodes: (limit?: number) => NodePerformance[];

  /** Get error-prone nodes */
  getErrorProneNodes: (limit?: number) => NodePerformance[];

  /** Get retry-prone nodes */
  getRetryProneNodes: (limit?: number) => NodePerformance[];

  /** Get all performance data */
  getAllPerformance: () => Map<string, NodePerformance>;

  /** Export performance data as JSON */
  exportData: () => string;

  /** Import performance data from JSON */
  importData: (json: string) => void;

  /** Clear all collected data */
  clear: () => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Flatten all nodes from an IR tree.
 */
function flattenNodes(nodes: FlowNode[]): FlowNode[] {
  const result: FlowNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if ("children" in node && Array.isArray(node.children)) {
      result.push(...flattenNodes(node.children));
    }
    if ("branches" in node) {
      for (const branch of node.branches) {
        result.push(...flattenNodes(branch.children));
      }
    }
  }
  return result;
}

/**
 * Calculate percentile value from sorted array.
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.floor(sortedValues.length * p);
  return sortedValues[Math.min(index, sortedValues.length - 1)];
}

/**
 * Get heat level from normalized value (0-1).
 */
export function getHeatLevel(heat: number): HeatLevel {
  if (heat < 0.2) return "cold";
  if (heat < 0.4) return "cool";
  if (heat < 0.6) return "neutral";
  if (heat < 0.8) return "warm";
  if (heat < 0.95) return "hot";
  return "critical";
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a performance analyzer for workflow metrics.
 *
 * @example
 * ```typescript
 * const analyzer = createPerformanceAnalyzer();
 *
 * // Add completed runs
 * analyzer.addRun({ id: 'run-1', startTime: Date.now(), events });
 *
 * // Get insights
 * const slowest = analyzer.getSlowestNodes(5);
 * const heatmap = analyzer.getHeatmap(ir, 'duration');
 * ```
 */
export function createPerformanceAnalyzer(): PerformanceAnalyzer {
  // Timing data: nodeId → array of durations (ms)
  const timingData = new Map<string, number[]>();

  // Retry data: nodeId → { retried runs, total runs }
  const retryData = new Map<string, { retried: number; total: number }>();

  // Error data: nodeId → { error runs, total runs }
  const errorData = new Map<string, { errors: number; total: number }>();

  // Timeout data: nodeId → { timed out, total }
  const timeoutData = new Map<string, { timedOut: number; total: number }>();

  // Current run state (for incremental event adding)
  let currentRunEvents: WorkflowEvent<unknown>[] = [];

  /**
   * Get node ID from event.
   * Prioritizes stepKey, then stepId, then name so distinct steps (same name, no key)
   * are not merged.
   */
  function getNodeId(event: {
    stepId?: string;
    stepKey?: string;
    name?: string;
  }): string {
    return event.stepKey ?? event.stepId ?? event.name ?? "unknown";
  }

  /**
   * Process events from a workflow run.
   */
  function processEvents(events: WorkflowEvent<unknown>[]): void {
    // Track step state during processing
    const stepState = new Map<
      string,
      {
        retried: boolean;
        timedOut: boolean;
      }
    >();

    for (const event of events) {
      switch (event.type) {
        case "step_start": {
          const id = getNodeId(event);
          stepState.set(id, { retried: false, timedOut: false });
          break;
        }

        case "step_retry": {
          const id = getNodeId(event);
          const state = stepState.get(id);
          if (state) {
            state.retried = true;
          }
          break;
        }

        case "step_timeout": {
          const id = getNodeId(event);
          const state = stepState.get(id);
          if (state) {
            state.timedOut = true;
          }
          // Don't update counts here - wait for step completion
          // to get accurate total count across all runs
          break;
        }

        case "step_success": {
          const id = getNodeId(event);
          const state = stepState.get(id);

          // Record timing
          const timings = timingData.get(id) ?? [];
          timings.push(event.durationMs);
          timingData.set(id, timings);

          // Record retry status
          const retry = retryData.get(id) ?? { retried: 0, total: 0 };
          retry.total++;
          if (state?.retried) retry.retried++;
          retryData.set(id, retry);

          // Record timeout status
          const timeout = timeoutData.get(id) ?? { timedOut: 0, total: 0 };
          timeout.total++;
          if (state?.timedOut) timeout.timedOut++;
          timeoutData.set(id, timeout);

          // Record success (no error)
          const error = errorData.get(id) ?? { errors: 0, total: 0 };
          error.total++;
          errorData.set(id, error);

          stepState.delete(id);
          break;
        }

        case "step_error": {
          const id = getNodeId(event);
          const state = stepState.get(id);

          // Record timing
          const timings = timingData.get(id) ?? [];
          timings.push(event.durationMs);
          timingData.set(id, timings);

          // Record retry status
          const retry = retryData.get(id) ?? { retried: 0, total: 0 };
          retry.total++;
          if (state?.retried) retry.retried++;
          retryData.set(id, retry);

          // Record timeout status
          const timeout = timeoutData.get(id) ?? { timedOut: 0, total: 0 };
          timeout.total++;
          if (state?.timedOut) timeout.timedOut++;
          timeoutData.set(id, timeout);

          // Record error
          const error = errorData.get(id) ?? { errors: 0, total: 0 };
          error.total++;
          error.errors++;
          errorData.set(id, error);

          stepState.delete(id);
          break;
        }
      }
    }
  }

  /**
   * Add a completed workflow run.
   */
  function addRun(run: WorkflowRun): void {
    processEvents(run.events);
  }

  /**
   * Add an event incrementally.
   */
  function addEvent(event: WorkflowEvent<unknown>): void {
    currentRunEvents.push(event);
  }

  /**
   * Finalize current run (process accumulated events).
   */
  function finalizeRun(_runId: string): void {
    if (currentRunEvents.length > 0) {
      processEvents(currentRunEvents);
      currentRunEvents = [];
    }
  }

  /**
   * Compute performance metrics for a node.
   */
  function computePerformance(nodeId: string): NodePerformance | undefined {
    const timings = timingData.get(nodeId);
    if (!timings || timings.length === 0) return undefined;

    const sorted = [...timings].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / sorted.length;
    const variance =
      sorted.reduce((acc, t) => acc + (t - mean) ** 2, 0) / sorted.length;

    const retry = retryData.get(nodeId) ?? { retried: 0, total: 1 };
    const error = errorData.get(nodeId) ?? { errors: 0, total: 1 };
    const timeout = timeoutData.get(nodeId) ?? { timedOut: 0, total: 1 };

    return {
      nodeId,
      avgDurationMs: mean,
      minDurationMs: sorted[0],
      maxDurationMs: sorted[sorted.length - 1],
      stdDevMs: Math.sqrt(variance),
      samples: sorted.length,
      retryRate: retry.total > 0 ? retry.retried / retry.total : 0,
      timeoutRate: timeout.total > 0 ? timeout.timedOut / timeout.total : 0,
      errorRate: error.total > 0 ? error.errors / error.total : 0,
      percentiles: {
        p50: percentile(sorted, 0.5),
        p90: percentile(sorted, 0.9),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
      },
    };
  }

  /**
   * Get performance stats for a specific node.
   */
  function getNodePerformance(nodeId: string): NodePerformance | undefined {
    return computePerformance(nodeId);
  }

  /**
   * Get heatmap data for an IR.
   */
  function getHeatmap(
    ir: WorkflowIR,
    metric: "duration" | "retryRate" | "errorRate" = "duration"
  ): HeatmapData {
    const heat = new Map<string, number>();
    const allNodes = flattenNodes(ir.root.children);

    // Compute values for all nodes
    const values: Array<{ id: string; value: number }> = [];
    for (const node of allNodes) {
      // Use same lookup order as getNodeId: stepKey ?? stepId ?? name (IR has key, id, name)
      const lookupKey =
        ("key" in node ? node.key : undefined) ?? node.id ?? node.name;
      const perf = computePerformance(lookupKey);
      if (perf) {
        let value: number;
        switch (metric) {
          case "duration":
            value = perf.avgDurationMs;
            break;
          case "retryRate":
            value = perf.retryRate;
            break;
          case "errorRate":
            value = perf.errorRate;
            break;
        }
        values.push({ id: node.id, value });
      }
    }

    if (values.length === 0) {
      return {
        heat,
        metric,
        stats: { min: 0, max: 0, mean: 0, threshold: 0 },
      };
    }

    // Compute statistics
    const vals = values.map((v) => v.value);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const range = max - min || 1;

    // Normalize to 0-1 heat values
    for (const { id, value } of values) {
      heat.set(id, (value - min) / range);
    }

    return {
      heat,
      metric,
      stats: {
        min,
        max,
        mean,
        threshold: mean + (max - mean) * 0.5, // 50% above mean is "hot"
      },
    };
  }

  /**
   * Get all performance data.
   */
  function getAllPerformance(): Map<string, NodePerformance> {
    const result = new Map<string, NodePerformance>();
    for (const nodeId of timingData.keys()) {
      const perf = computePerformance(nodeId);
      if (perf) result.set(nodeId, perf);
    }
    return result;
  }

  /**
   * Get slowest nodes by average duration.
   */
  function getSlowestNodes(limit = 10): NodePerformance[] {
    const all = getAllPerformance();
    return [...all.values()]
      .sort((a, b) => b.avgDurationMs - a.avgDurationMs)
      .slice(0, limit);
  }

  /**
   * Get error-prone nodes by error rate.
   */
  function getErrorProneNodes(limit = 10): NodePerformance[] {
    const all = getAllPerformance();
    return [...all.values()]
      .filter((p) => p.errorRate > 0)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, limit);
  }

  /**
   * Get retry-prone nodes by retry rate.
   */
  function getRetryProneNodes(limit = 10): NodePerformance[] {
    const all = getAllPerformance();
    return [...all.values()]
      .filter((p) => p.retryRate > 0)
      .sort((a, b) => b.retryRate - a.retryRate)
      .slice(0, limit);
  }

  /**
   * Export performance data as JSON.
   */
  function exportData(): string {
    return JSON.stringify({
      timingData: Object.fromEntries(timingData),
      retryData: Object.fromEntries(retryData),
      errorData: Object.fromEntries(errorData),
      timeoutData: Object.fromEntries(timeoutData),
    });
  }

  /**
   * Import performance data from JSON.
   */
  function importData(json: string): void {
    const data = JSON.parse(json) as {
      timingData?: Record<string, number[]>;
      retryData?: Record<string, { retried: number; total: number }>;
      errorData?: Record<string, { errors: number; total: number }>;
      timeoutData?: Record<string, { timedOut: number; total: number }>;
    };

    // Clear existing data
    timingData.clear();
    retryData.clear();
    errorData.clear();
    timeoutData.clear();

    // Import timing data
    for (const [k, v] of Object.entries(data.timingData ?? {})) {
      timingData.set(k, v);
    }

    // Import retry data
    for (const [k, v] of Object.entries(data.retryData ?? {})) {
      retryData.set(k, v);
    }

    // Import error data
    for (const [k, v] of Object.entries(data.errorData ?? {})) {
      errorData.set(k, v);
    }

    // Import timeout data
    for (const [k, v] of Object.entries(data.timeoutData ?? {})) {
      timeoutData.set(k, v);
    }
  }

  /**
   * Clear all collected data.
   */
  function clear(): void {
    timingData.clear();
    retryData.clear();
    errorData.clear();
    timeoutData.clear();
    currentRunEvents = [];
  }

  return {
    addRun,
    addEvent,
    finalizeRun,
    getNodePerformance,
    getHeatmap,
    getSlowestNodes,
    getErrorProneNodes,
    getRetryProneNodes,
    getAllPerformance,
    exportData,
    importData,
    clear,
  };
}
