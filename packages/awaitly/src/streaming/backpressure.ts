/**
 * awaitly/streaming - Backpressure Controller
 *
 * Implements flow control for streams using high-water mark.
 * When buffered items exceed the threshold, writers are paused
 * until consumers catch up.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * State of the backpressure controller.
 */
export type BackpressureState = "flowing" | "paused";

/**
 * Callback invoked when backpressure state changes.
 */
export type BackpressureCallback = (state: BackpressureState) => void;

/**
 * Options for creating a BackpressureController.
 */
export interface BackpressureOptions {
  /** High-water mark threshold (default: 16) */
  highWaterMark?: number;
  /** Low-water mark to resume (default: highWaterMark / 2) */
  lowWaterMark?: number;
  /** Callback when state changes */
  onStateChange?: BackpressureCallback;
}

// =============================================================================
// BackpressureController
// =============================================================================

/**
 * Controller for managing stream backpressure.
 *
 * When the number of buffered items exceeds the high-water mark,
 * the controller enters "paused" state. It returns to "flowing"
 * when items are consumed and the buffer drops below the low-water mark.
 *
 * @example
 * ```typescript
 * const controller = createBackpressureController({ highWaterMark: 16 });
 *
 * // Track writes
 * controller.increment();
 * if (controller.state === 'paused') {
 *   await controller.waitForDrain();
 * }
 *
 * // Track reads (consumer)
 * controller.decrement();
 * ```
 */
export interface BackpressureController {
  /** Current state */
  readonly state: BackpressureState;

  /** Current number of buffered items */
  readonly bufferedCount: number;

  /** High-water mark threshold */
  readonly highWaterMark: number;

  /** Low-water mark threshold */
  readonly lowWaterMark: number;

  /** Increment buffered count (called on write) */
  increment(): void;

  /** Decrement buffered count (called on read/consume) */
  decrement(): void;

  /** Set buffered count directly (for resuming) */
  setCount(count: number): void;

  /**
   * Wait for the buffer to drain below low-water mark.
   * Resolves immediately if already flowing.
   */
  waitForDrain(): Promise<void>;

  /** Reset the controller to initial state */
  reset(): void;
}

/**
 * Create a backpressure controller.
 *
 * @param options - Configuration options
 * @returns BackpressureController instance
 */
export function createBackpressureController(
  options: BackpressureOptions = {}
): BackpressureController {
  const highWaterMark = options.highWaterMark ?? 16;
  const lowWaterMark = options.lowWaterMark ?? Math.floor(highWaterMark / 2);
  const onStateChange = options.onStateChange;

  let state: BackpressureState = "flowing";
  let bufferedCount = 0;
  let drainResolvers: Array<() => void> = [];

  function updateState(newState: BackpressureState): void {
    if (state !== newState) {
      state = newState;
      onStateChange?.(newState);

      // Resolve drain waiters when transitioning to flowing
      if (newState === "flowing" && drainResolvers.length > 0) {
        const resolvers = drainResolvers;
        drainResolvers = [];
        for (const resolve of resolvers) {
          resolve();
        }
      }
    }
  }

  function checkState(): void {
    if (state === "flowing" && bufferedCount >= highWaterMark) {
      updateState("paused");
    } else if (state === "paused" && bufferedCount <= lowWaterMark) {
      updateState("flowing");
    }
  }

  return {
    get state() {
      return state;
    },

    get bufferedCount() {
      return bufferedCount;
    },

    get highWaterMark() {
      return highWaterMark;
    },

    get lowWaterMark() {
      return lowWaterMark;
    },

    increment(): void {
      bufferedCount++;
      checkState();
    },

    decrement(): void {
      if (bufferedCount > 0) {
        bufferedCount--;
        checkState();
      }
    },

    setCount(count: number): void {
      bufferedCount = Math.max(0, count);
      checkState();
    },

    waitForDrain(): Promise<void> {
      if (state === "flowing") {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        drainResolvers.push(resolve);
      });
    },

    reset(): void {
      bufferedCount = 0;
      drainResolvers = [];
      updateState("flowing");
    },
  };
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Check if backpressure should be applied.
 */
export function shouldApplyBackpressure(
  controller: BackpressureController
): boolean {
  return controller.state === "paused";
}
