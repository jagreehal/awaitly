/**
 * Time Travel Debugger
 *
 * Records IR snapshots at each event, enabling:
 * - Step-by-step forward/backward navigation
 * - Seeking to any point in execution
 * - Playback at various speeds
 * - State inspection at any moment
 */

import type { WorkflowEvent } from "../core";
import type {
  IRSnapshot,
  TimeTravelState,
  WorkflowIR,
} from "./types";
import { createIRBuilder, type IRBuilder, type IRBuilderOptions } from "./ir-builder";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the time-travel controller.
 */
export interface TimeTravelOptions {
  /** Maximum snapshots to store (ring buffer) */
  maxSnapshots?: number;
  /** Automatically record snapshots on each event */
  autoRecord?: boolean;
  /** IR builder options (passed through) */
  builderOptions?: Omit<IRBuilderOptions, "enableSnapshots" | "maxSnapshots">;
}

/**
 * Time-travel controller interface.
 */
export interface TimeTravelController {
  /** Handle a workflow event (records snapshot if recording) */
  handleEvent: (event: WorkflowEvent<unknown>) => void;

  /** Navigate to specific snapshot index */
  seek: (index: number) => WorkflowIR | undefined;

  /** Move one step forward */
  stepForward: () => WorkflowIR | undefined;

  /** Move one step backward */
  stepBackward: () => WorkflowIR | undefined;

  /** Start playback at given speed (1.0 = realtime) */
  play: (speed?: number) => void;

  /** Pause playback */
  pause: () => void;

  /** Get current IR state */
  getCurrentIR: () => WorkflowIR;

  /** Get IR at specific snapshot index */
  getIRAt: (index: number) => WorkflowIR | undefined;

  /** Get all snapshots */
  getSnapshots: () => IRSnapshot[];

  /** Get snapshot at specific index */
  getSnapshotAt: (index: number) => IRSnapshot | undefined;

  /** Get current time-travel state */
  getState: () => TimeTravelState;

  /** Subscribe to state changes */
  onStateChange: (callback: (state: TimeTravelState) => void) => () => void;

  /** Start/resume recording */
  startRecording: () => void;

  /** Stop recording */
  stopRecording: () => void;

  /** Reset to initial state */
  reset: () => void;

  /** Get the underlying IR builder */
  getBuilder: () => IRBuilder;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a time-travel controller for workflow debugging.
 *
 * @example
 * ```typescript
 * const controller = createTimeTravelController();
 *
 * // Feed events from workflow execution
 * workflow.onEvent(event => controller.handleEvent(event));
 *
 * // After execution, explore the timeline
 * controller.seek(0);  // Go to start
 * controller.stepForward();  // Step through
 * controller.play(2);  // Playback at 2x speed
 * ```
 */
export function createTimeTravelController(
  options: TimeTravelOptions = {}
): TimeTravelController {
  const { maxSnapshots = 1000, autoRecord = true, builderOptions = {} } = options;

  // Create IR builder with snapshots enabled
  const builder = createIRBuilder({
    ...builderOptions,
    enableSnapshots: true,
    maxSnapshots,
  });

  // Controller state
  let state: TimeTravelState = {
    snapshots: [],
    currentIndex: -1,
    isPlaying: false,
    playbackSpeed: 1.0,
    isRecording: autoRecord,
  };

  // State change listeners
  const listeners = new Set<(state: TimeTravelState) => void>();

  // Playback timer
  let playbackTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Notify all listeners of state change.
   */
  function notifyListeners(): void {
    const currentState = getState();
    for (const listener of listeners) {
      listener(currentState);
    }
  }

  /**
   * Sync state from builder snapshots.
   */
  function syncFromBuilder(): void {
    state.snapshots = builder.getSnapshots();
    if (state.isRecording && state.snapshots.length > 0) {
      state.currentIndex = state.snapshots.length - 1;
    }
  }

  /**
   * Handle a workflow event.
   */
  function handleEvent(event: WorkflowEvent<unknown>): void {
    // Always forward to builder
    builder.handleEvent(event);

    // Sync snapshots if recording
    if (state.isRecording) {
      syncFromBuilder();
      notifyListeners();
    }
  }

  /**
   * Seek to a specific snapshot index.
   */
  function seek(index: number): WorkflowIR | undefined {
    const snapshots = builder.getSnapshots();
    if (index < 0 || index >= snapshots.length) {
      return undefined;
    }

    state.currentIndex = index;
    state.snapshots = snapshots;
    notifyListeners();

    return snapshots[index].ir;
  }

  /**
   * Move one step forward.
   */
  function stepForward(): WorkflowIR | undefined {
    return seek(state.currentIndex + 1);
  }

  /**
   * Move one step backward.
   */
  function stepBackward(): WorkflowIR | undefined {
    return seek(state.currentIndex - 1);
  }

  /**
   * Start playback at given speed.
   */
  function play(speed = 1.0): void {
    state.playbackSpeed = speed;
    state.isPlaying = true;
    notifyListeners();

    const playNext = (): void => {
      if (!state.isPlaying) return;

      const snapshots = builder.getSnapshots();
      if (state.currentIndex < snapshots.length - 1) {
        const current = snapshots[state.currentIndex];
        const next = snapshots[state.currentIndex + 1];

        // Calculate delay based on actual event timing
        const realDelay = next.timestamp - current.timestamp;
        const scaledDelay = realDelay / state.playbackSpeed;

        playbackTimer = setTimeout(() => {
          stepForward();
          playNext();
        }, Math.max(16, scaledDelay)); // Minimum 16ms (~60fps) for smooth updates
      } else {
        // Reached end of timeline
        pause();
      }
    };

    playNext();
  }

  /**
   * Pause playback.
   */
  function pause(): void {
    state.isPlaying = false;
    if (playbackTimer) {
      clearTimeout(playbackTimer);
      playbackTimer = null;
    }
    notifyListeners();
  }

  /**
   * Get current IR state.
   */
  function getCurrentIR(): WorkflowIR {
    const snapshots = builder.getSnapshots();
    if (state.currentIndex >= 0 && state.currentIndex < snapshots.length) {
      return snapshots[state.currentIndex].ir;
    }
    // Return live IR if no valid snapshot
    return builder.getIR();
  }

  /**
   * Get IR at specific snapshot index.
   */
  function getIRAt(index: number): WorkflowIR | undefined {
    return builder.getIRAt(index);
  }

  /**
   * Get all snapshots.
   */
  function getSnapshots(): IRSnapshot[] {
    return builder.getSnapshots();
  }

  /**
   * Get snapshot at specific index.
   */
  function getSnapshotAt(index: number): IRSnapshot | undefined {
    return builder.getSnapshotAt(index);
  }

  /**
   * Get current time-travel state.
   */
  function getState(): TimeTravelState {
    return {
      snapshots: builder.getSnapshots(),
      currentIndex: state.currentIndex,
      isPlaying: state.isPlaying,
      playbackSpeed: state.playbackSpeed,
      isRecording: state.isRecording,
    };
  }

  /**
   * Subscribe to state changes.
   */
  function onStateChange(
    callback: (state: TimeTravelState) => void
  ): () => void {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  /**
   * Start or resume recording.
   */
  function startRecording(): void {
    state.isRecording = true;
    notifyListeners();
  }

  /**
   * Stop recording.
   */
  function stopRecording(): void {
    state.isRecording = false;
    notifyListeners();
  }

  /**
   * Reset to initial state.
   */
  function reset(): void {
    pause();
    builder.reset();
    state = {
      snapshots: [],
      currentIndex: -1,
      isPlaying: false,
      playbackSpeed: 1.0,
      isRecording: autoRecord,
    };
    notifyListeners();
  }

  /**
   * Get the underlying IR builder.
   */
  function getBuilder(): IRBuilder {
    return builder;
  }

  return {
    handleEvent,
    seek,
    stepForward,
    stepBackward,
    play,
    pause,
    getCurrentIR,
    getIRAt,
    getSnapshots,
    getSnapshotAt,
    getState,
    onStateChange,
    startRecording,
    stopRecording,
    reset,
    getBuilder,
  };
}
