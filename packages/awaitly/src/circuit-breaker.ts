/**
 * Circuit Breaker for Steps
 *
 * Prevents cascading failures by tracking step failure rates and
 * short-circuiting calls when a threshold is exceeded.
 *
 * Uses the circuit breaker pattern with three states:
 * - CLOSED: Normal operation (steps executing)
 * - OPEN: Fast-fail mode (steps blocked)
 * - HALF_OPEN: Testing if service recovered
 *
 * @example
 * ```typescript
 * import { createCircuitBreaker } from 'awaitly';
 *
 * const breaker = createCircuitBreaker({
 *   failureThreshold: 5,
 *   resetTimeout: 30000,
 *   halfOpenMax: 3,
 * });
 *
 * const result = await workflow(async ({ step }) => {
 *   const data = await breaker.execute(
 *     () => step(() => callExternalApi()),
 *     { name: 'external-api' }
 *   );
 *   return data;
 * });
 * ```
 */

import { err, type Result, type AsyncResult } from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * Circuit breaker state.
 */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Configuration for circuit breaker behavior.
 */
export interface CircuitBreakerConfig {
  /**
   * Number of failures within the window before opening the circuit.
   * @default 5
   */
  failureThreshold: number;

  /**
   * Time in ms to wait before transitioning from OPEN to HALF_OPEN.
   * @default 30000 (30 seconds)
   */
  resetTimeout: number;

  /**
   * Time window in ms for counting failures.
   * Failures older than this are discarded.
   * @default 60000 (1 minute)
   */
  windowSize: number;

  /**
   * Maximum number of test requests allowed in HALF_OPEN state.
   * If all succeed, circuit closes. If any fail, circuit reopens.
   * @default 3
   */
  halfOpenMax: number;

  /**
   * Optional callback when circuit state changes.
   */
  onStateChange?: (from: CircuitState, to: CircuitState, name?: string) => void;
}

/**
 * Error thrown when the circuit is open and calls are blocked.
 */
export class CircuitOpenError extends Error {
  readonly type = "CIRCUIT_OPEN" as const;
  readonly circuitName: string;
  readonly state: CircuitState;
  readonly retryAfterMs: number;

  constructor(options: {
    circuitName: string;
    state: CircuitState;
    retryAfterMs: number;
    message?: string;
  }) {
    super(
      options.message ??
        `Circuit breaker "${options.circuitName}" is ${options.state}. ` +
        `Retry after ${Math.ceil(options.retryAfterMs / 1000)}s`
    );
    this.name = "CircuitOpenError";
    this.circuitName = options.circuitName;
    this.state = options.state;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Type guard for CircuitOpenError.
 */
export function isCircuitOpenError(error: unknown): error is CircuitOpenError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as CircuitOpenError).type === "CIRCUIT_OPEN"
  );
}

/**
 * Failure record for tracking failures within the window.
 */
interface FailureRecord {
  timestamp: number;
  error: unknown;
}

/**
 * Circuit breaker statistics.
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  halfOpenSuccesses: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30_000,
  windowSize: 60_000,
  halfOpenMax: 3,
};

// =============================================================================
// Circuit Breaker Implementation
// =============================================================================

/**
 * Circuit breaker instance for protecting external calls.
 */
export interface CircuitBreaker {
  /**
   * Execute an operation with circuit breaker protection.
   * Throws CircuitOpenError if the circuit is open.
   *
   * @param operation - The operation to execute
   * @param options - Optional name for logging/metrics
   * @returns The operation result
   * @throws CircuitOpenError if circuit is open
   */
  execute<T>(
    operation: () => T | Promise<T>,
    options?: { name?: string }
  ): Promise<T>;

  /**
   * Execute a Result-returning operation with circuit breaker protection.
   * Returns a CircuitOpenError result instead of throwing.
   *
   * @param operation - The operation returning a Result
   * @param options - Optional name for logging/metrics
   * @returns Result with the value or CircuitOpenError
   */
  executeResult<T, E>(
    operation: () => Result<T, E> | AsyncResult<T, E>,
    options?: { name?: string }
  ): AsyncResult<T, E | CircuitOpenError>;

  /**
   * Get current circuit state.
   */
  getState(): CircuitState;

  /**
   * Get circuit breaker statistics.
   */
  getStats(): CircuitBreakerStats;

  /**
   * Manually reset the circuit breaker to CLOSED state.
   */
  reset(): void;

  /**
   * Manually open the circuit (for testing or manual intervention).
   */
  forceOpen(): void;

  /**
   * Record a manual success (useful for health checks).
   */
  recordSuccess(): void;

  /**
   * Record a manual failure (useful for health checks).
   */
  recordFailure(error?: unknown): void;
}

/**
 * Create a circuit breaker instance.
 *
 * @param name - Name for this circuit breaker (used in errors and logging)
 * @param config - Configuration options
 * @returns A CircuitBreaker instance
 *
 * @example
 * ```typescript
 * const apiBreaker = createCircuitBreaker('external-api', {
 *   failureThreshold: 5,
 *   resetTimeout: 30000,
 * });
 *
 * // In workflow
 * const data = await apiBreaker.execute(() =>
 *   step(() => fetchFromApi(id))
 * );
 * ```
 */
export function createCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  const effectiveConfig: CircuitBreakerConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  let state: CircuitState = "CLOSED";
  let failures: FailureRecord[] = [];
  let lastFailureTime: number | null = null;
  let lastSuccessTime: number | null = null;
  let successCount = 0;
  let halfOpenSuccesses = 0;

  /**
   * Clean up old failures outside the time window.
   */
  function cleanupFailures(): void {
    const now = Date.now();
    failures = failures.filter(
      (f) => now - f.timestamp < effectiveConfig.windowSize
    );
  }

  /**
   * Transition to a new state.
   */
  function transitionTo(newState: CircuitState): void {
    if (state !== newState) {
      const oldState = state;
      state = newState;
      if (newState === "HALF_OPEN") {
        halfOpenSuccesses = 0;
      }
      effectiveConfig.onStateChange?.(oldState, newState, name);
    }
  }

  /**
   * Check if we should transition from OPEN to HALF_OPEN.
   */
  function checkOpenToHalfOpen(): boolean {
    if (state !== "OPEN" || lastFailureTime === null) {
      return false;
    }
    const now = Date.now();
    if (now - lastFailureTime >= effectiveConfig.resetTimeout) {
      transitionTo("HALF_OPEN");
      return true;
    }
    return false;
  }

  /**
   * Record a successful operation.
   */
  function handleSuccess(): void {
    lastSuccessTime = Date.now();
    successCount++;

    if (state === "HALF_OPEN") {
      halfOpenSuccesses++;
      if (halfOpenSuccesses >= effectiveConfig.halfOpenMax) {
        // All test requests succeeded, close the circuit
        transitionTo("CLOSED");
        failures = [];
      }
    }
  }

  /**
   * Record a failed operation.
   */
  function handleFailure(error: unknown): void {
    const now = Date.now();
    lastFailureTime = now;

    // Clean up old failures first
    cleanupFailures();

    // Add new failure
    failures.push({ timestamp: now, error });

    if (state === "HALF_OPEN") {
      // Any failure in HALF_OPEN reopens the circuit
      transitionTo("OPEN");
    } else if (state === "CLOSED") {
      // Check if we should open the circuit
      if (failures.length >= effectiveConfig.failureThreshold) {
        transitionTo("OPEN");
      }
    }
  }

  /**
   * Check if the circuit allows execution.
   * Returns the remaining wait time if blocked, or 0 if allowed.
   */
  function canExecute(): number {
    if (state === "CLOSED") {
      return 0;
    }

    if (state === "OPEN") {
      // Check if we should transition to HALF_OPEN
      if (checkOpenToHalfOpen()) {
        return 0; // Now in HALF_OPEN, allow execution
      }
      // Still OPEN, calculate remaining wait time
      const now = Date.now();
      const elapsed = lastFailureTime ? now - lastFailureTime : 0;
      return Math.max(0, effectiveConfig.resetTimeout - elapsed);
    }

    // HALF_OPEN - allow limited test requests
    return 0;
  }

  return {
    async execute<T>(
      operation: () => T | Promise<T>,
      _options?: { name?: string }
    ): Promise<T> {
      const waitTime = canExecute();
      if (waitTime > 0) {
        throw new CircuitOpenError({
          circuitName: name,
          state,
          retryAfterMs: waitTime,
        });
      }

      try {
        const result = await operation();
        handleSuccess();
        return result;
      } catch (error) {
        handleFailure(error);
        throw error;
      }
    },

    async executeResult<T, E>(
      operation: () => Result<T, E> | AsyncResult<T, E>,
      _options?: { name?: string }
    ): AsyncResult<T, E | CircuitOpenError> {
      const waitTime = canExecute();
      if (waitTime > 0) {
        return err(
          new CircuitOpenError({
            circuitName: name,
            state,
            retryAfterMs: waitTime,
          })
        );
      }

      try {
        const result = await operation();
        if (result.ok) {
          handleSuccess();
        } else {
          handleFailure(result.error);
        }
        return result;
      } catch (error) {
        handleFailure(error);
        throw error;
      }
    },

    getState(): CircuitState {
      // Check for automatic transition before returning
      if (state === "OPEN") {
        checkOpenToHalfOpen();
      }
      return state;
    },

    getStats(): CircuitBreakerStats {
      cleanupFailures();
      return {
        state: this.getState(),
        failureCount: failures.length,
        successCount,
        lastFailureTime,
        lastSuccessTime,
        halfOpenSuccesses,
      };
    },

    reset(): void {
      transitionTo("CLOSED");
      failures = [];
      halfOpenSuccesses = 0;
    },

    forceOpen(): void {
      lastFailureTime = Date.now();
      transitionTo("OPEN");
    },

    recordSuccess(): void {
      handleSuccess();
    },

    recordFailure(error?: unknown): void {
      handleFailure(error ?? new Error("Manual failure"));
    },
  };
}

// =============================================================================
// Presets
// =============================================================================

/**
 * Preset configurations for common use cases.
 */
export const circuitBreakerPresets = {
  /**
   * Aggressive circuit breaker for critical paths.
   * Opens quickly (3 failures) and recovers slowly (60s).
   */
  critical: {
    failureThreshold: 3,
    resetTimeout: 60_000,
    windowSize: 30_000,
    halfOpenMax: 1,
  } satisfies Partial<CircuitBreakerConfig>,

  /**
   * Standard circuit breaker for typical API calls.
   * Balanced between stability and availability.
   */
  standard: {
    failureThreshold: 5,
    resetTimeout: 30_000,
    windowSize: 60_000,
    halfOpenMax: 3,
  } satisfies Partial<CircuitBreakerConfig>,

  /**
   * Lenient circuit breaker for non-critical operations.
   * Opens slowly (10 failures) and recovers quickly (15s).
   */
  lenient: {
    failureThreshold: 10,
    resetTimeout: 15_000,
    windowSize: 120_000,
    halfOpenMax: 5,
  } satisfies Partial<CircuitBreakerConfig>,
} as const;
