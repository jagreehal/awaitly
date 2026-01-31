/**
 * awaitly/devtools
 *
 * Developer tools for workflow debugging, visualization, and analysis.
 * Provides timeline rendering, run diffing, and live visualization.
 */

import type { WorkflowEvent } from "awaitly/workflow";
import type {
  OutputFormat,
  VisualizerOptions,
  DecisionStartEvent,
  DecisionBranchEvent,
  DecisionEndEvent,
} from "./types";
import type { CollectableEvent } from "./index";
import { createVisualizer } from "./index";

// =============================================================================
// Types
// =============================================================================

/**
 * A recorded workflow run with events and metadata.
 */
export interface WorkflowRun {
  /** Unique identifier for this run */
  id: string;
  /** Workflow name */
  name?: string;
  /** Start timestamp */
  startTime: number;
  /** End timestamp (undefined if still running) */
  endTime?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Whether the workflow succeeded */
  success?: boolean;
  /** Error if the workflow failed */
  error?: unknown;
  /** All events from this run */
  events: CollectableEvent[];
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Difference between two workflow runs.
 */
export interface RunDiff {
  /** Steps that were added in the new run */
  added: StepDiff[];
  /** Steps that were removed from the new run */
  removed: StepDiff[];
  /** Steps that changed between runs */
  changed: StepDiff[];
  /** Steps that are identical */
  unchanged: string[];
  /** Overall status change */
  statusChange?: {
    from: "success" | "error" | "running";
    to: "success" | "error" | "running";
  };
  /** Duration change in milliseconds */
  durationChange?: number;
}

/**
 * Information about a step difference.
 */
export interface StepDiff {
  /** Step name or key */
  step: string;
  /** Type of change */
  type: "added" | "removed" | "status" | "duration" | "error";
  /** Previous value (for changes) */
  from?: unknown;
  /** New value (for changes) */
  to?: unknown;
}

/**
 * Timeline entry for a step.
 */
export interface TimelineEntry {
  /** Step name */
  name: string;
  /** Step key (if any) */
  key?: string;
  /** Start time (relative to workflow start) */
  startMs: number;
  /** End time (relative to workflow start) */
  endMs?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Step status */
  status: "pending" | "running" | "success" | "error" | "skipped" | "cached";
  /** Error if failed */
  error?: unknown;
  /** Parent scope (for nested steps) */
  parent?: string;
  /** Retry attempt number */
  attempt?: number;
}

/**
 * Devtools configuration options.
 */
export interface DevtoolsOptions extends VisualizerOptions {
  /** Enable console logging of events */
  logEvents?: boolean;
  /** Maximum number of runs to keep in history */
  maxHistory?: number;
  /** Custom logger function */
  logger?: (message: string) => void;
}

// =============================================================================
// Devtools Interface
// =============================================================================

/**
 * Devtools instance for workflow debugging.
 */
export interface Devtools {
  /** Handle a workflow event */
  handleEvent: (event: WorkflowEvent<unknown>) => void;

  /** Handle a decision event */
  handleDecisionEvent: (event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent) => void;

  /** Get the current run */
  getCurrentRun: () => WorkflowRun | undefined;

  /** Get run history */
  getHistory: () => WorkflowRun[];

  /** Get a specific run by ID */
  getRun: (id: string) => WorkflowRun | undefined;

  /** Compare two runs */
  diff: (runId1: string, runId2: string) => RunDiff | undefined;

  /** Compare current run with a previous run */
  diffWithPrevious: () => RunDiff | undefined;

  /** Render current state */
  render: () => string;

  /** Render to a specific format */
  renderAs: (format: OutputFormat) => string;

  /** Render as Mermaid diagram */
  renderMermaid: () => string;

  /** Render as ASCII timeline */
  renderTimeline: () => string;

  /** Get timeline data for current run */
  getTimeline: () => TimelineEntry[];

  /** Clear all history */
  clearHistory: () => void;

  /** Reset current run */
  reset: () => void;

  /** Export run data as JSON */
  exportRun: (runId?: string) => string;

  /** Import run data from JSON */
  importRun: (json: string) => WorkflowRun;
}

// =============================================================================
// Create Devtools
// =============================================================================

/**
 * Create a devtools instance for workflow debugging.
 *
 * @example
 * ```typescript
 * const devtools = createDevtools({ workflowName: 'checkout' });
 *
 * const workflow = createWorkflow(deps, {
 *   onEvent: devtools.handleEvent,
 * });
 *
 * await workflow(async (step) => { ... });
 *
 * // Visualize
 * console.log(devtools.render());
 * console.log(devtools.renderMermaid());
 *
 * // Compare with previous run
 * const diff = devtools.diffWithPrevious();
 * ```
 */
export function createDevtools(options: DevtoolsOptions = {}): Devtools {
  const { logEvents = false, maxHistory = 10, logger = console.log } = options;

  const visualizer = createVisualizer(options);
  const history: WorkflowRun[] = [];
  let currentRun: WorkflowRun | undefined;
  let workflowStartTime = 0;

  function startNewRun(workflowId: string): void {
    // Save current run to history if it exists
    if (currentRun) {
      history.push(currentRun);
      // Trim history if needed
      while (history.length > maxHistory) {
        history.shift();
      }
    }

    workflowStartTime = Date.now();
    currentRun = {
      id: workflowId,
      name: options.workflowName,
      startTime: workflowStartTime,
      events: [],
    };

    visualizer.reset();
  }

  function endCurrentRun(success: boolean, error?: unknown): void {
    if (currentRun) {
      currentRun.endTime = Date.now();
      currentRun.durationMs = currentRun.endTime - currentRun.startTime;
      currentRun.success = success;
      currentRun.error = error;
    }
  }

  function handleEvent(event: WorkflowEvent<unknown>): void {
    if (logEvents) {
      logger(`[devtools] ${event.type}: ${JSON.stringify(event)}`);
    }

    // Start new run on workflow_start
    if (event.type === "workflow_start") {
      startNewRun(event.workflowId);
    }

    // Record event
    if (currentRun) {
      currentRun.events.push(event);
    }

    // Forward to visualizer
    visualizer.handleEvent(event);

    // End run on workflow_success or workflow_error
    if (event.type === "workflow_success") {
      endCurrentRun(true);
    } else if (event.type === "workflow_error") {
      endCurrentRun(false, event.error);
    }
  }

  function handleDecisionEvent(
    event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent
  ): void {
    if (logEvents) {
      logger(`[devtools] ${event.type}: ${JSON.stringify(event)}`);
    }

    if (currentRun) {
      currentRun.events.push(event);
    }

    visualizer.handleDecisionEvent(event);
  }

  function getCurrentRun(): WorkflowRun | undefined {
    return currentRun;
  }

  function getHistory(): WorkflowRun[] {
    return [...history];
  }

  function getRun(id: string): WorkflowRun | undefined {
    if (currentRun?.id === id) return currentRun;
    return history.find((run) => run.id === id);
  }

  function diff(runId1: string, runId2: string): RunDiff | undefined {
    const run1 = getRun(runId1);
    const run2 = getRun(runId2);

    if (!run1 || !run2) return undefined;

    return diffRuns(run1, run2);
  }

  function diffWithPrevious(): RunDiff | undefined {
    if (!currentRun || history.length === 0) return undefined;
    const previousRun = history[history.length - 1];
    return diffRuns(previousRun, currentRun);
  }

  function render(): string {
    return visualizer.render();
  }

  function renderAs(format: OutputFormat): string {
    return visualizer.renderAs(format);
  }

  function renderMermaid(): string {
    return visualizer.renderAs("mermaid");
  }

  function renderTimeline(): string {
    const timeline = getTimeline();
    return formatTimeline(timeline);
  }

  function getTimeline(): TimelineEntry[] {
    if (!currentRun) return [];
    return buildTimeline(currentRun.events, workflowStartTime);
  }

  function clearHistory(): void {
    history.length = 0;
  }

  function reset(): void {
    currentRun = undefined;
    visualizer.reset();
  }

  function exportRun(runId?: string): string {
    const run = runId ? getRun(runId) : currentRun;
    if (!run) return "{}";
    return JSON.stringify(run, null, 2);
  }

  function importRun(json: string): WorkflowRun {
    const run = JSON.parse(json) as WorkflowRun;
    history.push(run);
    return run;
  }

  return {
    handleEvent,
    handleDecisionEvent,
    getCurrentRun,
    getHistory,
    getRun,
    diff,
    diffWithPrevious,
    render,
    renderAs,
    renderMermaid,
    renderTimeline,
    getTimeline,
    clearHistory,
    reset,
    exportRun,
    importRun,
  };
}

// =============================================================================
// Diff Helpers
// =============================================================================

function diffRuns(run1: WorkflowRun, run2: WorkflowRun): RunDiff {
  const steps1 = extractSteps(run1.events);
  const steps2 = extractSteps(run2.events);

  const added: StepDiff[] = [];
  const removed: StepDiff[] = [];
  const changed: StepDiff[] = [];
  const unchanged: string[] = [];

  // Find added and changed steps
  for (const [name, step2] of steps2) {
    const step1 = steps1.get(name);

    if (!step1) {
      added.push({ step: name, type: "added", to: step2.status });
    } else if (step1.status !== step2.status) {
      changed.push({
        step: name,
        type: "status",
        from: step1.status,
        to: step2.status,
      });
    } else if (step1.durationMs !== step2.durationMs) {
      changed.push({
        step: name,
        type: "duration",
        from: step1.durationMs,
        to: step2.durationMs,
      });
    } else {
      unchanged.push(name);
    }
  }

  // Find removed steps
  for (const [name] of steps1) {
    if (!steps2.has(name)) {
      removed.push({ step: name, type: "removed", from: steps1.get(name)?.status });
    }
  }

  // Calculate status change
  let statusChange: RunDiff["statusChange"];
  const status1 = run1.success === undefined ? "running" : run1.success ? "success" : "error";
  const status2 = run2.success === undefined ? "running" : run2.success ? "success" : "error";

  if (status1 !== status2) {
    statusChange = { from: status1, to: status2 };
  }

  // Calculate duration change
  let durationChange: number | undefined;
  if (run1.durationMs !== undefined && run2.durationMs !== undefined) {
    durationChange = run2.durationMs - run1.durationMs;
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    statusChange,
    durationChange,
  };
}

interface StepInfo {
  name: string;
  key?: string;
  status: string;
  durationMs?: number;
  error?: unknown;
}

function extractSteps(events: CollectableEvent[]): Map<string, StepInfo> {
  const steps = new Map<string, StepInfo>();

  for (const event of events) {
    if (event.type === "step_start") {
      const e = event as WorkflowEvent<unknown> & { stepId: string; name?: string; stepKey?: string };
      const name = e.name || e.stepKey || e.stepId;
      steps.set(name, {
        name,
        key: e.stepKey,
        status: "running",
      });
    } else if (event.type === "step_success") {
      const e = event as WorkflowEvent<unknown> & { stepId: string; name?: string; stepKey?: string; durationMs: number };
      const name = e.name || e.stepKey || e.stepId;
      const existing = steps.get(name);
      if (existing) {
        existing.status = "success";
        existing.durationMs = e.durationMs;
      }
    } else if (event.type === "step_error") {
      const e = event as WorkflowEvent<unknown> & { stepId: string; name?: string; stepKey?: string; durationMs: number; error: unknown };
      const name = e.name || e.stepKey || e.stepId;
      const existing = steps.get(name);
      if (existing) {
        existing.status = "error";
        existing.durationMs = e.durationMs;
        existing.error = e.error;
      }
    } else if (event.type === "step_cache_hit") {
      const e = event as WorkflowEvent<unknown> & { stepKey: string; name?: string };
      const name = e.name || e.stepKey;
      steps.set(name, {
        name,
        key: e.stepKey,
        status: "cached",
      });
    } else if (event.type === "step_skipped") {
      const e = event as WorkflowEvent<unknown> & { stepKey?: string; name?: string };
      const name = e.name || e.stepKey || "unknown";
      steps.set(name, {
        name,
        key: e.stepKey,
        status: "skipped",
      });
    }
  }

  return steps;
}

// =============================================================================
// Timeline Helpers
// =============================================================================

function buildTimeline(events: CollectableEvent[], startTime: number): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];
  const stepStarts = new Map<string, number>();

  for (const event of events) {
    if (event.type === "step_start") {
      const e = event as WorkflowEvent<unknown> & { stepId: string; name?: string; stepKey?: string; ts: number };
      const name = e.name || e.stepKey || e.stepId;
      stepStarts.set(name, e.ts);
      timeline.push({
        name,
        key: e.stepKey,
        startMs: e.ts - startTime,
        status: "running",
      });
    } else if (event.type === "step_success") {
      const e = event as WorkflowEvent<unknown> & { stepId: string; name?: string; stepKey?: string; ts: number; durationMs: number };
      const name = e.name || e.stepKey || e.stepId;
      const entry = timeline.find((t) => t.name === name && t.status === "running");
      if (entry) {
        entry.endMs = e.ts - startTime;
        entry.durationMs = e.durationMs;
        entry.status = "success";
      }
    } else if (event.type === "step_error") {
      const e = event as WorkflowEvent<unknown> & { stepId: string; name?: string; stepKey?: string; ts: number; durationMs: number; error: unknown };
      const name = e.name || e.stepKey || e.stepId;
      const entry = timeline.find((t) => t.name === name && t.status === "running");
      if (entry) {
        entry.endMs = e.ts - startTime;
        entry.durationMs = e.durationMs;
        entry.status = "error";
        entry.error = e.error;
      }
    } else if (event.type === "step_cache_hit") {
      const e = event as WorkflowEvent<unknown> & { stepKey: string; name?: string; ts: number };
      const name = e.name || e.stepKey;
      timeline.push({
        name,
        key: e.stepKey,
        startMs: e.ts - startTime,
        endMs: e.ts - startTime,
        durationMs: 0,
        status: "cached",
      });
    } else if (event.type === "step_skipped") {
      const e = event as WorkflowEvent<unknown> & { stepKey?: string; name?: string; ts: number };
      const name = e.name || e.stepKey || "unknown";
      timeline.push({
        name,
        key: e.stepKey,
        startMs: e.ts - startTime,
        endMs: e.ts - startTime,
        durationMs: 0,
        status: "skipped",
      });
    }
  }

  return timeline;
}

function formatTimeline(timeline: TimelineEntry[]): string {
  if (timeline.length === 0) return "No timeline data";

  const lines: string[] = [];
  lines.push("Timeline:");
  lines.push("─".repeat(60));

  // Find max duration for scaling
  const maxEnd = Math.max(...timeline.map((t) => t.endMs ?? t.startMs + 100));
  const barWidth = 40;

  for (const entry of timeline) {
    const startPos = Math.floor((entry.startMs / maxEnd) * barWidth);
    const endPos = Math.floor(((entry.endMs ?? entry.startMs + 10) / maxEnd) * barWidth);
    const width = Math.max(1, endPos - startPos);

    const statusChar = getStatusChar(entry.status);
    const bar = " ".repeat(startPos) + statusChar.repeat(width);

    const duration = entry.durationMs !== undefined ? `${entry.durationMs}ms` : "?";
    lines.push(`${entry.name.padEnd(20)} |${bar.padEnd(barWidth)}| ${duration}`);
  }

  lines.push("─".repeat(60));
  return lines.join("\n");
}

function getStatusChar(status: TimelineEntry["status"]): string {
  switch (status) {
    case "success":
      return "█";
    case "error":
      return "░";
    case "running":
      return "▒";
    case "cached":
      return "▓";
    case "skipped":
      return "·";
    default:
      return "?";
  }
}

// =============================================================================
// Diff Renderer
// =============================================================================

/**
 * Render a run diff as a string.
 */
export function renderDiff(diff: RunDiff): string {
  const lines: string[] = [];

  if (diff.statusChange) {
    lines.push(`Status: ${diff.statusChange.from} → ${diff.statusChange.to}`);
  }

  if (diff.durationChange !== undefined) {
    const sign = diff.durationChange >= 0 ? "+" : "";
    lines.push(`Duration: ${sign}${diff.durationChange}ms`);
  }

  if (diff.added.length > 0) {
    lines.push("\nAdded steps:");
    for (const step of diff.added) {
      lines.push(`  + ${step.step}`);
    }
  }

  if (diff.removed.length > 0) {
    lines.push("\nRemoved steps:");
    for (const step of diff.removed) {
      lines.push(`  - ${step.step}`);
    }
  }

  if (diff.changed.length > 0) {
    lines.push("\nChanged steps:");
    for (const step of diff.changed) {
      lines.push(`  ~ ${step.step}: ${step.from} → ${step.to}`);
    }
  }

  if (diff.unchanged.length > 0) {
    lines.push(`\nUnchanged: ${diff.unchanged.length} steps`);
  }

  return lines.join("\n");
}

// =============================================================================
// Quick Visualization Helpers
// =============================================================================

/**
 * Quick visualization helper for a single workflow run.
 */
export function quickVisualize(
  workflowFn: (handleEvent: (event: WorkflowEvent<unknown>) => void) => Promise<unknown>,
  options: DevtoolsOptions = {}
): Promise<string> {
  const devtools = createDevtools(options);

  return workflowFn(devtools.handleEvent).then(() => devtools.render());
}

/**
 * Create an event handler that logs to console with pretty formatting.
 */
export function createConsoleLogger(options: { prefix?: string; colors?: boolean } = {}): (
  event: WorkflowEvent<unknown>
) => void {
  const { prefix = "[workflow]", colors = true } = options;

  const colorize = colors
    ? {
        reset: "\x1b[0m",
        dim: "\x1b[2m",
        green: "\x1b[32m",
        red: "\x1b[31m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        cyan: "\x1b[36m",
      }
    : { reset: "", dim: "", green: "", red: "", yellow: "", blue: "", cyan: "" };

  return (event: WorkflowEvent<unknown>) => {
    const timestamp = new Date().toISOString().slice(11, 23);
    let message = "";

    switch (event.type) {
      case "workflow_start":
        message = `${colorize.blue}⏵ Workflow started${colorize.reset}`;
        break;
      case "workflow_success":
        message = `${colorize.green}✓ Workflow completed${colorize.reset} ${colorize.dim}(${event.durationMs}ms)${colorize.reset}`;
        break;
      case "workflow_error":
        message = `${colorize.red}✗ Workflow failed${colorize.reset}`;
        break;
      case "step_start":
        message = `${colorize.cyan}→ ${event.name || event.stepKey || event.stepId}${colorize.reset}`;
        break;
      case "step_success":
        message = `${colorize.green}✓ ${event.name || event.stepKey || event.stepId}${colorize.reset} ${colorize.dim}(${event.durationMs}ms)${colorize.reset}`;
        break;
      case "step_error":
        message = `${colorize.red}✗ ${event.name || event.stepKey || event.stepId}${colorize.reset}`;
        break;
      case "step_cache_hit":
        message = `${colorize.yellow}⚡ ${event.name || event.stepKey} (cached)${colorize.reset}`;
        break;
      case "step_retry":
        message = `${colorize.yellow}↻ ${event.name || event.stepKey || event.stepId} retry ${event.attempt}/${event.maxAttempts}${colorize.reset}`;
        break;
      default:
        message = `${colorize.dim}${event.type}${colorize.reset}`;
    }

    console.log(`${colorize.dim}${timestamp}${colorize.reset} ${prefix} ${message}`);
  };
}