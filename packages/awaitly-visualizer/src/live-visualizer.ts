/**
 * Live Visualizer - Real-time terminal updates during workflow execution.
 *
 * Uses ANSI escape codes to update the terminal in-place, showing
 * workflow progress as it happens.
 */

import type { WorkflowEvent } from "awaitly/workflow";
import type {
  LiveVisualizerOptions,
  RenderOptions,
  ScopeEndEvent,
  ScopeStartEvent,
  DecisionStartEvent,
  DecisionBranchEvent,
  DecisionEndEvent,
  WorkflowIR,
} from "./types";
import { createIRBuilder } from "./ir-builder";
import { asciiRenderer, defaultColorScheme } from "./renderers";

// =============================================================================
// ANSI Escape Codes
// =============================================================================

const ANSI = {
  /** Clear from cursor to end of screen */
  clearToEnd: "\x1b[J",
  /** Move cursor up N lines */
  cursorUp: (n: number) => `\x1b[${n}A`,
  /** Move cursor to beginning of line */
  cursorToStart: "\x1b[G",
  /** Hide cursor */
  hideCursor: "\x1b[?25l",
  /** Show cursor */
  showCursor: "\x1b[?25h",
  /** Save cursor position */
  saveCursor: "\x1b[s",
  /** Restore cursor position */
  restoreCursor: "\x1b[u",
};

// =============================================================================
// Live Visualizer Interface
// =============================================================================

/**
 * Live visualizer with real-time terminal updates.
 */
export interface LiveVisualizer {
  /** Process a workflow event */
  handleEvent: (event: WorkflowEvent<unknown>) => void;
  /** Process a scope event */
  handleScopeEvent: (event: ScopeStartEvent | ScopeEndEvent) => void;
  /** Process a decision event */
  handleDecisionEvent: (event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent) => void;
  /** Get current IR state */
  getIR: () => WorkflowIR;
  /** Render current state to string (without terminal output) */
  render: () => string;
  /** Start live rendering to terminal */
  start: () => void;
  /** Stop live rendering */
  stop: () => void;
  /** Force an immediate redraw */
  refresh: () => void;
  /** Reset state for a new workflow */
  reset: () => void;
}

// =============================================================================
// Create Live Visualizer
// =============================================================================

/**
 * Create a live visualizer for real-time terminal updates.
 *
 * @example
 * ```typescript
 * const live = createLiveVisualizer({ workflowName: 'my-workflow' });
 * const workflow = createWorkflow(deps, { onEvent: live.handleEvent });
 *
 * live.start();
 * await workflow(async (step) => { ... });
 * live.stop();
 * ```
 */
export function createLiveVisualizer(
  options: LiveVisualizerOptions = {}
): LiveVisualizer {
  const {
    workflowName,
    detectParallel = true,
    showTimings = true,
    showKeys = false,
    colors: customColors,
    stream = process.stdout,
    updateInterval = 100,
  } = options;

  const builder = createIRBuilder({ detectParallel });
  const renderer = asciiRenderer();

  // Render options
  const renderOptions: RenderOptions = {
    showTimings,
    showKeys,
    terminalWidth: stream.columns ?? 80,
    colors: { ...defaultColorScheme, ...customColors },
  };

  // State
  let isRunning = false;
  let lastOutput = "";
  let lastLineCount = 0;
  let throttleTimeout: ReturnType<typeof setTimeout> | null = null;
  let pendingUpdate = false;

  /**
   * Write to the output stream.
   */
  function write(text: string): void {
    if (stream.writable) {
      stream.write(text);
    }
  }

  /**
   * Clear the previous output and write new content.
   */
  function redraw(): void {
    if (!isRunning) return;

    const ir = getIR();
    const output = renderer.render(ir, renderOptions);

    // If output hasn't changed, skip redraw
    if (output === lastOutput) return;

    // Clear previous output
    if (lastLineCount > 0) {
      // Move cursor up and clear
      write(ANSI.cursorUp(lastLineCount));
      write(ANSI.cursorToStart);
      write(ANSI.clearToEnd);
    }

    // Write new output
    write(output);
    write("\n");

    // Track line count for next clear
    lastOutput = output;
    lastLineCount = output.split("\n").length;
  }

  /**
   * Schedule a throttled redraw.
   */
  function scheduleRedraw(): void {
    if (!isRunning) return;

    pendingUpdate = true;

    if (throttleTimeout === null) {
      throttleTimeout = setTimeout(() => {
        throttleTimeout = null;
        if (pendingUpdate) {
          pendingUpdate = false;
          redraw();
        }
      }, updateInterval);
    }
  }

  /**
   * Handle a workflow event.
   */
  function handleEvent(event: WorkflowEvent<unknown>): void {
    // Route scope events to handleScopeEvent for proper IR building
    if (event.type === "scope_start" || event.type === "scope_end") {
      handleScopeEvent(event as ScopeStartEvent | ScopeEndEvent);
      return;
    }

    builder.handleEvent(event);

    if (isRunning) {
      // Immediate redraw for start/end events, throttled for others
      if (
        event.type === "workflow_start" ||
        event.type === "workflow_success" ||
        event.type === "workflow_error"
      ) {
        redraw();
      } else {
        scheduleRedraw();
      }
    }
  }

  /**
   * Handle a scope event.
   */
  function handleScopeEvent(event: ScopeStartEvent | ScopeEndEvent): void {
    builder.handleScopeEvent(event);
    if (isRunning) {
      scheduleRedraw();
    }
  }

  /**
   * Handle a decision event.
   */
  function handleDecisionEvent(
    event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent
  ): void {
    builder.handleDecisionEvent(event);
    if (isRunning) {
      scheduleRedraw();
    }
  }

  /**
   * Get the current IR state.
   */
  function getIR(): WorkflowIR {
    const ir = builder.getIR();
    if (workflowName && !ir.root.name) {
      ir.root.name = workflowName;
    }
    return ir;
  }

  /**
   * Render current state to string.
   */
  function render(): string {
    return renderer.render(getIR(), renderOptions);
  }

  /**
   * Start live rendering.
   */
  function start(): void {
    if (isRunning) return;

    isRunning = true;
    lastOutput = "";
    lastLineCount = 0;

    // Hide cursor during updates
    write(ANSI.hideCursor);

    // Initial render
    redraw();
  }

  /**
   * Stop live rendering.
   */
  function stop(): void {
    if (!isRunning) return;

    isRunning = false;

    // Clear any pending throttle
    if (throttleTimeout !== null) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }

    // Final redraw to show completed state
    const ir = getIR();
    const output = renderer.render(ir, renderOptions);

    if (lastLineCount > 0) {
      write(ANSI.cursorUp(lastLineCount));
      write(ANSI.cursorToStart);
      write(ANSI.clearToEnd);
    }

    write(output);
    write("\n");

    // Show cursor again
    write(ANSI.showCursor);
  }

  /**
   * Force an immediate redraw.
   */
  function refresh(): void {
    if (throttleTimeout !== null) {
      clearTimeout(throttleTimeout);
      throttleTimeout = null;
    }
    pendingUpdate = false;
    redraw();
  }

  /**
   * Reset state for a new workflow.
   */
  function reset(): void {
    builder.reset();
    lastOutput = "";
    lastLineCount = 0;
  }

  return {
    handleEvent,
    handleScopeEvent,
    handleDecisionEvent,
    getIR,
    render,
    start,
    stop,
    refresh,
    reset,
  };
}
