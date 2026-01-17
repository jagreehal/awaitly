/**
 * Rate Limiting / Concurrency Control
 *
 * Control throughput for steps that hit rate-limited APIs or shared resources.
 *
 * @example
 * ```typescript
 * import { createRateLimiter, createConcurrencyLimiter } from 'awaitly';
 *
 * // Rate limiting (requests per second)
 * const rateLimiter = createRateLimiter({ maxPerSecond: 10 });
 *
 * // Concurrency limiting (max concurrent)
 * const concurrencyLimiter = createConcurrencyLimiter({ maxConcurrent: 5 });
 *
 * const result = await workflow(async (step) => {
 *   // Wrap operations with rate limiting
 *   const data = await rateLimiter.execute(() =>
 *     step(() => callRateLimitedApi())
 *   );
 *
 *   // Wrap batch operations with concurrency control
 *   const results = await concurrencyLimiter.executeAll(
 *     ids.map(id => () => step(() => fetchItem(id)))
 *   );
 *
 *   return { data, results };
 * });
 * ```
 */

import { err, type Result, type AsyncResult } from "./core";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for rate limiter.
 */
export interface RateLimiterConfig {
  /**
   * Maximum operations per second.
   */
  maxPerSecond: number;

  /**
   * Burst capacity - allows brief spikes above the rate.
   * @default maxPerSecond * 2
   */
  burstCapacity?: number;

  /**
   * Strategy when rate limit is exceeded.
   * - 'wait': Wait until a slot is available (default)
   * - 'reject': Reject immediately with error
   * @default 'wait'
   */
  strategy?: "wait" | "reject";
}

/**
 * Configuration for concurrency limiter.
 */
export interface ConcurrencyLimiterConfig {
  /**
   * Maximum concurrent operations.
   */
  maxConcurrent: number;

  /**
   * Strategy when limit is reached.
   * - 'queue': Queue and wait (default)
   * - 'reject': Reject immediately
   * @default 'queue'
   */
  strategy?: "queue" | "reject";

  /**
   * Maximum queue size (only for 'queue' strategy).
   * @default Infinity
   */
  maxQueueSize?: number;
}

/**
 * Error when rate/concurrency limit is exceeded and strategy is 'reject'.
 */
export interface RateLimitExceededError {
  type: "RATE_LIMIT_EXCEEDED";
  limiterName: string;
  retryAfterMs?: number;
}

/**
 * Error when concurrency limit queue is full.
 */
export interface QueueFullError {
  type: "QUEUE_FULL";
  limiterName: string;
  queueSize: number;
  maxQueueSize: number;
}

/**
 * Type guard for RateLimitExceededError.
 */
export function isRateLimitExceededError(
  error: unknown
): error is RateLimitExceededError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as RateLimitExceededError).type === "RATE_LIMIT_EXCEEDED"
  );
}

/**
 * Type guard for QueueFullError.
 */
export function isQueueFullError(error: unknown): error is QueueFullError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as QueueFullError).type === "QUEUE_FULL"
  );
}

/**
 * Statistics for rate limiter.
 */
export interface RateLimiterStats {
  availableTokens: number;
  maxTokens: number;
  tokensPerSecond: number;
  waitingCount: number;
}

/**
 * Statistics for concurrency limiter.
 */
export interface ConcurrencyLimiterStats {
  activeCount: number;
  maxConcurrent: number;
  queueSize: number;
  maxQueueSize: number;
}

// =============================================================================
// Rate Limiter (Token Bucket)
// =============================================================================

/**
 * Rate limiter interface.
 */
export interface RateLimiter {
  /**
   * Execute an operation with rate limiting.
   * @param operation - The operation to execute
   * @returns The operation result
   */
  execute<T>(operation: () => T | Promise<T>): Promise<T>;

  /**
   * Execute a Result-returning operation with rate limiting.
   */
  executeResult<T, E>(
    operation: () => Result<T, E> | AsyncResult<T, E>
  ): AsyncResult<T, E | RateLimitExceededError>;

  /**
   * Get current statistics.
   */
  getStats(): RateLimiterStats;

  /**
   * Reset the rate limiter.
   */
  reset(): void;
}

/**
 * Create a token bucket rate limiter.
 *
 * @param name - Name for the limiter (used in errors)
 * @param config - Rate limiter configuration
 * @returns A RateLimiter instance
 *
 * @example
 * ```typescript
 * const limiter = createRateLimiter('api-calls', {
 *   maxPerSecond: 10,
 *   burstCapacity: 20,
 * });
 *
 * // In workflow
 * const data = await limiter.execute(() =>
 *   step(() => callApi())
 * );
 * ```
 */
export function createRateLimiter(
  name: string,
  config: RateLimiterConfig
): RateLimiter {
  const { maxPerSecond, strategy = "wait" } = config;
  const maxTokens = config.burstCapacity ?? maxPerSecond * 2;

  let tokens = maxTokens;
  let lastRefill = Date.now();
  const refillRate = maxPerSecond / 1000; // tokens per ms

  // Queue for waiting requests
  const waitQueue: Array<() => void> = [];

  /**
   * Refill tokens based on elapsed time.
   */
  function refill(): void {
    const now = Date.now();
    const elapsed = now - lastRefill;
    const tokensToAdd = elapsed * refillRate;
    tokens = Math.min(maxTokens, tokens + tokensToAdd);
    lastRefill = now;
  }

  /**
   * Try to consume a token.
   * Returns remaining wait time if no tokens available.
   */
  function tryConsume(): number {
    refill();
    if (tokens >= 1) {
      tokens -= 1;
      return 0;
    }
    // Calculate wait time for next token
    const tokensNeeded = 1 - tokens;
    return Math.ceil(tokensNeeded / refillRate);
  }

  /**
   * Wait for a token to be available.
   */
  async function waitForToken(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const waitTime = tryConsume();
        if (waitTime === 0) {
          resolve();
        } else {
          waitQueue.push(check);
          setTimeout(() => {
            const idx = waitQueue.indexOf(check);
            if (idx !== -1) {
              waitQueue.splice(idx, 1);
              check();
            }
          }, waitTime);
        }
      };
      check();
    });
  }

  return {
    async execute<T>(operation: () => T | Promise<T>): Promise<T> {
      const waitTime = tryConsume();

      if (waitTime > 0) {
        if (strategy === "reject") {
          throw {
            type: "RATE_LIMIT_EXCEEDED",
            limiterName: name,
            retryAfterMs: waitTime,
          } as RateLimitExceededError;
        }

        // Wait strategy
        await waitForToken();
      }

      return operation();
    },

    async executeResult<T, E>(
      operation: () => Result<T, E> | AsyncResult<T, E>
    ): AsyncResult<T, E | RateLimitExceededError> {
      const waitTime = tryConsume();

      if (waitTime > 0) {
        if (strategy === "reject") {
          return err({
            type: "RATE_LIMIT_EXCEEDED",
            limiterName: name,
            retryAfterMs: waitTime,
          });
        }

        // Wait strategy
        await waitForToken();
      }

      return operation();
    },

    getStats(): RateLimiterStats {
      refill();
      return {
        availableTokens: Math.floor(tokens),
        maxTokens,
        tokensPerSecond: maxPerSecond,
        waitingCount: waitQueue.length,
      };
    },

    reset(): void {
      tokens = maxTokens;
      lastRefill = Date.now();
      // Clear wait queue
      waitQueue.length = 0;
    },
  };
}

// =============================================================================
// Concurrency Limiter
// =============================================================================

/**
 * Concurrency limiter interface.
 */
export interface ConcurrencyLimiter {
  /**
   * Execute an operation with concurrency limiting.
   * @param operation - The operation to execute
   * @returns The operation result
   */
  execute<T>(operation: () => T | Promise<T>): Promise<T>;

  /**
   * Execute multiple operations with concurrency control.
   * @param operations - Array of operation factories
   * @returns Array of results (in order)
   */
  executeAll<T>(operations: Array<() => T | Promise<T>>): Promise<T[]>;

  /**
   * Execute a Result-returning operation with concurrency limiting.
   */
  executeResult<T, E>(
    operation: () => Result<T, E> | AsyncResult<T, E>
  ): AsyncResult<T, E | QueueFullError>;

  /**
   * Get current statistics.
   */
  getStats(): ConcurrencyLimiterStats;

  /**
   * Reset the concurrency limiter.
   */
  reset(): void;
}

/**
 * Create a concurrency limiter.
 *
 * @param name - Name for the limiter (used in errors)
 * @param config - Concurrency limiter configuration
 * @returns A ConcurrencyLimiter instance
 *
 * @example
 * ```typescript
 * const limiter = createConcurrencyLimiter('db-pool', {
 *   maxConcurrent: 10,
 * });
 *
 * // Execute with concurrency control
 * const results = await limiter.executeAll(
 *   ids.map(id => () => fetchItem(id))
 * );
 * ```
 */
export function createConcurrencyLimiter(
  name: string,
  config: ConcurrencyLimiterConfig
): ConcurrencyLimiter {
  const { maxConcurrent, strategy = "queue", maxQueueSize = Infinity } = config;

  let activeCount = 0;
  const queue: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  /**
   * Acquire a slot.
   */
  async function acquire(): Promise<void> {
    if (activeCount < maxConcurrent) {
      activeCount++;
      return;
    }

    if (strategy === "reject") {
      throw {
        type: "QUEUE_FULL",
        limiterName: name,
        queueSize: queue.length,
        maxQueueSize,
      } as QueueFullError;
    }

    // Queue strategy
    if (queue.length >= maxQueueSize) {
      throw {
        type: "QUEUE_FULL",
        limiterName: name,
        queueSize: queue.length,
        maxQueueSize,
      } as QueueFullError;
    }

    return new Promise<void>((resolve, reject) => {
      queue.push({ resolve, reject });
    });
  }

  /**
   * Release a slot.
   */
  function release(): void {
    activeCount--;
    if (queue.length > 0 && activeCount < maxConcurrent) {
      activeCount++;
      const next = queue.shift();
      next?.resolve();
    }
  }

  return {
    async execute<T>(operation: () => T | Promise<T>): Promise<T> {
      await acquire();
      try {
        return await operation();
      } finally {
        release();
      }
    },

    async executeAll<T>(operations: Array<() => T | Promise<T>>): Promise<T[]> {
      const results: T[] = new Array(operations.length);
      const executing: Promise<void>[] = [];

      for (let i = 0; i < operations.length; i++) {
        const index = i;
        const promise = this.execute(operations[index]).then((result) => {
          results[index] = result;
        });
        executing.push(promise);
      }

      await Promise.all(executing);
      return results;
    },

    async executeResult<T, E>(
      operation: () => Result<T, E> | AsyncResult<T, E>
    ): AsyncResult<T, E | QueueFullError> {
      try {
        await acquire();
      } catch (error) {
        if (isQueueFullError(error)) {
          return err(error);
        }
        throw error;
      }

      try {
        return await operation();
      } finally {
        release();
      }
    },

    getStats(): ConcurrencyLimiterStats {
      return {
        activeCount,
        maxConcurrent,
        queueSize: queue.length,
        maxQueueSize,
      };
    },

    reset(): void {
      activeCount = 0;
      // Reject all queued operations
      while (queue.length > 0) {
        const item = queue.shift();
        item?.reject(new Error("Limiter reset"));
      }
    },
  };
}

// =============================================================================
// Combined Limiter
// =============================================================================

/**
 * Configuration for combined rate + concurrency limiter.
 */
export interface CombinedLimiterConfig {
  /**
   * Rate limiting configuration.
   */
  rate?: RateLimiterConfig;

  /**
   * Concurrency limiting configuration.
   */
  concurrency?: ConcurrencyLimiterConfig;
}

/**
 * Create a combined rate + concurrency limiter.
 *
 * Operations are first rate-limited, then concurrency-limited.
 *
 * @param name - Name for the limiter
 * @param config - Combined limiter configuration
 * @returns An object with both limiters and a combined execute function
 *
 * @example
 * ```typescript
 * const limiter = createCombinedLimiter('api', {
 *   rate: { maxPerSecond: 10 },
 *   concurrency: { maxConcurrent: 5 },
 * });
 *
 * const result = await limiter.execute(() => callApi());
 * ```
 */
export function createCombinedLimiter(
  name: string,
  config: CombinedLimiterConfig
): {
  rate?: RateLimiter;
  concurrency?: ConcurrencyLimiter;
  execute: <T>(operation: () => T | Promise<T>) => Promise<T>;
} {
  const rate = config.rate ? createRateLimiter(`${name}-rate`, config.rate) : undefined;
  const concurrency = config.concurrency
    ? createConcurrencyLimiter(`${name}-concurrency`, config.concurrency)
    : undefined;

  return {
    rate,
    concurrency,

    async execute<T>(operation: () => T | Promise<T>): Promise<T> {
      // Apply rate limiting first
      let op = operation;
      if (rate) {
        const originalOp = op;
        op = () => rate.execute(originalOp);
      }

      // Then apply concurrency limiting
      if (concurrency) {
        return concurrency.execute(op);
      }

      return op();
    },
  };
}

// =============================================================================
// Presets
// =============================================================================

/**
 * Preset configurations for common use cases.
 */
export const rateLimiterPresets = {
  /**
   * Typical API rate limit (10 req/s).
   */
  api: {
    maxPerSecond: 10,
    burstCapacity: 20,
    strategy: "wait",
  } satisfies RateLimiterConfig,

  /**
   * Database pool limit (concurrent connections).
   */
  database: {
    maxConcurrent: 10,
    strategy: "queue",
    maxQueueSize: 100,
  } satisfies ConcurrencyLimiterConfig,

  /**
   * Aggressive rate limit for external APIs (5 req/s).
   */
  external: {
    maxPerSecond: 5,
    burstCapacity: 10,
    strategy: "wait",
  } satisfies RateLimiterConfig,
} as const;
