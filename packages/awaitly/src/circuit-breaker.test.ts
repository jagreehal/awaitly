import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCircuitBreaker,
  CircuitOpenError,
  isCircuitOpenError,
  circuitBreakerPresets,
} from "./circuit-breaker";
import { ok, err } from "./core";

describe("Circuit Breaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createCircuitBreaker", () => {
    it("should start in CLOSED state", () => {
      const breaker = createCircuitBreaker("test");
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should execute operations when CLOSED", async () => {
      const breaker = createCircuitBreaker("test");
      const result = await breaker.execute(() => "success");
      expect(result).toBe("success");
    });

    it("should track successful operations", async () => {
      const breaker = createCircuitBreaker("test");
      await breaker.execute(() => "success");
      await breaker.execute(() => "success");

      const stats = breaker.getStats();
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(0);
    });

    it("should track failed operations", async () => {
      const breaker = createCircuitBreaker("test", { failureThreshold: 10 });

      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => {
            throw new Error("fail");
          });
        } catch {
          // Expected
        }
      }

      const stats = breaker.getStats();
      expect(stats.failureCount).toBe(3);
    });

    it("should open circuit after failure threshold", async () => {
      const breaker = createCircuitBreaker("test", {
        failureThreshold: 3,
        resetTimeout: 30000,
      });

      // Cause 3 failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => {
            throw new Error("fail");
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getState()).toBe("OPEN");
    });

    it("should throw CircuitOpenError when OPEN", async () => {
      const breaker = createCircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeout: 30000,
      });

      // Trip the circuit
      try {
        await breaker.execute(() => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe("OPEN");

      // Next call should throw CircuitOpenError
      await expect(breaker.execute(() => "success")).rejects.toThrow(
        CircuitOpenError
      );
    });

    it("should transition to HALF_OPEN after resetTimeout", async () => {
      const breaker = createCircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeout: 30000,
      });

      // Trip the circuit
      try {
        await breaker.execute(() => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe("OPEN");

      // Advance time past resetTimeout
      vi.advanceTimersByTime(30001);

      expect(breaker.getState()).toBe("HALF_OPEN");
    });

    it("should close circuit after successful HALF_OPEN requests", async () => {
      const breaker = createCircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeout: 30000,
        halfOpenMax: 2,
      });

      // Trip the circuit
      try {
        await breaker.execute(() => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      // Advance to HALF_OPEN
      vi.advanceTimersByTime(30001);
      expect(breaker.getState()).toBe("HALF_OPEN");

      // Two successful requests should close the circuit
      await breaker.execute(() => "success");
      await breaker.execute(() => "success");

      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should reopen circuit on failure in HALF_OPEN", async () => {
      const breaker = createCircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeout: 30000,
        halfOpenMax: 3,
      });

      // Trip the circuit
      try {
        await breaker.execute(() => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      // Advance to HALF_OPEN
      vi.advanceTimersByTime(30001);
      expect(breaker.getState()).toBe("HALF_OPEN");

      // Failure should reopen
      try {
        await breaker.execute(() => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe("OPEN");
    });

    it("should clean up old failures outside window", async () => {
      const breaker = createCircuitBreaker("test", {
        failureThreshold: 5,
        windowSize: 60000,
      });

      // Cause 3 failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(() => {
            throw new Error("fail");
          });
        } catch {
          // Expected
        }
      }

      expect(breaker.getStats().failureCount).toBe(3);

      // Advance time past the window
      vi.advanceTimersByTime(61000);

      // Failures should be cleaned up
      expect(breaker.getStats().failureCount).toBe(0);
    });
  });

  describe("executeResult", () => {
    it("should return Result on success", async () => {
      const breaker = createCircuitBreaker("test");
      const result = await breaker.executeResult(() => ok("success"));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("success");
      }
    });

    it("should track err results as failures", async () => {
      const breaker = createCircuitBreaker("test", { failureThreshold: 2 });

      await breaker.executeResult(() => err("ERROR"));
      await breaker.executeResult(() => err("ERROR"));

      expect(breaker.getState()).toBe("OPEN");
    });

    it("should return CircuitOpenError result when OPEN", async () => {
      const breaker = createCircuitBreaker("test", { failureThreshold: 1 });

      // Trip the circuit
      await breaker.executeResult(() => err("ERROR"));

      const result = await breaker.executeResult(() => ok("success"));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(isCircuitOpenError(result.error)).toBe(true);
      }
    });
  });

  describe("manual controls", () => {
    it("should reset circuit to CLOSED", async () => {
      const breaker = createCircuitBreaker("test", { failureThreshold: 1 });

      // Trip the circuit
      try {
        await breaker.execute(() => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      expect(breaker.getState()).toBe("OPEN");

      breaker.reset();
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should force open circuit", () => {
      const breaker = createCircuitBreaker("test");
      expect(breaker.getState()).toBe("CLOSED");

      breaker.forceOpen();
      expect(breaker.getState()).toBe("OPEN");
    });

    it("should record manual success", () => {
      const breaker = createCircuitBreaker("test");
      breaker.recordSuccess();
      breaker.recordSuccess();

      expect(breaker.getStats().successCount).toBe(2);
    });

    it("should record manual failure", () => {
      const breaker = createCircuitBreaker("test", { failureThreshold: 2 });
      breaker.recordFailure();
      breaker.recordFailure();

      expect(breaker.getState()).toBe("OPEN");
    });
  });

  describe("onStateChange callback", () => {
    it("should call onStateChange when state changes", async () => {
      const onStateChange = vi.fn();
      const breaker = createCircuitBreaker("test", {
        failureThreshold: 1,
        resetTimeout: 30000,
        onStateChange,
      });

      // Trip the circuit
      try {
        await breaker.execute(() => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      expect(onStateChange).toHaveBeenCalledWith("CLOSED", "OPEN", "test");

      // Advance to HALF_OPEN
      vi.advanceTimersByTime(30001);
      breaker.getState(); // Trigger check

      expect(onStateChange).toHaveBeenCalledWith("OPEN", "HALF_OPEN", "test");
    });
  });

  describe("CircuitOpenError", () => {
    it("should have correct properties", async () => {
      const breaker = createCircuitBreaker("my-api", {
        failureThreshold: 1,
        resetTimeout: 30000,
      });

      // Trip the circuit
      try {
        await breaker.execute(() => {
          throw new Error("fail");
        });
      } catch {
        // Expected
      }

      try {
        await breaker.execute(() => "success");
      } catch (error) {
        expect(error).toBeInstanceOf(CircuitOpenError);
        const circuitError = error as CircuitOpenError;
        expect(circuitError.circuitName).toBe("my-api");
        expect(circuitError.state).toBe("OPEN");
        expect(circuitError.retryAfterMs).toBeGreaterThan(0);
      }
    });
  });

  describe("isCircuitOpenError", () => {
    it("should return true for CircuitOpenError", () => {
      const error = new CircuitOpenError({
        circuitName: "test",
        state: "OPEN",
        retryAfterMs: 30000,
      });
      expect(isCircuitOpenError(error)).toBe(true);
    });

    it("should return false for other errors", () => {
      expect(isCircuitOpenError(new Error("test"))).toBe(false);
      expect(isCircuitOpenError(null)).toBe(false);
      expect(isCircuitOpenError(undefined)).toBe(false);
      expect(isCircuitOpenError("string")).toBe(false);
    });
  });

  describe("presets", () => {
    it("should have critical preset", () => {
      const breaker = createCircuitBreaker("test", circuitBreakerPresets.critical);
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should have standard preset", () => {
      const breaker = createCircuitBreaker("test", circuitBreakerPresets.standard);
      expect(breaker.getState()).toBe("CLOSED");
    });

    it("should have lenient preset", () => {
      const breaker = createCircuitBreaker("test", circuitBreakerPresets.lenient);
      expect(breaker.getState()).toBe("CLOSED");
    });
  });
});
