/**
 * Logger Renderer - Outputs structured JSON optimized for logging systems.
 *
 * Works with any structured logger (Pino, Winston, Bunyan, console).
 * Includes workflow summary, step details, and optional ASCII diagram.
 *
 * @example
 * ```typescript
 * const logData = JSON.parse(viz.renderAs('logger'));
 * logger.info(logData, 'Workflow completed');
 * ```
 */

import type {
  Renderer,
  RenderOptions,
  WorkflowIR,
  FlowNode,
  StepNode,
  WorkflowHooks,
} from "../types";
import { isStepNode, isSequenceNode, isParallelNode, isRaceNode, isDecisionNode } from "../types";
import { asciiRenderer } from "./ascii";
import { flowchartRenderer } from "./flowchart";

// =============================================================================
// Types
// =============================================================================

/**
 * Step log entry with execution details.
 */
export interface StepLog {
  id: string;
  name: string;
  key?: string;
  state: string;
  durationMs?: number;
  startTs?: number;
  endTs?: number;
  retryCount?: number;
  timedOut?: boolean;
  timeoutMs?: number;
  error?: string;
}

/**
 * Hook execution log entry.
 */
export interface HookLog {
  shouldRun?: {
    result?: boolean;
    durationMs?: number;
    error?: string;
  };
  onBeforeStart?: {
    durationMs?: number;
    error?: string;
  };
  onAfterStep?: Array<{
    stepKey: string;
    durationMs?: number;
    error?: string;
  }>;
}

/**
 * Summary statistics for the workflow.
 */
export interface WorkflowSummary {
  totalSteps: number;
  successCount: number;
  errorCount: number;
  cacheHits: number;
  skippedCount: number;
  totalRetries: number;
  slowestStep?: { name: string; durationMs: number };
}

/**
 * Complete logger output structure.
 */
export interface LoggerOutput {
  workflow: {
    id: string;
    name?: string;
    state: string;
    durationMs?: number;
    startedAt?: number;
    completedAt?: number;
  };
  steps: StepLog[];
  summary: WorkflowSummary;
  hooks?: HookLog;
  diagram?: string;
}

/**
 * Extended render options for logger renderer.
 */
export interface LoggerRenderOptions extends RenderOptions {
  /** Include ASCII diagram in output (default: true) */
  includeDiagram?: boolean;
  /** Strip ANSI color codes from diagram (default: true) */
  stripAnsiColors?: boolean;
  /** Diagram format: 'ascii' (tree-style) or 'flowchart' (boxes/arrows) (default: 'ascii') */
  diagramFormat?: "ascii" | "flowchart";
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Strip ANSI escape codes from a string.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Collect all step nodes from the IR tree.
 */
function collectSteps(nodes: FlowNode[]): StepNode[] {
  const steps: StepNode[] = [];

  function walk(nodeList: FlowNode[]): void {
    for (const node of nodeList) {
      if (isStepNode(node)) {
        steps.push(node);
      } else if (isSequenceNode(node)) {
        walk(node.children);
      } else if (isParallelNode(node) || isRaceNode(node)) {
        walk(node.children);
      } else if (isDecisionNode(node)) {
        for (const branch of node.branches) {
          if (branch.taken) {
            walk(branch.children);
          }
        }
      }
    }
  }

  walk(nodes);
  return steps;
}

/**
 * Convert a step node to a log entry.
 */
function stepToLog(step: StepNode): StepLog {
  const log: StepLog = {
    id: step.id,
    name: step.name ?? step.key ?? step.id,
    state: step.state,
  };

  if (step.key) log.key = step.key;
  if (step.durationMs !== undefined) log.durationMs = step.durationMs;
  if (step.startTs !== undefined) log.startTs = step.startTs;
  if (step.endTs !== undefined) log.endTs = step.endTs;
  if (step.retryCount !== undefined && step.retryCount > 0) log.retryCount = step.retryCount;
  if (step.timedOut) {
    log.timedOut = true;
    if (step.timeoutMs !== undefined) log.timeoutMs = step.timeoutMs;
  }
  if (step.error !== undefined) {
    log.error = typeof step.error === "string" ? step.error : String(step.error);
  }

  return log;
}

/**
 * Calculate summary statistics from steps.
 */
function calculateSummary(steps: StepNode[]): WorkflowSummary {
  let successCount = 0;
  let errorCount = 0;
  let cacheHits = 0;
  let skippedCount = 0;
  let totalRetries = 0;
  let slowestStep: { name: string; durationMs: number } | undefined;

  for (const step of steps) {
    if (step.state === "success") successCount++;
    if (step.state === "error") errorCount++;
    if (step.state === "cached") cacheHits++;
    if (step.state === "skipped") skippedCount++;
    if (step.retryCount !== undefined) totalRetries += step.retryCount;

    if (step.durationMs !== undefined) {
      if (!slowestStep || step.durationMs > slowestStep.durationMs) {
        slowestStep = {
          name: step.name ?? step.key ?? step.id,
          durationMs: step.durationMs,
        };
      }
    }
  }

  return {
    totalSteps: steps.length,
    successCount,
    errorCount,
    cacheHits,
    skippedCount,
    totalRetries,
    slowestStep,
  };
}

/**
 * Convert hooks to log format.
 */
function hooksToLog(hooks: WorkflowHooks): HookLog {
  const log: HookLog = {};

  if (hooks.shouldRun) {
    log.shouldRun = {
      result: hooks.shouldRun.context?.result,
      durationMs: hooks.shouldRun.durationMs,
    };
    if (hooks.shouldRun.error !== undefined && hooks.shouldRun.error !== null) {
      log.shouldRun.error = String(hooks.shouldRun.error);
    }
  }

  if (hooks.onBeforeStart) {
    log.onBeforeStart = {
      durationMs: hooks.onBeforeStart.durationMs,
    };
    if (hooks.onBeforeStart.error !== undefined && hooks.onBeforeStart.error !== null) {
      log.onBeforeStart.error = String(hooks.onBeforeStart.error);
    }
  }

  if (hooks.onAfterStep.size > 0) {
    log.onAfterStep = [];
    for (const [stepKey, hook] of hooks.onAfterStep) {
      const entry: { stepKey: string; durationMs?: number; error?: string } = { stepKey };
      if (hook.durationMs !== undefined) entry.durationMs = hook.durationMs;
      if (hook.error !== undefined && hook.error !== null) entry.error = String(hook.error);
      log.onAfterStep.push(entry);
    }
  }

  return log;
}

/**
 * Build the complete logger output from IR.
 */
function buildLoggerOutput(ir: WorkflowIR, options: LoggerRenderOptions): LoggerOutput {
  const root = ir.root;
  const steps = collectSteps(root.children);
  const includeDiagram = options.includeDiagram ?? true;
  const stripColors = options.stripAnsiColors ?? true;

  const output: LoggerOutput = {
    workflow: {
      id: root.workflowId,
      name: root.name,
      state: root.state,
      durationMs: root.durationMs,
      startedAt: root.startTs,
      completedAt: root.endTs,
    },
    steps: steps.map(stepToLog),
    summary: calculateSummary(steps),
  };

  // Add hooks if present
  if (ir.hooks) {
    const hookLog = hooksToLog(ir.hooks);
    if (Object.keys(hookLog).length > 0) {
      output.hooks = hookLog;
    }
  }

  // Add diagram if requested
  if (includeDiagram) {
    const diagramFormat = options.diagramFormat ?? "ascii";
    const renderer = diagramFormat === "flowchart"
      ? flowchartRenderer()
      : asciiRenderer();
    let diagram = renderer.render(ir, options);
    if (stripColors) {
      diagram = stripAnsi(diagram);
    }
    output.diagram = diagram;
  }

  return output;
}

// =============================================================================
// Renderer
// =============================================================================

/**
 * Create a logger renderer that outputs structured JSON.
 *
 * @example
 * ```typescript
 * const viz = createVisualizer({ workflowName: 'checkout' });
 * // ... run workflow ...
 *
 * const logData = JSON.parse(viz.renderAs('logger'));
 * logger.info(logData, 'Workflow completed');
 * ```
 */
export function loggerRenderer(): Renderer {
  return {
    name: "logger",
    supportsLive: false,
    render(ir: WorkflowIR, options: RenderOptions): string {
      const loggerOptions = options as LoggerRenderOptions;
      const output = buildLoggerOutput(ir, loggerOptions);
      return JSON.stringify(output);
    },
  };
}
