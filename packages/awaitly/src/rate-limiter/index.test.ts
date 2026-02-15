import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRateLimiter,
  createConcurrencyLimiter,
  createCombinedLimiter,
  createFixedWindowLimiter,
  createCostBasedRateLimiter,
  isRateLimitExceededError,
  isQueueFullError,
  rateLimiterPresets,
} from ".";
import { ok, err, type Result } from "../core";

describe("Rate Limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createRateLimiter", () => {
    it("should create a rate limiter instance", () => {
      const limiter = createRateLimiter("api", { maxPerSecond: 10 });
      expect(limiter).toBeDefined();
      expect(limiter.execute).toBeInstanceOf(Function);
    });

    it("should execute operations immediately when under limit", async () => {
      const limiter = createRateLimiter("api", { maxPerSecond: 10 });

      const result = await limiter.execute(() => "success");
      expect(result).toBe("success");
    });

    it("should track available tokens", () => {
      const limiter = createRateLimiter("api", {
        maxPerSecond: 10,
        burstCapacity: 20,
      });

      const stats = limiter.getStats();
      expect(stats.availableTokens).toBe(20);
      expect(stats.maxTokens).toBe(20);
      expect(stats.tokensPerSecond).toBe(10);
    });

    it("should consume tokens on execution", async () => {
      const limiter = createRateLimiter("api", {
        maxPerSecond: 10,
        burstCapacity: 20,
      });

      await limiter.execute(() => "result1");
      await limiter.execute(() => "result2");

      const stats = limiter.getStats();
      expect(stats.availableTokens).toBe(18);
    });

    it("should refill tokens over time", async () => {
      const limiter = createRateLimiter("api", {
        maxPerSecond: 10,
        burstCapacity: 20,
      });

      // Consume some tokens
      await limiter.execute(() => "result1");
      await limiter.execute(() => "result2");

      // Advance time by 100ms (should add 1 token at 10 per second)
      vi.advanceTimersByTime(100);

      const stats = limiter.getStats();
      expect(stats.availableTokens).toBe(19);
    });

    it("should wait when rate limit exceeded (wait strategy)", async () => {
      const limiter = createRateLimiter("api", {
        maxPerSecond: 10,
        burstCapacity: 2,
        strategy: "wait",
      });

      // Exhaust tokens
      await limiter.execute(() => "result1");
      await limiter.execute(() => "result2");

      // This should wait for token refill
      const promise = limiter.execute(() => "result3");

      // Advance time to allow token refill
      vi.advanceTimersByTime(200);

      const result = await promise;
      expect(result).toBe("result3");
    });

    it("should reject when rate limit exceeded (reject strategy)", async () => {
      const limiter = createRateLimiter("api", {
        maxPerSecond: 10,
        burstCapacity: 1,
        strategy: "reject",
      });

      // Exhaust tokens
      await limiter.execute(() => "result1");

      // This should throw immediately
      await expect(limiter.execute(() => "result2")).rejects.toEqual(
        expect.objectContaining({
          type: "RATE_LIMIT_EXCEEDED",
          limiterName: "api",
        })
      );
    });

    it("should handle async operations", async () => {
      const limiter = createRateLimiter("api", { maxPerSecond: 10 });

      const promise = limiter.execute(async () => {
        return new Promise((resolve) => setTimeout(() => resolve("async result"), 10));
      });

      // Advance timers and flush promises
      await vi.advanceTimersByTimeAsync(10);

      const result = await promise;
      expect(result).toBe("async result");
    });

    it("should reset state", async () => {
      const limiter = createRateLimiter("api", {
        maxPerSecond: 10,
        burstCapacity: 5,
      });

      await limiter.execute(() => "result1");
      await limiter.execute(() => "result2");

      limiter.reset();

      const stats = limiter.getStats();
      expect(stats.availableTokens).toBe(5);
    });
  });

  describe("createRateLimiter.executeResult", () => {
    it("should execute Result-returning operations", async () => {
      const limiter = createRateLimiter("api", { maxPerSecond: 10 });

      const result = await limiter.executeResult(() => ok({ id: "1" }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ id: "1" });
      }
    });

    it("should pass through error Results", async () => {
      const limiter = createRateLimiter("api", { maxPerSecond: 10 });

      const result = await limiter.executeResult(() => err({ code: "NOT_FOUND" }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ code: "NOT_FOUND" });
      }
    });

    it("should return rate limit error as Result (reject strategy)", async () => {
      const limiter = createRateLimiter("api", {
        maxPerSecond: 10,
        burstCapacity: 1,
        strategy: "reject",
      });

      await limiter.executeResult(() => ok("result1"));

      const result = await limiter.executeResult(() => ok("result2"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isRateLimitExceededError(result.error)).toBe(true);
      }
    });
  });

  describe("createConcurrencyLimiter", () => {
    it("should create a concurrency limiter instance", () => {
      const limiter = createConcurrencyLimiter("db", { maxConcurrent: 5 });
      expect(limiter).toBeDefined();
      expect(limiter.execute).toBeInstanceOf(Function);
    });

    it("should execute operations immediately when under limit", async () => {
      const limiter = createConcurrencyLimiter("db", { maxConcurrent: 5 });

      const result = await limiter.execute(() => "success");
      expect(result).toBe("success");
    });

    it("should track active count", async () => {
      const limiter = createConcurrencyLimiter("db", { maxConcurrent: 5 });

      const stats = limiter.getStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.maxConcurrent).toBe(5);
    });

    it("should limit concurrent executions", async () => {
      const limiter = createConcurrencyLimiter("db", { maxConcurrent: 2 });
      const executionOrder: number[] = [];
      const resolvers: Array<() => void> = [];

      const op1 = limiter.execute(async () => {
        executionOrder.push(1);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        return 1;
      });

      const op2 = limiter.execute(async () => {
        executionOrder.push(2);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        return 2;
      });

      // Let the first two operations start
      await vi.advanceTimersByTimeAsync(0);

      const op3 = limiter.execute(async () => {
        executionOrder.push(3);
        return 3;
      });

      // First two should start immediately
      expect(executionOrder).toEqual([1, 2]);

      // Complete first two
      resolvers.forEach((r) => r());
      await Promise.all([op1, op2]);

      // Third should now execute
      await op3;
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it("should reject when queue is full (reject strategy)", async () => {
      const limiter = createConcurrencyLimiter("db", {
        maxConcurrent: 1,
        strategy: "reject",
      });

      // Start a long operation
      const op1 = limiter.execute(
        () => new Promise((resolve) => setTimeout(() => resolve(1), 1000))
      );

      // This should reject immediately
      await expect(limiter.execute(() => 2)).rejects.toEqual(
        expect.objectContaining({
          type: "QUEUE_FULL",
          limiterName: "db",
        })
      );

      vi.advanceTimersByTime(1000);
      await op1;
    });

    it("should respect maxQueueSize", async () => {
      const limiter = createConcurrencyLimiter("db", {
        maxConcurrent: 1,
        strategy: "queue",
        maxQueueSize: 1,
      });

      // Start a long operation
      limiter.execute(
        () => new Promise((resolve) => setTimeout(() => resolve(1), 1000))
      );

      // Queue one operation
      const op2 = limiter.execute(() => 2);

      // This should reject as queue is full
      await expect(limiter.execute(() => 3)).rejects.toEqual(
        expect.objectContaining({
          type: "QUEUE_FULL",
          maxQueueSize: 1,
        })
      );

      vi.advanceTimersByTime(2000);
      await op2;
    });

    it("should execute all operations with executeAll", async () => {
      const limiter = createConcurrencyLimiter("db", { maxConcurrent: 2 });

      const operations = [
        () => Promise.resolve(1),
        () => Promise.resolve(2),
        () => Promise.resolve(3),
        () => Promise.resolve(4),
      ];

      const results = await limiter.executeAll(operations);
      expect(results).toEqual([1, 2, 3, 4]);
    });

    it("should maintain order in executeAll", async () => {
      const limiter = createConcurrencyLimiter("db", { maxConcurrent: 2 });

      const operations = [
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return "slow";
        },
        async () => "fast",
      ];

      const promise = limiter.executeAll(operations);
      await vi.advanceTimersByTimeAsync(100);

      const results = await promise;
      expect(results).toEqual(["slow", "fast"]);
    });

    it("should reset state", () => {
      const limiter = createConcurrencyLimiter("db", { maxConcurrent: 5 });

      limiter.reset();

      const stats = limiter.getStats();
      expect(stats.activeCount).toBe(0);
      expect(stats.queueSize).toBe(0);
    });
  });

  describe("createConcurrencyLimiter.executeResult", () => {
    it("should execute Result-returning operations", async () => {
      const limiter = createConcurrencyLimiter("db", { maxConcurrent: 5 });

      const result = await limiter.executeResult(() => ok({ id: "1" }));
      expect(result.ok).toBe(true);
    });

    it("should return queue full error as Result", async () => {
      const limiter = createConcurrencyLimiter("db", {
        maxConcurrent: 1,
        strategy: "queue",
        maxQueueSize: 0,
      });

      // Start a long operation
      limiter.executeResult(
        () => new Promise<Result<number, never>>((resolve) => setTimeout(() => resolve(ok(1)), 1000))
      );

      const result = await limiter.executeResult(() => ok(2));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isQueueFullError(result.error)).toBe(true);
      }

      vi.advanceTimersByTime(1000);
    });
  });

  describe("createCombinedLimiter", () => {
    it("should create a combined limiter", () => {
      const limiter = createCombinedLimiter("api", {
        rate: { maxPerSecond: 10 },
        concurrency: { maxConcurrent: 5 },
      });

      expect(limiter.rate).toBeDefined();
      expect(limiter.concurrency).toBeDefined();
      expect(limiter.execute).toBeInstanceOf(Function);
    });

    it("should apply rate limiting first, then concurrency", async () => {
      const limiter = createCombinedLimiter("api", {
        rate: { maxPerSecond: 10, burstCapacity: 10 },
        concurrency: { maxConcurrent: 5 },
      });

      const result = await limiter.execute(() => "success");
      expect(result).toBe("success");

      // Check rate limiter tokens were consumed
      expect(limiter.rate?.getStats().availableTokens).toBe(9);
    });

    it("should work with only rate limiting", async () => {
      const limiter = createCombinedLimiter("api", {
        rate: { maxPerSecond: 10 },
      });

      const result = await limiter.execute(() => "success");
      expect(result).toBe("success");
      expect(limiter.concurrency).toBeUndefined();
    });

    it("should work with only concurrency limiting", async () => {
      const limiter = createCombinedLimiter("api", {
        concurrency: { maxConcurrent: 5 },
      });

      const result = await limiter.execute(() => "success");
      expect(result).toBe("success");
      expect(limiter.rate).toBeUndefined();
    });
  });

  describe("type guards", () => {
    it("should identify RateLimitExceededError", () => {
      const error = {
        type: "RATE_LIMIT_EXCEEDED",
        limiterName: "api",
        retryAfterMs: 100,
      };

      expect(isRateLimitExceededError(error)).toBe(true);
      expect(isRateLimitExceededError({ type: "OTHER" })).toBe(false);
      expect(isRateLimitExceededError(null)).toBe(false);
    });

    it("should identify QueueFullError", () => {
      const error = {
        type: "QUEUE_FULL",
        limiterName: "db",
        queueSize: 10,
        maxQueueSize: 10,
      };

      expect(isQueueFullError(error)).toBe(true);
      expect(isQueueFullError({ type: "OTHER" })).toBe(false);
      expect(isQueueFullError(null)).toBe(false);
    });
  });

  describe("rateLimiterPresets", () => {
    it("should have api preset", () => {
      expect(rateLimiterPresets.api).toEqual({
        maxPerSecond: 10,
        burstCapacity: 20,
        strategy: "wait",
      });
    });

    it("should have database preset", () => {
      expect(rateLimiterPresets.database).toEqual({
        maxConcurrent: 10,
        strategy: "queue",
        maxQueueSize: 100,
      });
    });

    it("should have external preset", () => {
      expect(rateLimiterPresets.external).toEqual({
        maxPerSecond: 5,
        burstCapacity: 10,
        strategy: "wait",
      });
    });

    it("should work with createRateLimiter", async () => {
      const limiter = createRateLimiter("api", rateLimiterPresets.api);
      const result = await limiter.execute(() => "success");
      expect(result).toBe("success");
    });

    it("should work with createConcurrencyLimiter", async () => {
      const limiter = createConcurrencyLimiter("db", rateLimiterPresets.database);
      const result = await limiter.execute(() => "success");
      expect(result).toBe("success");
    });
  });

  describe("createFixedWindowLimiter", () => {
    it("should create a fixed window limiter instance", () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 10,
        windowMs: 1000,
      });
      expect(limiter).toBeDefined();
      expect(limiter.execute).toBeInstanceOf(Function);
    });

    it("should execute operations immediately when under limit", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 10,
        windowMs: 1000,
      });

      const result = await limiter.execute(() => "success");
      expect(result).toBe("success");
    });

    it("should track request count", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 10,
        windowMs: 1000,
      });

      await limiter.execute(() => "result1");
      await limiter.execute(() => "result2");

      const stats = limiter.getStats();
      expect(stats.requestCount).toBe(2);
      expect(stats.limit).toBe(10);
    });

    it("should wait when window limit exceeded (wait strategy)", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 2,
        windowMs: 1000,
        strategy: "wait",
      });

      await limiter.execute(() => "result1");
      await limiter.execute(() => "result2");

      // This should wait for window reset
      const promise = limiter.execute(() => "result3");

      // Advance time to next window
      vi.advanceTimersByTime(1000);

      const result = await promise;
      expect(result).toBe("result3");
    });

    it("should reject when window limit exceeded (reject strategy)", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 1,
        windowMs: 1000,
        strategy: "reject",
      });

      await limiter.execute(() => "result1");

      await expect(limiter.execute(() => "result2")).rejects.toEqual(
        expect.objectContaining({
          type: "RATE_LIMIT_EXCEEDED",
          limiterName: "api",
        })
      );
    });

    it("should reset count on new window", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 10,
        windowMs: 1000,
      });

      await limiter.execute(() => "result1");
      expect(limiter.getStats().requestCount).toBe(1);

      // Move to next window
      vi.advanceTimersByTime(1000);

      expect(limiter.getStats().requestCount).toBe(0);
    });

    it("should support cost-based operations", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 10,
        windowMs: 1000,
      });

      // Batch operation costs 5
      await limiter.execute(() => "batch", 5);

      const stats = limiter.getStats();
      expect(stats.requestCount).toBe(5);

      // Only 5 remaining in window
      await expect(
        (async () => {
          const limiter2 = createFixedWindowLimiter("api2", {
            limit: 10,
            windowMs: 1000,
            strategy: "reject",
          });
          await limiter2.execute(() => "batch1", 5);
          await limiter2.execute(() => "batch2", 6); // Over limit!
        })()
      ).rejects.toEqual(
        expect.objectContaining({ type: "RATE_LIMIT_EXCEEDED" })
      );
    });

    it("should reject immediately when cost exceeds window limit (wait strategy)", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 5,
        windowMs: 1000,
        strategy: "wait",
      });

      // Should reject immediately since cost > limit can never succeed
      await expect(limiter.execute(() => "result", 6)).rejects.toEqual(
        expect.objectContaining({ type: "RATE_LIMIT_EXCEEDED" })
      );
    });

    it("should reset state", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 10,
        windowMs: 1000,
      });

      await limiter.execute(() => "result1");
      await limiter.execute(() => "result2");

      limiter.reset();

      const stats = limiter.getStats();
      expect(stats.requestCount).toBe(0);
    });
  });

  describe("createFixedWindowLimiter.executeResult", () => {
    it("should execute Result-returning operations", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 10,
        windowMs: 1000,
      });

      const result = await limiter.executeResult(() => ok({ id: "1" }));
      expect(result.ok).toBe(true);
    });

    it("should return rate limit error as Result (reject strategy)", async () => {
      const limiter = createFixedWindowLimiter("api", {
        limit: 1,
        windowMs: 1000,
        strategy: "reject",
      });

      await limiter.executeResult(() => ok("result1"));

      const result = await limiter.executeResult(() => ok("result2"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isRateLimitExceededError(result.error)).toBe(true);
      }
    });
  });

  describe("createCostBasedRateLimiter", () => {
    it("should create a cost-based rate limiter instance", () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
      });
      expect(limiter).toBeDefined();
      expect(limiter.execute).toBeInstanceOf(Function);
    });

    it("should execute operations with default cost of 1", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 100,
      });

      await limiter.execute(() => "result");

      const stats = limiter.getStats();
      expect(stats.availableTokens).toBe(99);
    });

    it("should support different costs per operation", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 100,
      });

      // Simple query costs 1
      await limiter.execute(() => "simple", 1);

      // Batch operation costs 10
      await limiter.execute(() => "batch", 10);

      // Heavy export costs 50
      await limiter.execute(() => "export", 50);

      const stats = limiter.getStats();
      expect(stats.availableTokens).toBe(39); // 100 - 1 - 10 - 50
    });

    it("should wait for tokens when insufficient (wait strategy)", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 10,
        strategy: "wait",
      });

      // Use all tokens
      await limiter.execute(() => "result", 10);

      // This needs 5 tokens, should wait
      const promise = limiter.execute(() => "result2", 5);

      // Advance time to get more tokens (50ms = 5 tokens at 100/s)
      vi.advanceTimersByTime(50);

      const result = await promise;
      expect(result).toBe("result2");
    });

    it("should reject when insufficient tokens (reject strategy)", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 10,
        strategy: "reject",
      });

      // Use all tokens
      await limiter.execute(() => "result", 10);

      await expect(limiter.execute(() => "result2", 5)).rejects.toEqual(
        expect.objectContaining({
          type: "RATE_LIMIT_EXCEEDED",
          limiterName: "api",
        })
      );
    });

    it("should reject immediately when cost exceeds max tokens (wait strategy)", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 10,
        strategy: "wait",
      });

      // Should reject immediately since cost > maxTokens can never succeed
      await expect(limiter.execute(() => "result", 11)).rejects.toEqual(
        expect.objectContaining({ type: "RATE_LIMIT_EXCEEDED" })
      );
    });

    it("should refill tokens over time", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 100,
      });

      await limiter.execute(() => "result", 50);
      expect(limiter.getStats().availableTokens).toBe(50);

      // Advance 250ms = 25 tokens refilled
      vi.advanceTimersByTime(250);

      expect(limiter.getStats().availableTokens).toBe(75);
    });

    it("should not exceed max tokens", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 100,
      });

      // Already at max
      expect(limiter.getStats().availableTokens).toBe(100);

      // Advance time - should stay at max
      vi.advanceTimersByTime(1000);

      expect(limiter.getStats().availableTokens).toBe(100);
    });

    it("should reset state", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 100,
      });

      await limiter.execute(() => "result", 50);

      limiter.reset();

      expect(limiter.getStats().availableTokens).toBe(100);
    });
  });

  describe("createCostBasedRateLimiter.executeResult", () => {
    it("should execute Result-returning operations", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
      });

      const result = await limiter.executeResult(() => ok({ id: "1" }), 5);
      expect(result.ok).toBe(true);
    });

    it("should return rate limit error as Result (reject strategy)", async () => {
      const limiter = createCostBasedRateLimiter("api", {
        tokensPerSecond: 100,
        maxTokens: 10,
        strategy: "reject",
      });

      await limiter.executeResult(() => ok("result1"), 10);

      const result = await limiter.executeResult(() => ok("result2"), 5);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isRateLimitExceededError(result.error)).toBe(true);
      }
    });
  });
});
