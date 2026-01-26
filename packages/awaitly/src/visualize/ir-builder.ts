/**
 * IR Builder - Converts workflow events to Intermediate Representation.
 *
 * The builder maintains state as events arrive, constructing a tree
 * representation of the workflow execution that can be rendered.
 */

import type { WorkflowEvent } from "../core";
import type {
  FlowNode,
  ScopeEndEvent,
  ScopeStartEvent,
  ScopeType,
  StepNode,
  StepState,
  WorkflowIR,
  WorkflowNode,
  ParallelNode,
  RaceNode,
  DecisionNode,
  DecisionStartEvent,
  DecisionBranchEvent,
  DecisionEndEvent,
  DecisionBranch,
  IRSnapshot,
  ActiveStepSnapshot,
  WorkflowHooks,
  HookExecution,
  StreamNode,
} from "./types";
import { generateId } from "./utils/timing";
import { detectParallelGroups, type ParallelDetectorOptions } from "./parallel-detector";

// =============================================================================
// Builder Options
// =============================================================================

/**
 * Options for the IR builder.
 */
export interface IRBuilderOptions {
  /**
   * Enable heuristic parallel detection based on timing.
   * When true, overlapping steps are grouped into ParallelNodes.
   * Default: true
   */
  detectParallel?: boolean;

  /**
   * Options for parallel detection.
   */
  parallelDetection?: ParallelDetectorOptions;

  /**
   * Enable snapshot recording for time-travel debugging.
   * When true, the builder captures IR state after each event.
   * Default: false
   */
  enableSnapshots?: boolean;

  /**
   * Maximum number of snapshots to keep (ring buffer behavior).
   * When exceeded, oldest snapshots are discarded.
   * Default: 1000
   */
  maxSnapshots?: number;
}

// =============================================================================
// Builder State
// =============================================================================

interface ActiveStep {
  id: string;
  name?: string;
  key?: string;
  startTs: number;
  retryCount: number;
  timedOut: boolean;
  timeoutMs?: number;
}

interface ActiveScope {
  id: string;
  name?: string;
  type: ScopeType;
  startTs: number;
  children: FlowNode[];
}

interface ActiveDecision {
  id: string;
  name?: string;
  condition?: string;
  decisionValue?: unknown;
  startTs: number;
  branches: Map<string, DecisionBranch>;
  branchTaken?: string | boolean;
}

interface ActiveStream {
  id: string;
  namespace: string;
  startTs: number;
  writeCount: number;
  readCount: number;
  streamState: "active" | "closed" | "error";
  backpressureOccurred: boolean;
  finalPosition: number;
}

// =============================================================================
// IR Builder
// =============================================================================

/**
 * Creates an IR builder that processes workflow events.
 */
export function createIRBuilder(options: IRBuilderOptions = {}) {
  const {
    detectParallel = true,
    parallelDetection,
    enableSnapshots = false,
    maxSnapshots = 1000,
  } = options;

  // Current workflow state
  let workflowId: string | undefined;
  let workflowStartTs: number | undefined;
  let workflowState: StepState = "pending";
  let workflowError: unknown;
  let workflowDurationMs: number | undefined;

  // Active steps (currently running)
  const activeSteps = new Map<string, ActiveStep>();

  // Active scopes (parallel/race blocks)
  const scopeStack: ActiveScope[] = [];

  // Active decisions (conditional branches)
  const decisionStack: ActiveDecision[] = [];

  // Active streams (streaming operations)
  const activeStreams = new Map<string, ActiveStream>();

  // Completed nodes at the current scope level
  let currentNodes: FlowNode[] = [];

  // Metadata
  let createdAt = Date.now();
  let lastUpdatedAt = createdAt;

  // Hook executions
  let hookState: WorkflowHooks = {
    onAfterStep: new Map(),
  };

  // Snapshot state for time-travel debugging
  const snapshots: IRSnapshot[] = [];
  let eventIndex = 0;

  /**
   * Get the step ID from an event.
   * Uses stepId if available (new events), then falls back to stepKey or name,
   * and finally generates a random ID for backwards compatibility.
   */
  function getStepId(event: { stepId?: string; stepKey?: string; name?: string }): string {
    return event.stepId ?? event.stepKey ?? event.name ?? generateId();
  }

  /**
   * Add a completed node to the current scope or decision branch.
   */
  function addNode(node: FlowNode): void {
    // If we're in a decision, add to the taken branch
    if (decisionStack.length > 0) {
      const decision = decisionStack[decisionStack.length - 1];
      // Find the taken branch
      for (const branch of decision.branches.values()) {
        if (branch.taken) {
          branch.children.push(node);
          lastUpdatedAt = Date.now();
          return;
        }
      }
      // If no branch is marked as taken yet, add to the first branch
      // (this handles cases where steps execute before branch is marked)
      const firstBranch = Array.from(decision.branches.values())[0];
      if (firstBranch) {
        firstBranch.children.push(node);
        lastUpdatedAt = Date.now();
        return;
      }
    }

    // If we're in a scope, add to the scope
    if (scopeStack.length > 0) {
      // Add to the innermost scope
      scopeStack[scopeStack.length - 1].children.push(node);
    } else {
      // Add to the root level
      currentNodes.push(node);
    }
    lastUpdatedAt = Date.now();
  }

  /**
   * Capture a snapshot of the current IR state (for time-travel debugging).
   * Called after each event is processed.
   */
  function captureSnapshot(event: WorkflowEvent<unknown>): void {
    if (!enableSnapshots) return;

    // Deep clone the current IR state
    const ir = getIR();

    // Clone active steps for debugging
    const activeStepsCopy = new Map<string, ActiveStepSnapshot>();
    for (const [id, step] of activeSteps) {
      activeStepsCopy.set(id, {
        id: step.id,
        name: step.name,
        key: step.key,
        startTs: step.startTs,
        retryCount: step.retryCount,
        timedOut: step.timedOut,
        timeoutMs: step.timeoutMs,
      });
    }

    const snapshot: IRSnapshot = {
      id: `snapshot_${eventIndex}`,
      eventIndex,
      event: structuredClone(event),
      ir: structuredClone(ir),
      timestamp: Date.now(),
      activeSteps: activeStepsCopy,
    };

    snapshots.push(snapshot);

    // Ring buffer: remove oldest if we exceed max
    if (snapshots.length > maxSnapshots) {
      snapshots.shift();
    }

    eventIndex++;
  }

  /**
   * Handle a workflow event and update the IR.
   */
  function handleEvent(event: WorkflowEvent<unknown>): void {
    switch (event.type) {
      case "workflow_start":
        workflowId = event.workflowId;
        workflowStartTs = event.ts;
        workflowState = "running";
        createdAt = Date.now();
        lastUpdatedAt = createdAt;
        // Note: Don't clear hookState here - shouldRun and onBeforeStart
        // events are emitted BEFORE workflow_start. Only clear onAfterStep
        // since those are per-step and should reset for each workflow run.
        hookState.onAfterStep = new Map();
        break;

      case "workflow_success":
        workflowState = "success";
        workflowDurationMs = event.durationMs;
        lastUpdatedAt = Date.now();
        break;

      case "workflow_error":
        workflowState = "error";
        workflowError = event.error;
        workflowDurationMs = event.durationMs;
        lastUpdatedAt = Date.now();
        break;

      case "step_start": {
        const id = getStepId(event);
        activeSteps.set(id, {
          id,
          name: event.name,
          key: event.stepKey,
          startTs: event.ts,
          retryCount: 0,
          timedOut: false,
        });
        lastUpdatedAt = Date.now();
        break;
      }

      case "step_success": {
        const id = getStepId(event);
        const active = activeSteps.get(id);
        if (active) {
          const node: StepNode = {
            type: "step",
            id: active.id,
            name: active.name,
            key: active.key,
            state: "success",
            startTs: active.startTs,
            endTs: event.ts,
            durationMs: event.durationMs,
            ...(active.retryCount > 0 && { retryCount: active.retryCount }),
            ...(active.timedOut && { timedOut: true, timeoutMs: active.timeoutMs }),
          };
          addNode(node);
          activeSteps.delete(id);
        }
        break;
      }

      case "step_error": {
        const id = getStepId(event);
        const active = activeSteps.get(id);
        if (active) {
          const node: StepNode = {
            type: "step",
            id: active.id,
            name: active.name,
            key: active.key,
            state: "error",
            startTs: active.startTs,
            endTs: event.ts,
            durationMs: event.durationMs,
            error: event.error,
            ...(active.retryCount > 0 && { retryCount: active.retryCount }),
            ...(active.timedOut && { timedOut: true, timeoutMs: active.timeoutMs }),
          };
          addNode(node);
          activeSteps.delete(id);
        }
        break;
      }

      case "step_aborted": {
        const id = getStepId(event);
        const active = activeSteps.get(id);
        if (active) {
          const node: StepNode = {
            type: "step",
            id: active.id,
            name: active.name,
            key: active.key,
            state: "aborted",
            startTs: active.startTs,
            endTs: event.ts,
            durationMs: event.durationMs,
            ...(active.retryCount > 0 && { retryCount: active.retryCount }),
            ...(active.timedOut && { timedOut: true, timeoutMs: active.timeoutMs }),
          };
          addNode(node);
          activeSteps.delete(id);
        }
        break;
      }

      case "step_cache_hit": {
        const id = getStepId(event);
        const node: StepNode = {
          type: "step",
          id,
          name: event.name,
          key: event.stepKey,
          state: "cached",
          startTs: event.ts,
          endTs: event.ts,
          durationMs: 0,
        };
        addNode(node);
        break;
      }

      case "step_cache_miss":
        // Cache miss just means the step will execute normally
        // We'll get a step_start event next
        break;

      case "step_complete":
        // step_complete is for state persistence, not visualization
        // We already handled the step via step_success/step_error
        break;

      case "step_timeout": {
        // Timeout is an intermediate event - step may retry or will get step_error
        // Track timeout info on the active step
        const id = getStepId(event);
        const active = activeSteps.get(id);
        if (active) {
          active.timedOut = true;
          active.timeoutMs = event.timeoutMs;
        }
        lastUpdatedAt = Date.now();
        break;
      }

      case "step_retry": {
        // Retry is an intermediate event - increment retry counter
        const id = getStepId(event);
        const active = activeSteps.get(id);
        if (active) {
          active.retryCount = (event.attempt ?? 1) - 1; // attempt is 1-indexed, retryCount is 0-indexed
        }
        lastUpdatedAt = Date.now();
        break;
      }

      case "step_retries_exhausted":
        // All retries exhausted - step_error will follow
        // The error state will be set by step_error handler
        lastUpdatedAt = Date.now();
        break;

      case "step_skipped": {
        const id = getStepId(event);
        const node: StepNode = {
          type: "step",
          id,
          name: event.name,
          key: event.stepKey,
          state: "skipped",
          startTs: event.ts,
          endTs: event.ts,
          durationMs: 0,
        };
        addNode(node);
        break;
      }

      // Hook events
      case "hook_should_run": {
        const hookExec: HookExecution = {
          type: "shouldRun",
          state: "success",
          ts: event.ts,
          durationMs: event.durationMs,
          context: {
            result: event.result,
            skipped: event.skipped,
          },
        };
        hookState.shouldRun = hookExec;
        lastUpdatedAt = Date.now();
        break;
      }

      case "hook_should_run_error": {
        const hookExec: HookExecution = {
          type: "shouldRun",
          state: "error",
          ts: event.ts,
          durationMs: event.durationMs,
          error: event.error,
        };
        hookState.shouldRun = hookExec;
        lastUpdatedAt = Date.now();
        break;
      }

      case "hook_before_start": {
        const hookExec: HookExecution = {
          type: "onBeforeStart",
          state: "success",
          ts: event.ts,
          durationMs: event.durationMs,
          context: {
            result: event.result,
            skipped: event.skipped,
          },
        };
        hookState.onBeforeStart = hookExec;
        lastUpdatedAt = Date.now();
        break;
      }

      case "hook_before_start_error": {
        const hookExec: HookExecution = {
          type: "onBeforeStart",
          state: "error",
          ts: event.ts,
          durationMs: event.durationMs,
          error: event.error,
        };
        hookState.onBeforeStart = hookExec;
        lastUpdatedAt = Date.now();
        break;
      }

      case "hook_after_step": {
        const hookExec: HookExecution = {
          type: "onAfterStep",
          state: "success",
          ts: event.ts,
          durationMs: event.durationMs,
          context: {
            stepKey: event.stepKey,
          },
        };
        hookState.onAfterStep.set(event.stepKey, hookExec);
        lastUpdatedAt = Date.now();
        break;
      }

      case "hook_after_step_error": {
        const hookExec: HookExecution = {
          type: "onAfterStep",
          state: "error",
          ts: event.ts,
          durationMs: event.durationMs,
          error: event.error,
          context: {
            stepKey: event.stepKey,
          },
        };
        hookState.onAfterStep.set(event.stepKey, hookExec);
        lastUpdatedAt = Date.now();
        break;
      }

      // Stream events
      case "stream_created": {
        const streamKey = `${event.workflowId}:${event.namespace}`;
        activeStreams.set(streamKey, {
          id: generateId(),
          namespace: event.namespace,
          startTs: event.ts,
          writeCount: 0,
          readCount: 0,
          streamState: "active",
          backpressureOccurred: false,
          finalPosition: 0,
        });
        lastUpdatedAt = Date.now();
        break;
      }

      case "stream_write": {
        const streamKey = `${event.workflowId}:${event.namespace}`;
        const stream = activeStreams.get(streamKey);
        if (stream) {
          stream.writeCount++;
          stream.finalPosition = Math.max(stream.finalPosition, event.position);
        }
        lastUpdatedAt = Date.now();
        break;
      }

      case "stream_read": {
        const streamKey = `${event.workflowId}:${event.namespace}`;
        const stream = activeStreams.get(streamKey);
        if (stream) {
          stream.readCount++;
        }
        lastUpdatedAt = Date.now();
        break;
      }

      case "stream_close": {
        const streamKey = `${event.workflowId}:${event.namespace}`;
        const stream = activeStreams.get(streamKey);
        if (stream) {
          stream.streamState = "closed";
          stream.finalPosition = event.finalPosition;
          // Create StreamNode and add to current nodes
          const node: StreamNode = {
            type: "stream",
            id: stream.id,
            namespace: stream.namespace,
            state: "success",
            startTs: stream.startTs,
            endTs: event.ts,
            durationMs: event.ts - stream.startTs,
            writeCount: stream.writeCount,
            readCount: stream.readCount,
            finalPosition: event.finalPosition,
            streamState: "closed",
            backpressureOccurred: stream.backpressureOccurred,
          };
          addNode(node);
          activeStreams.delete(streamKey);
        }
        lastUpdatedAt = Date.now();
        break;
      }

      case "stream_error": {
        const streamKey = `${event.workflowId}:${event.namespace}`;
        const stream = activeStreams.get(streamKey);
        if (stream) {
          stream.streamState = "error";
          // Create StreamNode with error state and add to current nodes
          const node: StreamNode = {
            type: "stream",
            id: stream.id,
            namespace: stream.namespace,
            state: "error",
            error: event.error,
            startTs: stream.startTs,
            endTs: event.ts,
            durationMs: event.ts - stream.startTs,
            writeCount: stream.writeCount,
            readCount: stream.readCount,
            finalPosition: event.position,
            streamState: "error",
            backpressureOccurred: stream.backpressureOccurred,
          };
          addNode(node);
          activeStreams.delete(streamKey);
        }
        lastUpdatedAt = Date.now();
        break;
      }

      case "stream_backpressure": {
        const streamKey = `${event.workflowId}:${event.namespace}`;
        const stream = activeStreams.get(streamKey);
        if (stream) {
          stream.backpressureOccurred = true;
        }
        lastUpdatedAt = Date.now();
        break;
      }
    }

    // Capture snapshot after processing event (for time-travel)
    captureSnapshot(event);
  }

  /**
   * Handle a scope event (parallel/race start/end).
   */
  function handleScopeEvent(event: ScopeStartEvent | ScopeEndEvent): void {
    if (event.type === "scope_start") {
      scopeStack.push({
        id: event.scopeId,
        name: event.name,
        type: event.scopeType,
        startTs: event.ts,
        children: [],
      });
      lastUpdatedAt = Date.now();
    } else if (event.type === "scope_end") {
      const scope = scopeStack.pop();
      if (scope) {
        const node: ParallelNode | RaceNode =
          scope.type === "race"
            ? {
                type: "race",
                id: scope.id,
                name: scope.name,
                state: deriveState(scope.children),
                startTs: scope.startTs,
                endTs: event.ts,
                durationMs: event.durationMs,
                children: scope.children,
                winnerId: event.winnerId,
              }
            : {
                type: "parallel",
                id: scope.id,
                name: scope.name,
                state: deriveState(scope.children),
                startTs: scope.startTs,
                endTs: event.ts,
                durationMs: event.durationMs,
                children: scope.children,
                mode: scope.type === "allSettled" ? "allSettled" : "all",
              };
        addNode(node);
      }
    }
  }

  /**
   * Handle a decision event (conditional branch start/branch/end).
   */
  function handleDecisionEvent(
    event: DecisionStartEvent | DecisionBranchEvent | DecisionEndEvent
  ): void {
    if (event.type === "decision_start") {
      decisionStack.push({
        id: event.decisionId,
        name: event.name,
        condition: event.condition,
        decisionValue: event.decisionValue,
        startTs: event.ts,
        branches: new Map(),
      });
      lastUpdatedAt = Date.now();
    } else if (event.type === "decision_branch") {
      const decision = decisionStack[decisionStack.length - 1];
      if (decision && decision.id === event.decisionId) {
        // Find or create branch
        const branchKey = event.branchLabel;
        const existing = decision.branches.get(branchKey);
        if (existing) {
          // Update existing branch
          existing.taken = event.taken;
        } else {
          // Create new branch
          decision.branches.set(branchKey, {
            label: event.branchLabel,
            condition: event.condition,
            taken: event.taken,
            children: [],
          });
        }
        lastUpdatedAt = Date.now();
      }
    } else if (event.type === "decision_end") {
      const decision = decisionStack.pop();
      if (decision && decision.id === event.decisionId) {
        // Convert branches map to array
        const branches: DecisionBranch[] = Array.from(decision.branches.values());

        const node: DecisionNode = {
          type: "decision",
          id: decision.id,
          name: decision.name,
          state: deriveState(
            branches.flatMap((b) => (b.taken ? b.children : []))
          ),
          startTs: decision.startTs,
          endTs: event.ts,
          durationMs: event.durationMs,
          condition: decision.condition,
          decisionValue: decision.decisionValue,
          branchTaken: event.branchTaken ?? decision.branchTaken,
          branches,
        };
        addNode(node);
      }
    }
  }

  /**
   * Derive the state of a parent node from its children.
   */
  function deriveState(children: FlowNode[]): StepState {
    if (children.length === 0) return "success";

    const hasError = children.some((c) => c.state === "error");
    if (hasError) return "error";

    const allSuccess = children.every(
      (c) => c.state === "success" || c.state === "cached"
    );
    if (allSuccess) return "success";

    const hasRunning = children.some((c) => c.state === "running");
    if (hasRunning) return "running";

    return "pending";
  }

  /**
   * Get the current nodes including any active (running) steps and streams.
   */
  function getCurrentNodes(): FlowNode[] {
    const nodes = [...currentNodes];

    // Add active steps as running nodes
    for (const [, active] of activeSteps) {
      nodes.push({
        type: "step",
        id: active.id,
        name: active.name,
        key: active.key,
        state: "running",
        startTs: active.startTs,
        ...(active.retryCount > 0 && { retryCount: active.retryCount }),
        ...(active.timedOut && { timedOut: true, timeoutMs: active.timeoutMs }),
      });
    }

    // Add active streams as running nodes
    for (const [, stream] of activeStreams) {
      nodes.push({
        type: "stream",
        id: stream.id,
        namespace: stream.namespace,
        state: "running",
        startTs: stream.startTs,
        writeCount: stream.writeCount,
        readCount: stream.readCount,
        finalPosition: stream.finalPosition,
        streamState: stream.streamState,
        backpressureOccurred: stream.backpressureOccurred,
      } satisfies StreamNode);
    }

    return nodes;
  }

  /**
   * Build and return the current IR state.
   */
  function getIR(): WorkflowIR {
    let children = getCurrentNodes();

    // Apply parallel detection if enabled
    if (detectParallel) {
      children = detectParallelGroups(children, parallelDetection);
    }

    const root: WorkflowNode = {
      type: "workflow",
      id: workflowId ?? generateId(),
      workflowId: workflowId ?? "unknown",
      state: workflowState,
      startTs: workflowStartTs,
      durationMs: workflowDurationMs,
      children,
      error: workflowError,
    };

    // Include hooks if any have been recorded
    const hasHooks =
      hookState.shouldRun !== undefined ||
      hookState.onBeforeStart !== undefined ||
      hookState.onAfterStep.size > 0;

    return {
      root,
      metadata: {
        createdAt,
        lastUpdatedAt,
      },
      ...(hasHooks && { hooks: hookState }),
    };
  }

  /**
   * Reset the builder state.
   */
  function reset(): void {
    workflowId = undefined;
    workflowStartTs = undefined;
    workflowState = "pending";
    workflowError = undefined;
    workflowDurationMs = undefined;
    activeSteps.clear();
    scopeStack.length = 0;
    decisionStack.length = 0;
    activeStreams.clear();
    currentNodes = [];
    createdAt = Date.now();
    lastUpdatedAt = createdAt;
    // Clear hooks
    hookState = {
      onAfterStep: new Map(),
    };
    // Clear snapshots
    snapshots.length = 0;
    eventIndex = 0;
  }

  /**
   * Get all recorded snapshots.
   */
  function getSnapshots(): IRSnapshot[] {
    return [...snapshots];
  }

  /**
   * Get a snapshot at a specific index.
   */
  function getSnapshotAt(index: number): IRSnapshot | undefined {
    return snapshots[index];
  }

  /**
   * Get the IR state at a specific snapshot index.
   */
  function getIRAt(index: number): WorkflowIR | undefined {
    return snapshots[index]?.ir;
  }

  /**
   * Clear all recorded snapshots.
   */
  function clearSnapshots(): void {
    snapshots.length = 0;
    eventIndex = 0;
  }

  return {
    handleEvent,
    handleScopeEvent,
    handleDecisionEvent,
    getIR,
    reset,
    // Snapshot methods for time-travel
    getSnapshots,
    getSnapshotAt,
    getIRAt,
    clearSnapshots,
    /** Check if there are active (running) steps */
    get hasActiveSteps() {
      return activeSteps.size > 0;
    },
    /** Get the current workflow state */
    get state() {
      return workflowState;
    },
    /** Get the number of recorded snapshots */
    get snapshotCount() {
      return snapshots.length;
    },
    /** Check if snapshot recording is enabled */
    get snapshotsEnabled() {
      return enableSnapshots;
    },
  };
}

/**
 * Type for the IR builder instance.
 */
export type IRBuilder = ReturnType<typeof createIRBuilder>;
